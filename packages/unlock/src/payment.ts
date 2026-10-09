// The payment check: is this block a confirmed send of exactly this amount to this address, first seen by the
// node inside this time? Every fact comes from the node's own answer for the block (`block_info`). A hash that
// a browser names is only a place to look: nothing that the browser says is believed.
//
// Taken from @nano133/checkout (payment.ts), plus the search of the address's recent history, as the
// WordPress plugin does: a wallet that is open receives a payment in seconds, and it is then no longer in
// the receivable list.

import { sameAddress } from "./address.ts";
import type { Rpc } from "./node.ts";

export type BlockInfo = {
  amount?: string;
  confirmed?: string;
  local_timestamp?: string;
  subtype?: string;
  contents?: { subtype?: string; link_as_account?: string };
};

/** The time in which the node must have first seen the payment (milliseconds). With no `until`, only the lower side is tested. */
export type PaymentWindow = { from: number; until?: number };

export type PaymentCheck =
  | { state: "paid"; hash: string }
  /** Seen, and not yet confirmed by the network. */
  | { state: "unconfirmed"; hash: string }
  /** No payment yet (or one that the node first saw outside the time). */
  | { state: "none" }
  /** The named block is another payment: not a send, another amount or another address. */
  | { state: "wrong" }
  /** The named hash is not 64 hex characters. */
  | { state: "invalid" }
  /** The node does not know the named block (yet). */
  | { state: "unknown" }
  /** Two nodes do not say the same thing. */
  | { state: "disagree" };

/** The node's clock and ours may differ by this much. */
const CLOCK_SLACK_MS = 2 * 60_000;
/** The most entries that the default node's gateway gives for one list. */
const LIST = "50";

const HASH = /^[0-9A-F]{64}$/i;
const RAW = /^\d{1,39}$/;
const notFound = (e: unknown) => /not found/i.test(String((e as Error)?.message ?? e));
const sameRaw = (a: unknown, b: string) => typeof a === "string" && RAW.test(a) && RAW.test(b) && BigInt(a) === BigInt(b);

/** Whether the node first saw the block inside the window. A block with no time is refused. */
export function inWindow(info: BlockInfo, w: PaymentWindow): boolean {
  const seen = Number(info.local_timestamp ?? 0) * 1000;
  if (!(seen > 0)) return false;
  return seen >= w.from - CLOCK_SLACK_MS && (w.until === undefined || seen <= w.until + CLOCK_SLACK_MS);
}

const blockInfo = (rpc: Rpc, hash: string) =>
  rpc<BlockInfo>({ action: "block_info", hash, json_block: "true" }).catch((e) => (notFound(e) ? null : Promise.reject(e)));

/**
 * The send blocks that may be the payment: sends of exactly `amount` that wait at the address, and the
 * sources of receives of exactly `amount` in its recent history. Candidates only; `checkBlock` decides.
 */
export async function findSends(rpc: Rpc, to: string, amount: string): Promise<string[]> {
  const found = new Set<string>();
  const waiting = await rpc<{ blocks?: Record<string, { amount?: string }> | "" }>({ action: "receivable", account: to, count: LIST, source: "true", threshold: amount });
  for (const [hash, v] of Object.entries(waiting.blocks || {})) if (HASH.test(hash) && sameRaw(v?.amount, amount)) found.add(hash.toUpperCase());
  const history = await rpc<{ history?: { subtype?: string; type?: string; amount?: string; link?: string }[] | "" }>({ action: "account_history", account: to, count: LIST, raw: "true" });
  for (const h of history.history || []) {
    const kind = h.subtype ?? h.type;
    if (kind === "receive" && sameRaw(h.amount, amount) && typeof h.link === "string" && HASH.test(h.link)) found.add(h.link.toUpperCase());
  }
  return [...found];
}

/** One node's word on one named block. Throws when the node does not answer (fail closed). */
export async function checkBlock(rpc: Rpc, o: { hash: string; to: string; amount: string; window: PaymentWindow }): Promise<PaymentCheck> {
  if (typeof o.hash !== "string" || !HASH.test(o.hash)) return { state: "invalid" };
  const hash = o.hash.toUpperCase();
  const info = await blockInfo(rpc, hash);
  if (!info) return { state: "unknown" };
  const subtype = info.subtype ?? info.contents?.subtype;
  const dest = info.contents?.link_as_account;
  if (subtype !== "send" || typeof dest !== "string" || !sameAddress(dest, o.to) || !sameRaw(info.amount, o.amount)) return { state: "wrong" };
  if (!inWindow(info, o.window)) return { state: "none" };
  return info.confirmed === "true" ? { state: "paid", hash } : { state: "unconfirmed", hash };
}

/**
 * The payment of `amount` to `to`: the block that was named (`hash`), or, with none, a search at the first
 * node. With two nodes, both must say "paid" for the same block. Throws when a node does not answer.
 */
export async function checkPayment(rpcs: Rpc[], o: { to: string; amount: string; window: PaymentWindow; hash?: string | null }): Promise<PaymentCheck> {
  const [first, ...others] = rpcs;
  if (!first) throw new Error("no node is set");
  let result: PaymentCheck = { state: "none" };
  if (o.hash) result = await checkBlock(first, { ...o, hash: o.hash });
  else {
    for (const hash of await findSends(first, o.to, o.amount)) {
      const r = await checkBlock(first, { ...o, hash });
      if (r.state === "paid") {
        result = r;
        break;
      }
      if (r.state === "unconfirmed") result = r;
    }
  }
  if (result.state !== "paid") return result;
  for (const rpc of others) {
    const second = await checkBlock(rpc, { ...o, hash: result.hash });
    if (second.state === "unconfirmed" || second.state === "unknown") return { state: "unconfirmed", hash: result.hash };
    if (second.state !== "paid") return { state: "disagree" };
  }
  return result;
}
