// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { toB64 } from '@mysten/bcs';
import { SIGNATURE_FLAG_TO_SCHEME, SIGNATURE_SCHEME_TO_FLAG, SerializedSignature, SignatureFlag, SignaturePubkeyPair, fromSerializedSignature } from './signature';
import { PublicKey } from './publickey';
import { blake2b } from '@noble/hashes/blake2b';
import { bytesToHex } from '@noble/hashes/utils';
import RoaringBitmap32 from 'roaring/RoaringBitmap32';

import { normalizeSuiAddress, SUI_ADDRESS_LENGTH } from '../types';
import { Ed25519PublicKey, Secp256k1PublicKey, builder, fromB64 } from '..';
import {
  object,
  array,
  Infer,
  integer,
  // literal,
  // union
} from 'superstruct';

export type PubkeyWeightPair = {
  pubKey: PublicKey;
  weight: number;
};

// const CompressedSignatureTypes = [
//   object({ kind: literal('Ed25519'), val: array(integer()) }),
//   object({ kind: literal('Secp256k1'), val: array(integer()) }),
//   object({ kind: literal('Secp256r1'), index: array(integer()) }),
// ] as const;
// export const CompressedSignature = union([...CompressedSignatureTypes]);

export const CompressedSignature = array(integer());
export type CompressedSignature = Infer<typeof CompressedSignature>;

export const MultiSigPublicKey = object({
  pk_map: array(array(integer())),
  threshold: array(integer()),
});

export const MultiSig = object({
  sigs: array(CompressedSignature),
  bitmap: array(integer()),
  multisig_pk: MultiSigPublicKey,
});

export type MultiSigPublicKey = Infer<typeof MultiSigPublicKey>;
export type MultiSig = Infer<typeof MultiSig>;

export function toMultiSigAddress(
  pks: PubkeyWeightPair[],
  threshold: Uint8Array,
  ): string {
    let maxLength = 1 + 64 * 10 + 1 * 10 + 2;
    let tmp = new Uint8Array(maxLength);
    tmp.set([SIGNATURE_SCHEME_TO_FLAG['MultiSig']]);
    tmp.set(threshold, 1);
    let i = 3;
    for (const pk of pks) {
      tmp.set(pk.pubKey.flag(), i);
      tmp.set(pk.pubKey.toBytes(), i + 1);
      tmp.set([pk.weight], i + 1 + pk.pubKey.toBytes().length);
      i += pk.pubKey.toBytes().length + 2;
    }
    return normalizeSuiAddress(
      bytesToHex(blake2b(tmp.slice(0, i), { dkLen: 32 })).slice(0, SUI_ADDRESS_LENGTH * 2),
    );
}

export function combinePartialSigs(
  pairs: SerializedSignature[],
  pks: PubkeyWeightPair[],
  threshold: Uint8Array
): SerializedSignature {
  let multisig_pk: MultiSigPublicKey = {
    pk_map: to_serialize_pk_map(pks),
    threshold: Array.from(threshold.map((x) => Number(x))),
  };
  const bitmap3 = new RoaringBitmap32();
  let compressed_sigs: CompressedSignature[] = new Array(pairs.length);
  for (let i = 0; i < pairs.length; i++) {
    let parsed = fromSerializedSignature(pairs[i]);
    let compressed_sig = new Uint8Array(parsed.signature.length);
    // compressed_sig.set([SIGNATURE_SCHEME_TO_FLAG[parsed.signatureScheme]]);
    compressed_sig.set(parsed.signature);
    // let compressed_sig = new Uint8Array(parsed.signature.length + 1);
    // compressed_sig.set([SIGNATURE_SCHEME_TO_FLAG[parsed.signatureScheme]]);
    // compressed_sig.set(parsed.signature, 1);
    // compressed_sigs[i] = {
    //   kind: parsed.signatureScheme.toString(),
    //   val: Array.from(compressed_sig.slice()).map((x) => Number(x))
    // };
    for (let j = 0; j < pks.length; j++) {
      if (parsed.pubKey.equals(pks[j].pubKey)) {
        bitmap3.add(j);
        break;
      }
    }
  }
  let multisig: MultiSig = {
    sigs: compressed_sigs,
    bitmap: bitmap3.toArray(),
    multisig_pk: multisig_pk,
  }; 
  console.log('multisig', multisig);
  console.log('multisig_pk', multisig_pk);

  const bytes = builder.ser('MultiSig', multisig).toBytes();
  let tmp = new Uint8Array(bytes.length + 1);
  tmp.set([SIGNATURE_SCHEME_TO_FLAG['MultiSig']]);
  tmp.set(bytes, 1);
  console.log('multisig bytes', toB64(tmp));
  return toB64(tmp);
}

export function decodeMultiSig(signature: string): SignaturePubkeyPair[] {
    const parsed = fromB64(signature);
    if (parsed.length < 1 || parsed[0] !== SIGNATURE_SCHEME_TO_FLAG['MultiSig']) {
      throw new Error('Invalid MultiSig flag');
    };

    const multisig: MultiSig = builder.de('MultiSig', parsed.slice(1));
    let res: SignaturePubkeyPair[] = new Array(10);
    for (let i = 0; i < multisig.sigs.length; i++) {
      let s: CompressedSignature = multisig.sigs[i];
      let pk_index = multisig.bitmap.at(i);
      let scheme = SIGNATURE_FLAG_TO_SCHEME[s[0] as SignatureFlag];
      let pk_bytes = multisig.multisig_pk.pk_map[pk_index as number];
      const PublicKey = scheme === 'ED25519' ? Ed25519PublicKey : Secp256k1PublicKey;

      res[i] = {
          signatureScheme: scheme,
          signature: Uint8Array.from(s.slice(1)),
          pubKey: new PublicKey(pk_bytes.slice(1)),
        };
    }
    return res;
  }

  export function to_serialize_pk_map(pks: PubkeyWeightPair[]): number[][] {
    let res: number[][] = new Array(pks.length);
    for (let i = 0; i < pks.length; i++) {
      let arr = new Uint8Array(pks[i].pubKey.toBytes().length + 1);
      arr.set(pks[i].pubKey.toBytes());
      arr.set([pks[i].weight], pks[i].pubKey.toBytes().length);
      res[i] = Array.from(arr.map((x) => Number(x)));
    }
    return res;
  }