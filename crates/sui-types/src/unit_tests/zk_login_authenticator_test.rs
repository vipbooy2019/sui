// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

use crate::{
    base_types::SuiAddress,
    crypto::{get_key_pair_from_rng, DefaultHash, Signature, SignatureScheme, SuiKeyPair},
    signature::{AuthenticatorTrait, GenericSignature},
    utils::make_transaction,
    zk_login_authenticator::{
        OAuthProviderContent, ProofPoints, PublicInputs, ZkLoginAuthenticator,
    },
};
use fastcrypto::{hash::HashFunction, traits::EncodeDecodeBase64};
use fastcrypto_zkp::bn254::zk_login::{big_int_str_to_hash, AuxInputs};
use rand::{rngs::StdRng, SeedableRng};
use shared_crypto::intent::{Intent, IntentMessage, IntentScope};

pub fn keys() -> Vec<SuiKeyPair> {
    let mut seed = StdRng::from_seed([0; 32]);
    let kp1: SuiKeyPair = SuiKeyPair::Ed25519(get_key_pair_from_rng(&mut seed).1);
    let kp2: SuiKeyPair = SuiKeyPair::Secp256k1(get_key_pair_from_rng(&mut seed).1);
    let kp3: SuiKeyPair = SuiKeyPair::Secp256r1(get_key_pair_from_rng(&mut seed).1);
    vec![kp1, kp2, kp3]
}

#[test]
fn zklogin_authenticator_scenarios() {
    let keys = keys();
    let foundation_key = &keys[0];
    let user_key = &keys[0];

    let public_inputs = PublicInputs::from_fp("./src/unit_tests/public.json");
    let proof_points = ProofPoints::from_fp("./src/unit_tests/google.proof");
    let aux_inputs = AuxInputs::from_fp("./src/unit_tests/aux.json").unwrap();

    let mut hasher = DefaultHash::default();
    hasher.update([SignatureScheme::ZkLoginAuthenticator.flag()]);
    hasher.update(big_int_str_to_hash(
        "600496735937200653405567117446691002318195750668637759107608398707587364969",
    ));
    hasher.update("https://accounts.google.com".as_bytes());
    let user_address = SuiAddress::from_bytes(hasher.finalize().digest).unwrap();

    // Create an example bulletin with 2 keys from Google.
    let example_bulletin = vec![
        OAuthProviderContent::new(
            "https://accounts.google.com".to_string(),
            "RSA".to_string(),
            "96971808796829a972e79a9d1a9fff11cd61b1e3".to_string(),
            "AQAB".to_string(),
            "vfBbH3bcgTzYXomo5hmimATzkEF0QIuhMYmwx0IrpdKT6M15b6KBVhZsPfwbRNoui3iBe8xLON2VHarDgXRzrHec6-oLx8Sh4R4B47MdASURoiIOBiSOiJ3BjKQexNXT4wO0ZLSEMTVt_h24fgIerASU6w2XQOeGb7bbgZnJX3a0NAjsfrxCeG0PacWK2TE2R00mZoeAYWtCuAsE-Xz0hkGqEsg7HqIMYeLjQ-NFkGBErGAi5Cd_k3_D7rv0IEdoB1GkJpIdMLqnI-MR_OxsQNZGpC12OaLXCqgkFAgW69QLAG3YMaTFgPi-Us1i2idc4SPADYijiPml---jCap9yw".to_string(),
            "RS256".to_string(),
            "575519204237-msop9ep45u2uo98hapqmngv8d84qdc8k.apps.googleusercontent.com".to_string()
        )
    ];

    // Sign the bulletin content with the sui foundation key as a personal message.
    let bulletin_sig = Signature::new_secure(
        &IntentMessage::new(
            Intent::sui_app(IntentScope::PersonalMessage),
            example_bulletin.clone(),
        ),
        foundation_key,
    );

    println!("bulletin sig: {:?}", bulletin_sig.encode_base64());

    // Sign the user transaction with the user's ephemeral key.
    let tx = make_transaction(user_address, user_key, Intent::sui_transaction());
    let s = match tx.inner().tx_signatures.first().unwrap() {
        GenericSignature::Signature(s) => s,
        _ => panic!("Expected a signature"),
    };

    let authenticator = ZkLoginAuthenticator::new(
        proof_points,
        public_inputs,
        aux_inputs,
        s.clone(),
        bulletin_sig,
        example_bulletin,
    );

    assert!(authenticator
        .verify_secure_generic(
            &IntentMessage::new(
                Intent::sui_transaction(),
                tx.into_data().transaction_data().clone()
            ),
            user_address,
            Some(0)
        )
        .is_ok());
}

