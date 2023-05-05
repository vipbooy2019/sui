// Copyright (c) 2021, Facebook, Inc. and its affiliates
// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
use crate::{
    base_types::SuiAddress,
    committee::EpochId,
    crypto::{Signature, SignatureScheme, SuiSignature},
    error::SuiError,
    signature::AuthenticatorTrait,
};
use fastcrypto::rsa::Base64UrlUnpadded;
use fastcrypto::rsa::Encoding as OtherEncoding;
use fastcrypto::rsa::RSAPublicKey;
use fastcrypto::rsa::RSASignature;
use fastcrypto_zkp::bn254::{
    zk_login::{verify_groth16_with_provider, AuxInputs, OIDCProvider, ProofPoints, PublicInputs},
};
use once_cell::sync::OnceCell;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use shared_crypto::intent::Intent;
use shared_crypto::intent::{IntentMessage, IntentScope};
use std::hash::Hash;
use std::hash::Hasher;

#[cfg(test)]
#[path = "unit_tests/zk_login_authenticator_test.rs"]
mod zk_login_authenticator_test;

/// An open id authenticator with all the necessary fields.
#[derive(Debug, Clone, JsonSchema, Serialize, Deserialize)]
pub struct ZkLoginAuthenticator {
    proof_points: ProofPoints,
    public_inputs: PublicInputs,
    aux_inputs: AuxInputs,
    user_signature: Signature,
    bulletin_signature: Signature,
    bulletin: Vec<OAuthProviderContent>,
    #[serde(skip)]
    pub bytes: OnceCell<Vec<u8>>,
}

impl ZkLoginAuthenticator {
    /// Create a new [struct ZkLoginAuthenticator] with necessary fields.
    pub fn new(
        proof_points: ProofPoints,
        public_inputs: PublicInputs,
        aux_inputs: AuxInputs,
        user_signature: Signature,
        bulletin_signature: Signature,
        bulletin: Vec<OAuthProviderContent>,
    ) -> Self {
        Self {
            proof_points,
            public_inputs,
            aux_inputs,
            user_signature,
            bulletin_signature,
            bulletin,
            bytes: OnceCell::new(),
        }
    }

    pub fn get_sub_id_com_bytes(&self) -> Vec<u8> {
        self.aux_inputs.get_sub_id_com()
    }

    pub fn get_iss_bytes(&self) -> &[u8] {
        self.aux_inputs.get_masked_content().get_iss().as_bytes()
    }
}

/// Necessary trait for [struct SenderSignedData].
impl PartialEq for ZkLoginAuthenticator {
    fn eq(&self, other: &Self) -> bool {
        self.proof_points == other.proof_points
            && self.aux_inputs == other.aux_inputs
            && self.user_signature == other.user_signature
            && self.bulletin_signature == other.bulletin_signature
            && self.bulletin == other.bulletin
    }
}

/// Necessary trait for [struct SenderSignedData].
impl Eq for ZkLoginAuthenticator {}

/// Necessary trait for [struct SenderSignedData].
impl Hash for ZkLoginAuthenticator {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.as_ref().hash(state);
    }
}

/// Struct that contains all the OAuth provider information. A list of them can
/// be retrieved from the JWK endpoint (e.g. https://www.googleapis.com/oauth2/v3/certs)
/// and published on the bulletin along with a trusted party's signature.
#[derive(Debug, Clone, PartialEq, Eq, JsonSchema, Hash, Serialize, Deserialize)]
pub struct OAuthProviderContent {
    iss: String,
    kty: String,
    kid: String,
    e: String,
    n: String,
    alg: String,
    wallet_id: String,
}

impl OAuthProviderContent {
    /// Create a new OAuthProviderContent with all given fields.
    pub fn new(
        iss: String,
        kty: String,
        kid: String,
        e: String,
        n: String,
        alg: String,
        wallet_id: String,
    ) -> Self {
        Self {
            iss,
            kty,
            kid,
            e,
            n,
            alg,
            wallet_id,
        }
    }
}

