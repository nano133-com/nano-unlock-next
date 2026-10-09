// The checkout, with no database. One address serves every reader: each checkout asks an exact amount, the
// price plus a random tail, and the tail tells the payments apart. The checkout itself is a signed text that
// the reader's browser holds (an httpOnly cookie); the site keeps nothing.
//
// The rules (PLAN.md 2a):
// - The tail is random below 10^20 raw (at most 0.0000000001 XNO), drawn evenly from a secure source. Two
//   checkouts get the same amount about 1 time in 10^20, so one payment fits one checkout.
// - A payment counts for 24 hours from the checkout's start. The pay step is shown for 15 minutes; after that
//   the reader starts again, and the old checkout still takes its payment.
// - A new start for the same item and price, inside the 15 minutes, gives the same checkout and amount.
// - The pass's end time comes from the checkout's start, so a second claim gives the same pass.
// - Time is the server's and the node's, never the browser's.

import { PRICE_STEP_RAW, nanoUri, priceRaw, toXno } from "./amount.ts";
import type { Settings } from "./config.ts";
import type { Rpc } from "./node.ts";
import { isItem, makePass } from "./pass.ts";
import { checkPayment, type PaymentCheck } from "./payment.ts";
import { sign, verify } from "./signed.ts";

/** The tail is 1 to TAIL_LIMIT - 1 raw. */
export const TAIL_LIMIT = 10n ** 20n;
/** An offer (the item and its price, signed when the page is rendered) is good for this long. */
export const OFFER_SECONDS = 15 * 60;
/** The pay step (the amount, the QR code, the wallet link) is shown for this long. */
export const PAY_MS = 15 * 60_000;
/** A payment counts for this long after the checkout's start. The signed checkout and its cookie live as long. */
export const LIFE_MS = 24 * 3600_000;
export const CHECKOUT_COOKIE = "nano_unlock_co";
/** The cookie keeps this many open checkouts, the newest first. */
export const CHECKOUTS_KEPT = 6;
const SEPARATOR = "~";

type RandomBytes = (bytes: Uint8Array) => unknown;
const secureRandom: RandomBytes = (bytes) => crypto.getRandomValues(bytes);

/**
 * A tail from 1 to TAIL_LIMIT - 1, each value as likely as the next. It draws 67 random bits (the smallest
 * count that covers the range) and draws again when the value is 0 or outside the range: no modulo, which
 * would make the low values more likely.
 */
export function randomTail(random: RandomBytes = secureRandom): bigint {
  const bytes = new Uint8Array(9);
  for (let tries = 0; tries < 1000; tries++) {
    random(bytes);
    let n = BigInt(bytes[0]! & 0x07);
    for (let i = 1; i < 9; i++) n = (n << 8n) | BigInt(bytes[i]!);
    if (n > 0n && n < TAIL_LIMIT) return n;
  }
  throw new Error("the random source gives no usable value");
}

export type OfferClaims = { item: string; usd: number };

/** Signs "this item costs this much", for the page that shows the Unlock button. */
export function makeOffer(secret: string, o: OfferClaims, now = Date.now()): Promise<string> {
  if (!isItem(o.item)) throw new Error("an item name has 1 to 80 letters, digits, dots, colons, dashes or underscores");
  if (!(o.usd >= 0.01 && o.usd <= 1000)) throw new Error("a price is 0.01 to 1000 dollars");
  return sign<OfferClaims>(secret, "offer", { item: o.item, usd: o.usd }, now / 1000 + OFFER_SECONDS);
}

export type CheckoutClaims = {
  /** A random name for this checkout. */
  id: string;
  item: string;
  usd: number;
  /** The exact amount in raw, as a decimal string. */
  amount: string;
  /** The checkout's start, milliseconds since 1970 (the server's clock). */
  from: number;
};

/** What the reader's page may know about an open checkout. */
export type OpenCheckout = {
  id: string;
  item: string;
  /** The owner's address. */
  to: string;
  /** The exact amount in raw. */
  amount: string;
  /** The same amount in XNO, with every digit. */
  xno: string;
  /** A nano: link that a wallet opens with the amount filled in. */
  uri: string;
  /** Until when the pay step is shown (milliseconds since 1970). */
  payUntil: number;
  /** The signed checkout, for a "finish later" link. It holds no secret. */
  token: string;
};

