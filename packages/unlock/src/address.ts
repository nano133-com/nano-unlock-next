// A Nano address: "nano_" + 52 characters (the public key) + 8 characters (a checksum of the key). The checksum
// makes a typed error fail here, before any reader is asked to pay an address that nobody holds.

import { blake2b } from "./blake2b.ts";

const ALPHABET = "13456789abcdefghijkmnopqrstuwxyz";
const SHAPE = /^(nano|xrb)_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/;

function decode(text: string): bigint {
  let n = 0n;
  for (const c of text) n = (n << 5n) | BigInt(ALPHABET.indexOf(c));
  return n;
}

/** The 32 bytes of the public key in a well-formed address with a correct checksum, or null. */
export function publicKeyOf(address: unknown): Uint8Array | null {
  if (typeof address !== "string" || !SHAPE.test(address)) return null;
  const body = address.slice(address.indexOf("_") + 1);
  // 52 characters hold 260 bits: 4 zero bits, then the key.
  const keyBits = decode(body.slice(0, 52));
  if (keyBits >> 256n) return null;
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key[31 - i] = Number((keyBits >> BigInt(8 * i)) & 0xffn);
  // The checksum is the 5-byte BLAKE2b of the key, in reverse byte order.
  const digest = blake2b(key, 5);
  let want = 0n;
  for (let i = 4; i >= 0; i--) want = (want << 8n) | BigInt(digest[i]!);
  return decode(body.slice(52)) === want ? key : null;
}

/** True for an address that a wallet can hold: the right shape and a correct checksum. */
export const isAddress = (address: unknown): address is string => publicKeyOf(address) !== null;

/** Two addresses of the same account (the old "xrb_" prefix is the same account). */
export const sameAddress = (a: string, b: string) => a.replace(/^xrb_/, "nano_") === b.replace(/^xrb_/, "nano_");
