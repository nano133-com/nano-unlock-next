// Signed texts: "this site said this, and it ends at this time". One secret signs every kind, but each kind
// has its own key (derived from the secret) and carries its kind and a version inside the signed part, so a
// text of one kind is never taken for another. Web Crypto only: the same code runs in Node and at the edge.
//
// Form: base64url(JSON claims) "." base64url(HMAC-SHA256 over the first part).

export type Kind = "offer" | "checkout" | "pass";

const VERSION = 1;
/** A secret shorter than this is refused: it would be the weakest part of every signed text. */
export const SECRET_MIN = 32;

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** A secret needs this many different characters: "aaaa…" is long and still no secret. */
const SECRET_DISTINCT = 10;

export function secretProblem(secret: unknown): string | null {
  if (typeof secret !== "string" || secret.length < SECRET_MIN) return `The secret must be ${SECRET_MIN} characters or longer.`;
  if (new Set(secret).size < SECRET_DISTINCT) return "The secret must be random: it repeats too few characters.";
  return null;
}

const hmacKey = (raw: Uint8Array, usages: KeyUsage[]) => crypto.subtle.importKey("raw", raw as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, usages);

const keys = new Map<string, Promise<CryptoKey>>();
/** The key of one kind: HMAC(secret, "nano-unlock/v1/<kind>"). */
function keyFor(secret: string, kind: Kind): Promise<CryptoKey> {
  const problem = secretProblem(secret);
  if (problem) throw new Error(problem);
  const id = `${kind}\n${secret}`;
  let key = keys.get(id);
  if (!key) {
    key = (async () => {
      const master = await hmacKey(enc.encode(secret), ["sign"]);
      const derived = new Uint8Array(await crypto.subtle.sign("HMAC", master, enc.encode(`nano-unlock/v${VERSION}/${kind}`)));
      return hmacKey(derived, ["sign", "verify"]);
    })();
    keys.set(id, key);
  }
  return key;
}

/** Claims that every signed text has: its kind, the version, and its end time (seconds since 1970). */
export type Signed<T> = T & { k: Kind; v: number; exp: number };

/** Signs `claims` as a text of `kind` that ends at `exp` (seconds since 1970). */
export async function sign<T extends object>(secret: string, kind: Kind, claims: T, exp: number): Promise<string> {
  if (!Number.isFinite(exp)) throw new Error("a signed text needs an end time");
  const body = b64url(enc.encode(JSON.stringify({ ...claims, k: kind, v: VERSION, exp: Math.floor(exp) })));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await keyFor(secret, kind), enc.encode(body)));
  return `${body}.${b64url(mac)}`;
}

/**
 * The claims of a text that this secret signed as `kind` and that has not ended, or null for anything else:
 * a forged or changed text, another kind, another version, an ended one. `now` is in milliseconds.
 */
export async function verify<T extends object>(secret: string, kind: Kind, token: unknown, now = Date.now()): Promise<Signed<T> | null> {
  if (typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const mac = unb64url(parts[1]);
  const body = unb64url(parts[0]);
  if (!mac || !body) return null;
  // `verify` compares in constant time.
  if (!(await crypto.subtle.verify("HMAC", await keyFor(secret, kind), mac as BufferSource, enc.encode(parts[0])))) return null;
  try {
    const c = JSON.parse(dec.decode(body)) as Signed<T>;
    if (!c || typeof c !== "object" || c.k !== kind || c.v !== VERSION) return null;
    if (typeof c.exp !== "number" || !(c.exp > now / 1000)) return null;
    return c;
  } catch {
    return null;
  }
}