const randomId = (random: RandomBytes) => {
  const bytes = new Uint8Array(12);
  random(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

const split = (cookie: string | null | undefined) => (cookie ? cookie.split(SEPARATOR).filter(Boolean).slice(0, 16) : []);

/** The valid checkouts in a cookie value, the newest first, each with its token. */
export async function readCheckouts(secret: string, cookie: string | null | undefined, now = Date.now()): Promise<(CheckoutClaims & { token: string })[]> {
  const found: (CheckoutClaims & { token: string })[] = [];
  for (const token of split(cookie)) {
    const c = await verify<CheckoutClaims>(secret, "checkout", token, now);
    if (c && !found.some((f) => f.id === c.id)) found.push({ id: c.id, item: c.item, usd: c.usd, amount: c.amount, from: c.from, token });
  }
  return found.sort((a, b) => b.from - a.from);
}

/** The cookie's new value: `token` first, then the other valid checkouts, CHECKOUTS_KEPT at most. */
export async function addCheckout(secret: string, cookie: string | null | undefined, token: string, now = Date.now()): Promise<string> {
  const all = await readCheckouts(secret, [token, ...split(cookie)].join(SEPARATOR), now);
  const first = all.find((c) => c.token === token);
  const rest = all.filter((c) => c !== first);
  return [first, ...rest].filter((c) => !!c).slice(0, CHECKOUTS_KEPT).map((c) => c.token).join(SEPARATOR);
}

const open = (settings: Settings, c: CheckoutClaims & { token: string }): OpenCheckout => ({
  id: c.id,
  item: c.item,
  to: settings.address,
  amount: c.amount,
  xno: toXno(c.amount),
  uri: nanoUri(settings.address, c.amount),
  payUntil: c.from + PAY_MS,
  token: c.token,
});

/** The checkout of `item` whose pay step is still open, if the cookie holds one. */
export async function openCheckout(settings: Settings, cookie: string | null | undefined, item: string, now = Date.now()): Promise<OpenCheckout | null> {
  const c = (await readCheckouts(settings.secret, cookie, now)).find((x) => x.item === item && now < x.from + PAY_MS);
  return c ? open(settings, c) : null;
}

export type StartResult =
  /** The offer is forged, of another kind, or older than 15 minutes: the page must be loaded again. */
  | { state: "stale" }
  /** No believable XNO price is known right now. */
  | { state: "no-rate" }
  | { state: "open"; checkout: OpenCheckout; cookie: string };

/**
 * Starts a checkout for a signed offer, or gives the open one again. The price comes from the offer, which
 * this site signed: never from the request. `xnoUsd` is dollars for one XNO.
 */
export async function startCheckout(
  settings: Settings,
  p: { offer: unknown; cookie: string | null | undefined; xnoUsd: number | null; now?: number; random?: RandomBytes },
): Promise<StartResult> {
  const now = p.now ?? Date.now();
  const random = p.random ?? secureRandom;
  const offer = await verify<OfferClaims>(settings.secret, "offer", p.offer, now);
  if (!offer || !isItem(offer.item) || !(offer.usd >= 0.01 && offer.usd <= 1000)) return { state: "stale" };

  // The same item at the same price, with its pay step still open: the same checkout and the same amount.
  const again = (await readCheckouts(settings.secret, p.cookie, now)).find((c) => c.item === offer.item && c.usd === offer.usd && now < c.from + PAY_MS);
  if (again) return { state: "open", checkout: open(settings, again), cookie: await addCheckout(settings.secret, p.cookie, again.token, now) };

  if (!(p.xnoUsd !== null && p.xnoUsd > 0)) return { state: "no-rate" };
  const amount = priceRaw(offer.usd, p.xnoUsd) + randomTail(random);
  const claims: CheckoutClaims = { id: randomId(random), item: offer.item, usd: offer.usd, amount: amount.toString(), from: now };
  const token = await sign<CheckoutClaims>(settings.secret, "checkout", claims, (now + LIFE_MS) / 1000);
  return { state: "open", checkout: open(settings, { ...claims, token }), cookie: await addCheckout(settings.secret, p.cookie, token, now) };
}

export type ClaimResult =
  | { state: "paid"; item: string; pass: string }
  /** The payment is seen and not yet confirmed. */
  | { state: "pending" }
  | { state: "waiting" }
  /** The signed checkout is not this site's, or its 24 hours are over. */
  | { state: "expired" }
  /** With a named block: it is not this checkout's payment, the hash is not a hash, or the node does not know it. */
  | { state: "wrong" | "invalid" | "unknown" }
  /** Two nodes do not say the same thing. Nothing is unlocked; the owner can settle it. */
  | { state: "disagree" };

const fromCheck = (r: PaymentCheck): Exclude<ClaimResult, { state: "paid" | "expired" }> | null =>
  r.state === "paid" ? null : r.state === "unconfirmed" ? { state: "pending" } : r.state === "none" ? { state: "waiting" } : { state: r.state };

/**
 * Asks the node(s) if one signed checkout is paid, and gives its pass when it is. `hash` names a block to
 * look at (the reader pasted it); with none, the site searches. It throws when a node does not answer: the
 * caller says "busy" and unlocks nothing.
 *
 * The payment's time is tested on the lower side only (the node first saw it at or after the checkout's
 * start). The upper side is this call: it must arrive while the signed checkout is valid.
 */
export async function claimCheckout(settings: Settings, rpcs: Rpc[], p: { token: unknown; hash?: string | null; now?: number }): Promise<ClaimResult> {
  const now = p.now ?? Date.now();
  const c = await verify<CheckoutClaims>(settings.secret, "checkout", p.token, now);
  if (!c || !isItem(c.item) || !/^\d{1,39}$/.test(c.amount) || !(c.from > 0)) return { state: "expired" };
  const result = await checkPayment(rpcs, { to: settings.address, amount: c.amount, window: { from: c.from }, hash: p.hash || null });
  const not = fromCheck(result);
  if (not) return not;
  return { state: "paid", item: c.item, pass: await makePass(settings.secret, { item: c.item, cid: c.id, startedMs: c.from }) };
}

/** The tail of an amount: what is left below the price step. For tests and for the owner's own records. */
export const tailOf = (amount: bigint | string) => BigInt(amount) % PRICE_STEP_RAW;

/**
 * A best-effort limit in this instance's memory: at most `max` calls for one key in `windowMs`. A serverless
 * site has many instances and no shared count, so this slows a flood and is not a true rate limit.
 */
export function memoryLimit(max: number, windowMs: number) {
  const seen = new Map<string, number[]>();
  return (key: string, now = Date.now()): boolean => {
    if (seen.size > 5000) seen.clear();
    const times = (seen.get(key) ?? []).filter((t) => now - t < windowMs);
    if (times.length >= max) {
      seen.set(key, times);
      return false;
    }
    times.push(now);
    seen.set(key, times);
    return true;
  };
}
