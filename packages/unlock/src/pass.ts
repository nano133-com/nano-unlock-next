// The unlock pass: a signed text that says "the holder may read this item until this time". All of a
// browser's passes share one httpOnly cookie. A pass names the item and the checkout that paid for it, and
// nothing about the reader: no address and no payment.

import { sign, verify } from "./signed.ts";

export const PASS_COOKIE = "nano_unlock";
/** A pass is valid for 30 days from the START of its checkout (never from the time of the claim). */
export const PASS_SECONDS = 30 * 24 * 3600;
/** The cookie keeps the newest passes that fit in this many bytes, so a request never gets too large. */
export const PASS_COOKIE_BYTES = 2800;
const SEPARATOR = "~";

export type PassClaims = { item: string; cid: string };

/** An item's name: short, and of characters that are safe in a cookie and a URL. */
export const isItem = (item: unknown): item is string => typeof item === "string" && /^[A-Za-z0-9._:-]{1,80}$/.test(item);

/**
 * The pass for `item`, paid by the checkout `cid` that started at `startedMs`. The end time depends only on
 * the checkout's start, so a second claim of the same checkout gives the same pass and no extra days.
 */
export function makePass(secret: string, p: { item: string; cid: string; startedMs: number; seconds?: number }): Promise<string> {
  if (!isItem(p.item)) throw new Error("an item name has 1 to 80 letters, digits, dots, colons, dashes or underscores");
  return sign<PassClaims>(secret, "pass", { item: p.item, cid: p.cid }, p.startedMs / 1000 + (p.seconds ?? PASS_SECONDS));
}

const split = (cookie: string | null | undefined) => (cookie ? cookie.split(SEPARATOR).filter(Boolean).slice(0, 64) : []);

/** Whether the cookie holds a valid pass for `item`. */
export async function hasPass(secret: string, cookie: string | null | undefined, item: string, now = Date.now()): Promise<boolean> {
  if (!isItem(item)) return false;
  for (const token of split(cookie)) {
    const c = await verify<PassClaims>(secret, "pass", token, now);
    if (c && c.item === item) return true;
  }
  return false;
}

/**
 * The cookie's new value with `pass` added: the new pass first, then the older ones that are still valid, one
 * for each item, as many as fit in PASS_COOKIE_BYTES (the oldest are dropped). A text that is not a valid
 * pass of this site is dropped, so the cookie cannot grow from outside.
 */
export async function addPass(secret: string, cookie: string | null | undefined, pass: string, now = Date.now()): Promise<string> {
  const kept: string[] = [];
  const items = new Set<string>();
  let size = 0;
  for (const token of [pass, ...split(cookie)]) {
    const c = await verify<PassClaims>(secret, "pass", token, now);
    if (!c || items.has(c.item)) continue;
    if (size + token.length + 1 > PASS_COOKIE_BYTES) break;
    items.add(c.item);
    kept.push(token);
    size += token.length + 1;
  }
  return kept.join(SEPARATOR);
}

/** The latest end time (seconds since 1970) of the passes in a cookie value, for the cookie's own life. */
export async function latestEnd(secret: string, cookie: string, now = Date.now()): Promise<number> {
  let end = 0;
  for (const token of split(cookie)) end = Math.max(end, (await verify<PassClaims>(secret, "pass", token, now))?.exp ?? 0);
  return end;
}