impl AuthenticatorTrait for ZkLoginAuthenticator {
    /// Verify an intent message of a transaction with an OpenID authenticator.
    fn verify_secure_generic<T>(
        &self,
        intent_msg: &IntentMessage<T>,
        author: SuiAddress,
        epoch: Option<EpochId>,
    ) -> Result<(), SuiError>
    where
        T: Serialize,
    {
        // Verify the author of the transaction is indeed the hash of of sub_id_com and iss.
        if author != self.into() {
            return Err(SuiError::InvalidAuthenticator);
        }
        let aux_inputs = &self.aux_inputs;
        let masked_content = aux_inputs.get_masked_content();

        // Verify the max epoch in aux inputs is within the current epoch.
        if aux_inputs.get_max_epoch() < epoch.unwrap_or(0) {
            return Err(SuiError::InvalidSignature {
                error: "Invalid epoch".to_string(),
            });
        }
        // println!("aux_inputs: {:?}", aux_inputs);
        // Calculates the hash of all inputs equals to the one in public inputs.
        // println!("cal hash== {:?}", &aux_inputs.calculate_all_inputs_hash());
        // println!("public== {:?}", self.public_inputs.get_all_inputs_hash());

        if aux_inputs.calculate_all_inputs_hash() != self.public_inputs.get_all_inputs_hash() {
            return Err(SuiError::InvalidSignature {
                error: "Invalid all inputs hash".to_string(),
            });
        }

        // Verify the provided bulletin signature indeed commits to the provided
        // bulletin content containing a list of valid OAuth provider contents, e.g.
        // https://www.googleapis.com/oauth2/v3/certs.
        if self
            .bulletin_signature
            .verify_secure(
                &IntentMessage::new(
                    Intent::sui_app(IntentScope::PersonalMessage),
                    self.bulletin.clone(),
                ),
                // foundation address, harded coded for now.
                (&self.bulletin_signature.to_public_key()?).into(),
            )
            .is_err()
        {
            return Err(SuiError::InvalidSignature {
                error: "Failed to verify bulletin signature".to_string(),
            });
        }
        // println!("verify_secure bulletin");

        // Verify the JWT signature against one of OAuth provider public keys in the bulletin.
        let sig = RSASignature::from_bytes(aux_inputs.get_jwt_signature()).map_err(|_| {
            SuiError::InvalidSignature {
                error: "Invalid JWT signature".to_string(),
            }
        })?;
        // println!("!!masked_content=={:?}", masked_content);

        // Since more than one JWKs are available in the bulletin, iterate and find the one with
        // matching kid, iss, and wallet_id (aud) and verify the signature against it.
        let mut verified = false;
        for info in self.bulletin.iter() {
            // println!("fjinfo=={:?}", info);

            if info.kid == *masked_content.get_kid()
                && info.iss == *masked_content.get_iss()
                && info.wallet_id == *masked_content.get_wallet_id()
            {
                // println!("&info=={:?}", info);

                let pk = RSAPublicKey::from_raw_components(
                    &Base64UrlUnpadded::decode_vec(&info.n).map_err(|_| {
                        SuiError::InvalidSignature {
                            error: "Invalid OAuth provider pubkey n".to_string(),
                        }
                    })?,
                    &Base64UrlUnpadded::decode_vec(&info.e).map_err(|_| {
                        SuiError::InvalidSignature {
                            error: "Invalid OAuth provider pubkey e".to_string(),
                        }
                    })?,
                )
                .map_err(|_| SuiError::InvalidSignature {
                    error: "Invalid RSA raw components".to_string(),
                })?;
                // println!(
                //     "&self.aux_inputs.get_jwt_hash()=={:?}",
                //     &self.aux_inputs.get_jwt_hash()
                // );
                // println!("&sig=={:?}", &sig.0);
                // println!("&pk=={:?}", &pk.0);

                if pk
                    .verify_prehash(&self.aux_inputs.get_jwt_hash(), &sig)
                    .is_ok()
                {
                    verified = true;
                }
            }
        }
        // println!("verify jwt {:?}", verified);

        if !verified {
            return Err(SuiError::InvalidSignature {
                error: "JWT signature verify failed".to_string(),
            });
        }

        // Ensure the ephemeral public key in the aux inputs matches the one in the
        // user signature.
        if self.aux_inputs.get_eph_pub_key() != self.user_signature.public_key_bytes() {
            return Err(SuiError::InvalidSignature {
                error: "Invalid ephemeral public_key".to_string(),
            });
        }
        // println!("verify get_eph_pub_key ok");

        // Verify the user signature over the intent message of the transaction data.
        if self
            .user_signature
            .verify_secure(intent_msg, author)
            .is_err()
        {
            return Err(SuiError::InvalidSignature {
                error: "User signature verify failed".to_string(),
            });
        }
        // println!("verify user sig ok");

        // Finally, verify the Groth16 proof, with the verifying key, public inputs
        // and proof points.
        // match verify_groth16_with_provider(
        //     OIDCProvider::Google,
        //     self.public_inputs.get_serialized_hash(),
        //     self.proof_points.get_bytes(),
        // ) {
        //     Ok(true) => Ok(()),
        //     Ok(false) | Err(_) => Err(SuiError::InvalidSignature {
        //         error: "Groth16 proof verify failed".to_string(),
        //     }),
        // }
        // let r = verify_groth16_with_provider(
        //     OIDCProvider::Google,
        //     // &[204, 163, 13, 136, 23, 97, 77, 134, 213, 241, 45, 166, 187, 210, 98, 132, 42, 76, 59, 173, 183, 72, 249, 208, 185, 177, 34, 50, 49, 100, 65, 23, 201, 83, 103, 73, 89, 253, 228, 100, 119, 66, 90, 79, 44, 186, 97, 199, 158, 174, 165, 75, 165, 234, 204, 156, 51, 19, 40, 31, 176, 12, 92, 30],
        //     // &[13, 20, 220, 48, 182, 120, 53, 125, 152, 139, 62, 176, 232, 173, 161, 27, 199, 178, 181, 210, 207, 12, 31, 226, 117, 34, 203, 42, 129, 155, 124, 4, 74, 96, 27, 217, 48, 42, 148, 168, 6, 119, 169, 247, 46, 190, 170, 218, 19, 30, 155, 251, 163, 6, 33, 200, 240, 56, 181, 71, 190, 185, 150, 46, 24, 32, 137, 116, 44, 29, 56, 132, 54, 119, 19, 144, 198, 175, 153, 55, 114, 156, 57, 230, 65, 71, 70, 238, 86, 54, 196, 116, 29, 31, 34, 13, 244, 92, 128, 167, 205, 237, 90, 214, 83, 188, 79, 139, 32, 28, 148, 5, 73, 24, 222, 225, 96, 225, 220, 144, 206, 160, 39, 212, 236, 105, 224, 26, 109, 240, 248, 215, 57, 215, 145, 26, 166, 59, 107, 105, 35, 241, 12, 220, 231, 99, 222, 16, 70, 254, 15, 145, 213, 144, 245, 245, 16, 57, 118, 17, 197, 122, 198, 218, 172, 47, 146, 34, 216, 204, 49, 48, 229, 127, 153, 220, 210, 237, 236, 179, 225, 209, 27, 134, 12, 13, 157, 100, 165, 221, 163, 15, 66, 184, 168, 229, 19, 201, 213, 152, 52, 134, 51, 44, 62, 205, 18, 54, 25, 43, 152, 134, 102, 193, 88, 24, 131, 133, 89, 188, 39, 182, 165, 15, 73, 254, 232, 143, 212, 58, 200, 141, 195, 231, 84, 25, 191, 212, 81, 55, 78, 37, 184, 196, 132, 91, 75, 252, 189, 70, 10, 212, 139, 181, 80, 22, 228, 225, 237, 242, 147, 105, 106, 67, 183, 108, 138, 95, 239, 254, 108, 253, 219, 89, 205, 123, 192, 36, 108, 23, 132, 6, 30, 211, 239, 242, 40, 10, 116, 229, 111, 202, 188, 91, 147, 216, 77, 114, 225, 10, 10, 215, 128, 121, 176, 45, 6, 204, 140, 58, 228, 53, 147, 108, 226, 232, 87, 34, 216, 43, 148, 128, 164, 111, 3, 153, 136, 168, 12, 244, 202, 102, 156, 2, 97, 0, 248, 206, 63, 188, 82, 152, 24, 13, 236, 8, 210, 5, 93, 122, 98, 26, 211, 204, 79, 221, 153, 36, 42, 134, 215, 200, 5, 40, 211, 180, 56, 196, 102, 146, 136, 197, 107, 119, 171, 184, 54, 117, 40, 163, 31, 1, 197, 17],
        //     // &[237, 246, 146, 217, 92, 189, 222, 70, 221, 218, 94, 247, 212, 34, 67, 103, 121, 68, 92, 94, 102, 0, 106, 66, 118, 30, 31, 18, 239, 222, 0, 24, 194, 18, 243, 174, 183, 133, 228, 151, 18, 231, 169, 53, 51, 73, 170, 241, 37, 93, 251, 49, 183, 191, 96, 114, 58, 72, 13, 146, 147, 147, 142, 153],
        //     // &[237, 246, 146, 217, 92, 189, 222, 70, 221, 218, 94, 247, 212, 34, 67, 103, 121, 68, 92, 94, 102, 0, 106, 66, 118, 30, 31, 18, 239, 222, 0, 24, 194, 18, 243, 174, 183, 133, 228, 151, 18, 231, 169, 53, 51, 73, 170, 241, 37, 93, 251, 49, 183, 191, 96, 114, 58, 72, 13, 146, 147, 147, 142, 153],
        //     self.public_inputs.get_serialized_hash(),
        //     self.proof_points.get_bytes(),
        // );
        // println!("rrr=={:?}", r);
        match verify_groth16_with_provider(
            OIDCProvider::Google,
            // &[204, 163, 13, 136, 23, 97, 77, 134, 213, 241, 45, 166, 187, 210, 98, 132, 42, 76, 59, 173, 183, 72, 249, 208, 185, 177, 34, 50, 49, 100, 65, 23, 201, 83, 103, 73, 89, 253, 228, 100, 119, 66, 90, 79, 44, 186, 97, 199, 158, 174, 165, 75, 165, 234, 204, 156, 51, 19, 40, 31, 176, 12, 92, 30],
            // &[13, 20, 220, 48, 182, 120, 53, 125, 152, 139, 62, 176, 232, 173, 161, 27, 199, 178, 181, 210, 207, 12, 31, 226, 117, 34, 203, 42, 129, 155, 124, 4, 74, 96, 27, 217, 48, 42, 148, 168, 6, 119, 169, 247, 46, 190, 170, 218, 19, 30, 155, 251, 163, 6, 33, 200, 240, 56, 181, 71, 190, 185, 150, 46, 24, 32, 137, 116, 44, 29, 56, 132, 54, 119, 19, 144, 198, 175, 153, 55, 114, 156, 57, 230, 65, 71, 70, 238, 86, 54, 196, 116, 29, 31, 34, 13, 244, 92, 128, 167, 205, 237, 90, 214, 83, 188, 79, 139, 32, 28, 148, 5, 73, 24, 222, 225, 96, 225, 220, 144, 206, 160, 39, 212, 236, 105, 224, 26, 109, 240, 248, 215, 57, 215, 145, 26, 166, 59, 107, 105, 35, 241, 12, 220, 231, 99, 222, 16, 70, 254, 15, 145, 213, 144, 245, 245, 16, 57, 118, 17, 197, 122, 198, 218, 172, 47, 146, 34, 216, 204, 49, 48, 229, 127, 153, 220, 210, 237, 236, 179, 225, 209, 27, 134, 12, 13, 157, 100, 165, 221, 163, 15, 66, 184, 168, 229, 19, 201, 213, 152, 52, 134, 51, 44, 62, 205, 18, 54, 25, 43, 152, 134, 102, 193, 88, 24, 131, 133, 89, 188, 39, 182, 165, 15, 73, 254, 232, 143, 212, 58, 200, 141, 195, 231, 84, 25, 191, 212, 81, 55, 78, 37, 184, 196, 132, 91, 75, 252, 189, 70, 10, 212, 139, 181, 80, 22, 228, 225, 237, 242, 147, 105, 106, 67, 183, 108, 138, 95, 239, 254, 108, 253, 219, 89, 205, 123, 192, 36, 108, 23, 132, 6, 30, 211, 239, 242, 40, 10, 116, 229, 111, 202, 188, 91, 147, 216, 77, 114, 225, 10, 10, 215, 128, 121, 176, 45, 6, 204, 140, 58, 228, 53, 147, 108, 226, 232, 87, 34, 216, 43, 148, 128, 164, 111, 3, 153, 136, 168, 12, 244, 202, 102, 156, 2, 97, 0, 248, 206, 63, 188, 82, 152, 24, 13, 236, 8, 210, 5, 93, 122, 98, 26, 211, 204, 79, 221, 153, 36, 42, 134, 215, 200, 5, 40, 211, 180, 56, 196, 102, 146, 136, 197, 107, 119, 171, 184, 54, 117, 40, 163, 31, 1, 197, 17],
            // &[237, 246, 146, 217, 92, 189, 222, 70, 221, 218, 94, 247, 212, 34, 67, 103, 121, 68, 92, 94, 102, 0, 106, 66, 118, 30, 31, 18, 239, 222, 0, 24, 194, 18, 243, 174, 183, 133, 228, 151, 18, 231, 169, 53, 51, 73, 170, 241, 37, 93, 251, 49, 183, 191, 96, 114, 58, 72, 13, 146, 147, 147, 142, 153],
            // &[237, 246, 146, 217, 92, 189, 222, 70, 221, 218, 94, 247, 212, 34, 67, 103, 121, 68, 92, 94, 102, 0, 106, 66, 118, 30, 31, 18, 239, 222, 0, 24, 194, 18, 243, 174, 183, 133, 228, 151, 18, 231, 169, 53, 51, 73, 170, 241, 37, 93, 251, 49, 183, 191, 96, 114, 58, 72, 13, 146, 147, 147, 142, 153],
            self.public_inputs.get_serialized_hash(),
            self.proof_points.get_bytes(),
        ) {
            Ok(true) => Ok(()),
            Ok(false) | Err(_) => Err(SuiError::InvalidSignature {
                error: "Groth16 proof verify failed".to_string(),
            }),
        }
    }
}

impl AsRef<[u8]> for ZkLoginAuthenticator {
    fn as_ref(&self) -> &[u8] {
        self.bytes
            .get_or_try_init::<_, eyre::Report>(|| {
                let as_bytes = bcs::to_bytes(self).expect("BCS serialization should not fail");
                let mut bytes = Vec::with_capacity(1 + as_bytes.len());
                bytes.push(SignatureScheme::ZkLoginAuthenticator.flag());
                bytes.extend_from_slice(as_bytes.as_slice());
                Ok(bytes)
            })
            .expect("OnceCell invariant violated")
    }
}