#[test]
fn test_parsing() {
    let res = AuxInputs::from_fp("./src/unit_tests/aux.json");
    assert!(res.is_ok());
    let aux_inputs = res.unwrap();
    // assert_eq!(aux_inputs.payload_start_index, 103);
    // assert_eq!(aux_inputs.payload_len, 534);
    assert_eq!(
        aux_inputs.get_jwt_hash(),
        vec![
            118, 147, 129, 225, 127, 187, 123, 10, 143, 152, 201, 65, 7, 169, 168, 153, 181, 243,
            242, 165, 191, 167, 30, 214, 134, 27, 246, 235, 245, 93, 53, 245
        ]
    );
    assert_eq!(
        aux_inputs.get_eph_pub_key(),
        vec![
            13, 125, 171, 53, 140, 141, 173, 170, 78, 250, 0, 73, 167, 91, 7, 67, 101, 85, 177, 10,
            54, 130, 25, 187, 104, 15, 112, 87, 19, 73, 215, 117
        ]
    );

    let masked_content = aux_inputs.get_masked_content();
    assert_eq!(masked_content.get_iss(), "https://accounts.google.com");
    assert_eq!(
        masked_content.get_wallet_id(),
        "575519204237-msop9ep45u2uo98hapqmngv8d84qdc8k.apps.googleusercontent.com"
    );
    // assert_eq!(
    //     masked_content.noncge,
    //     "16637918813908060261870528903994038721669799613803601616678155512181273289477"
    // );
    // assert_eq!(
    //     masked_content.hash,
    //     "15574265890121888853134966170838207038528069623841940909502184441509395967684"
    // );

    // let header = masked_content.header;
    // assert_eq!(header.alg, "RS256".to_string());
    // assert_eq!(header.typ, "JWT".to_string());
    // assert_eq!(
    //     header.kid,
    //     "96971808796829a972e79a9d1a9fff11cd61b1e3".to_string()
    // );
}

// #[test]
// fn test_masked_content_parser() {
//     let d = find_parts_and_indices(&[
//         61, 121, 74, 112, 99, 51, 77, 105, 79, 105, 74, 111, 100, 72, 82, 119, 99, 122, 111, 118,
//         76, 50, 70, 106, 89, 50, 57, 49, 98, 110, 82, 122, 76, 109, 100, 118, 98, 50, 100, 115, 90,
//         83, 53, 106, 98, 50, 48, 105, 76, 67, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61,
//         61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61,
//         61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61,
//         61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61,
//         61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61,
//         61, 61, 67, 74, 104, 100, 87, 81, 105, 79, 105, 73, 49, 78, 122, 85, 49, 77, 84, 107, 121,
//         77, 68, 81, 121, 77, 122, 99, 116, 98, 88, 78, 118, 99, 68, 108, 108, 99, 68, 81, 49, 100,
//         84, 74, 49, 98, 122, 107, 52, 97, 71, 70, 119, 99, 87, 49, 117, 90, 51, 89, 52, 90, 68,
//         103, 48, 99, 87, 82, 106, 79, 71, 115, 117, 89, 88, 66, 119, 99, 121, 53, 110, 98, 50, 57,
//         110, 98, 71, 86, 49, 99, 50, 86, 121, 89, 50, 57, 117, 100, 71, 86, 117, 100, 67, 53, 106,
//         98, 50, 48, 105, 76, 67, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61,
//         61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61,
//         67, 74, 117, 98, 50, 53, 106, 90, 83, 73, 54, 73, 106, 69, 50, 78, 106, 77, 51, 79, 84, 69,
//         52, 79, 68, 69, 122, 79, 84, 65, 52, 77, 68, 89, 119, 77, 106, 89, 120, 79, 68, 99, 119,
//         78, 84, 73, 52, 79, 84, 65, 122, 79, 84, 107, 48, 77, 68, 77, 52, 78, 122, 73, 120, 78,
//         106, 89, 53, 78, 122, 107, 53, 78, 106, 69, 122, 79, 68, 65, 122, 78, 106, 65, 120, 78,
//         106, 69, 50, 78, 106, 99, 52, 77, 84, 85, 49, 78, 84, 69, 121, 77, 84, 103, 120, 77, 106,
//         99, 122, 77, 106, 103, 53, 78, 68, 99, 51, 73, 105, 119, 61, 61, 61, 61, 61, 61, 61, 61,
//         61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61,
//         61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61,
//         61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61,
//         61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61,
//         61, 61, 61, 61, 61, 61, 61, 61, 61, 61, 61,
//     ]);
//     println!("{:?}", d);
// }
