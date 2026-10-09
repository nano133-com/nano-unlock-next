// The checkout with no database: the tail, one payment for one checkout, the late payment, the pass.
// Against a mock node on this machine.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { CHECKOUTS_KEPT, LIFE_MS, PAY_MS, TAIL_LIMIT, addCheckout, claimCheckout, makeOffer, memoryLimit, openCheckout, randomTail, readCheckouts, startCheckout, tailOf } from "../src/checkout.ts";
import { PRICE_STEP_RAW, priceRaw } from "../src/amount.ts";
import { PASS_SECONDS, hasPass, latestEnd, makePass } from "../src/pass.ts";
import { sign, verify } from "../src/signed.ts";
import type { Settings } from "../src/config.ts";
import { mockNode, randomAddress, randomHash, sendBlock, type MockNode } from "./helpers.ts";

const SECRET = "test-only-secret-0123456789-abcdefghij-KLMNOP";
const START = Date.UTC(2026, 9, 9, 12, 0, 0);
const MIN = 60_000;
const RATE = 0.9;

let node: MockNode;
let second: MockNode;
const settings: Settings = { address: randomAddress(), secret: SECRET, nodes: [] };

before(async () => {
  node = await mockNode();
  second = await mockNode();
});
after(async () => {
  await node.close();
  await second.close();
});
beforeEach(() => {
  for (const n of [node, second]) {
    n.blocks.clear();
    n.receivable.clear();
    n.history.clear();
    n.calls.length = 0;
    n.down = null;
  }
});

/** A random source that gives these byte rows in order, then fails. */
function rows(...list: number[][]) {
  let i = 0;
  return (bytes: Uint8Array) => {
    const row = list[i++];
    if (!row) throw new Error("no more rows");
    bytes.set(row.slice(0, bytes.length));
  };
}
/** The 9 bytes that hold `n` (67 bits). */
const bytesOf = (n: bigint) => Array.from({ length: 9 }, (_, i) => Number((n >> BigInt(8 * (8 - i))) & 0xffn));

async function start(item: string, usd: number, o: { cookie?: string; now?: number } = {}) {
  const now = o.now ?? START;
  const r = await startCheckout(settings, { offer: await makeOffer(SECRET, { item, usd }, now), cookie: o.cookie ?? "", xnoUsd: RATE, now });
  assert.equal(r.state, "open");
  if (r.state !== "open") throw new Error("unreachable");
  return r;
}
const pay = (amount: string, seenMs: number, to = settings.address) => {
  const hash = randomHash();
  node.blocks.set(hash, sendBlock(to, amount, seenMs));
  node.receivable.set(to, { ...(node.receivable.get(to) ?? {}), [hash]: { amount } });
  return hash;
};
const claim = (token: unknown, o: { hash?: string; now?: number } = {}) => claimCheckout(settings, [node.rpc], { token, hash: o.hash, now: o.now ?? START + MIN });

// ---- The tail ----

test("the tail is a bigint from 1 to below 10^20", () => {
  for (let i = 0; i < 2000; i++) {
    const t = randomTail();
    assert.equal(typeof t, "bigint");
    assert.ok(t >= 1n && t < TAIL_LIMIT, t.toString());
  }
  // Larger than a JavaScript number can hold exactly: most draws are above 2^53.
  let big = 0;
  for (let i = 0; i < 200; i++) if (randomTail() > BigInt(Number.MAX_SAFE_INTEGER)) big++;
  assert.ok(big > 150, `${big} of 200 above 2^53`);
});

test("the tail is drawn evenly: a value outside the range is drawn again, never folded back by a modulo", () => {
  // 10^20 + 5 fits in 67 bits. A modulo would turn it into 5. The rule draws again and takes the next row.
  assert.equal(randomTail(rows(bytesOf(TAIL_LIMIT + 5n), bytesOf(7n))), 7n);
  assert.equal(randomTail(rows(bytesOf(TAIL_LIMIT), bytesOf(TAIL_LIMIT - 1n))), TAIL_LIMIT - 1n);
  // Zero is not a tail.
  assert.equal(randomTail(rows(bytesOf(0n), bytesOf(1n))), 1n);
  // Only 67 bits are read: the top 5 bits of the first byte are dropped, and all ones is outside the range.
  assert.equal(randomTail(rows(Array(9).fill(0xff), [0xf8, 0, 0, 0, 0, 0, 0, 0, 9])), 9n);
  // The spread: the top 4 of 16 equal parts of the range each get draws (a modulo of 2^67 would starve none,
  // but a too-small draw would leave the top parts empty).
  const parts = new Array(16).fill(0);
  for (let i = 0; i < 4000; i++) parts[Number((randomTail() * 16n) / TAIL_LIMIT)]++;
  for (const [i, n] of parts.entries()) assert.ok(n > 150 && n < 350, `part ${i} has ${n} of 4000`);
});

test("an amount is the price plus the tail, as a raw string with every digit", async () => {
  const r = await start("post-1", 0.01);
  const amount = BigInt(r.checkout.amount);
  const price = priceRaw(0.01, RATE);
  assert.equal(typeof r.checkout.amount, "string");
  assert.match(r.checkout.amount, /^\d+$/);
  assert.equal(amount - tailOf(amount), price);
  assert.equal(price % PRICE_STEP_RAW, 0n);
  assert.ok(tailOf(amount) >= 1n && tailOf(amount) < TAIL_LIMIT);
  assert.equal(r.checkout.uri, `nano:${settings.address}?amount=${amount}`);
  assert.equal(r.checkout.xno.replace(".", "").replace(/^0+/, ""), amount.toString().replace(/0+$/, "") || "0");
  assert.equal(r.checkout.payUntil, START + PAY_MS);
});

test("two checkouts never ask the same amount in practice", async () => {
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) seen.add((await start("post-1", 0.01)).checkout.amount);
  assert.equal(seen.size, 300);
});

// ---- The offer and the start ----

test("the price comes from a signed offer: a forged, old or other-kind offer starts nothing", async () => {
  const good = await makeOffer(SECRET, { item: "post-1", usd: 0.5 }, START);
  const go = (offer: unknown, now = START) => startCheckout(settings, { offer, cookie: "", xnoUsd: RATE, now });
  assert.equal((await go(good)).state, "open");
  assert.equal((await go(good, START + 14 * MIN)).state, "open");
  assert.equal((await go(good, START + 16 * MIN)).state, "stale", "an offer ends after 15 minutes");
  assert.equal((await go(good.slice(0, 20) + (good[20] === "A" ? "B" : "A") + good.slice(21))).state, "stale");
  assert.equal((await go(await makeOffer("another-secret-0123456789-abcdefghij-KLMNOP", { item: "post-1", usd: 0.01 }, START))).state, "stale");
  assert.equal((await go(await sign(SECRET, "pass", { item: "post-1", usd: 0.01 }, START / 1000 + 900))).state, "stale");
  assert.equal((await go(await sign(SECRET, "checkout", { item: "post-1", usd: 0.01 }, START / 1000 + 900))).state, "stale");
  assert.equal((await go({ item: "post-1", usd: 0.01 })).state, "stale");
  assert.equal((await go(null)).state, "stale");
  for (const usd of [0, -1, 0.001, 1001, NaN]) await assert.rejects(async () => makeOffer(SECRET, { item: "post-1", usd }, START));
});

test("with no believable rate, no checkout starts", async () => {
  const offer = await makeOffer(SECRET, { item: "post-1", usd: 0.01 }, START);
  for (const xnoUsd of [null, 0, -1]) assert.equal((await startCheckout(settings, { offer, cookie: "", xnoUsd, now: START })).state, "no-rate");
});

test("a new start for the same item gives the same checkout and amount while its pay step is open", async () => {
  const first = await start("post-1", 0.01);
  const again = await start("post-1", 0.01, { cookie: first.cookie, now: START + 10 * MIN });
  assert.equal(again.checkout.id, first.checkout.id);
  assert.equal(again.checkout.amount, first.checkout.amount);
  assert.equal(again.checkout.payUntil, first.checkout.payUntil);

  // Another item, or the same item at another price, is another checkout.
  const other = await start("post-2", 0.01, { cookie: first.cookie });
  assert.notEqual(other.checkout.id, first.checkout.id);
  assert.notEqual((await start("post-1", 0.02, { cookie: first.cookie })).checkout.id, first.checkout.id);

  // After the 15 minutes a start is a new checkout, and the cookie still holds the old one.
  const later = await start("post-1", 0.01, { cookie: first.cookie, now: START + 16 * MIN });
  assert.notEqual(later.checkout.id, first.checkout.id);
  assert.notEqual(later.checkout.amount, first.checkout.amount);
  const kept = await readCheckouts(SECRET, later.cookie, START + 16 * MIN);
  assert.deepEqual(kept.map((c) => c.id), [later.checkout.id, first.checkout.id]);
  assert.equal(await openCheckout(settings, first.cookie, "post-1", START + 16 * MIN), null);
  assert.equal((await openCheckout(settings, first.cookie, "post-1", START + 5 * MIN))?.id, first.checkout.id);
});

test("the cookie keeps the newest open checkouts and drops texts from outside", async () => {
  let cookie = "junk~" + (await sign(SECRET, "pass", { id: "x", item: "a", usd: 1, amount: "1", from: START }, START / 1000 + 900));
  const ids: string[] = [];
  for (let i = 0; i < CHECKOUTS_KEPT + 3; i++) {
    const r = await start(`post-${i}`, 0.01, { cookie, now: START + i * 1000 });
    cookie = r.cookie;
    ids.unshift(r.checkout.id);
  }
  const kept = await readCheckouts(SECRET, cookie, START + MIN);
  assert.deepEqual(kept.map((c) => c.id), ids.slice(0, CHECKOUTS_KEPT));
  assert.ok(cookie.length < 2800, `${cookie.length} bytes`);
  assert.equal(await addCheckout(SECRET, "", "junk", START), "");
});

// ---- The claim ----

test("a payment of the exact amount unlocks its item, and a second claim gives the same pass", async () => {
  const r = await start("post-1", 0.01);
  assert.deepEqual(await claim(r.checkout.token), { state: "waiting" });
  pay(r.checkout.amount, START + 30_000);
  const paid = await claim(r.checkout.token);
  assert.equal(paid.state, "paid");
  if (paid.state !== "paid") return;
  assert.equal(paid.item, "post-1");
  assert.equal(await hasPass(SECRET, paid.pass, "post-1", START + MIN), true);
  assert.equal(await hasPass(SECRET, paid.pass, "post-2", START + MIN), false);

  // A claim 20 hours later is the same pass: the end comes from the checkout's start, not from the claim.
  const later = await claim(r.checkout.token, { now: START + 20 * 3600_000 });
  assert.deepEqual(later, paid);
  assert.equal(await latestEnd(SECRET, paid.pass, START), START / 1000 + PASS_SECONDS);
  assert.equal(paid.pass, await makePass(SECRET, { item: "post-1", cid: r.checkout.id, startedMs: START }));
});

test("one payment fits one checkout and one item", async () => {
  const a = await start("post-1", 0.01);
  const b = await start("post-2", 0.01);
  const hash = pay(a.checkout.amount, START + 30_000);
  assert.equal((await claim(a.checkout.token)).state, "paid");
  assert.equal((await claim(b.checkout.token)).state, "waiting");
  // Naming the other checkout's block does not help.
  assert.equal((await claim(b.checkout.token, { hash })).state, "wrong");
  // A payment of the price with no tail, or one raw beside the amount, fits no checkout.
  for (const amount of [priceRaw(0.01, RATE).toString(), (BigInt(b.checkout.amount) + 1n).toString()]) assert.equal((await claim(b.checkout.token, { hash: pay(amount, START + 30_000) })).state, "wrong");
});

test("an older payment of the same amount is not this checkout's payment", async () => {
  const r = await start("post-1", 0.01);
  const old = pay(r.checkout.amount, START - 10 * MIN);
  assert.equal((await claim(r.checkout.token)).state, "waiting");
  assert.equal((await claim(r.checkout.token, { hash: old })).state, "waiting");
});

test("a late payment counts: after the 15 minutes, inside the 24 hours", async () => {
  const r = await start("post-1", 0.01);
  pay(r.checkout.amount, START + 3 * 3600_000);
  const paid = await claim(r.checkout.token, { now: START + 3 * 3600_000 + MIN });
  assert.equal(paid.state, "paid");
  // And a second checkout for the same item does not take the first one's place: both stay in the cookie.
  const next = await start("post-1", 0.01, { cookie: r.cookie, now: START + 20 * MIN });
  const kept = await readCheckouts(SECRET, next.cookie, START + 21 * MIN);
  assert.equal(kept.length, 2);
  assert.equal((await claim(kept[1]!.token, { now: START + 4 * 3600_000 })).state, "paid");
  assert.equal((await claim(kept[0]!.token, { now: START + 4 * 3600_000 })).state, "waiting");
});

test("after 24 hours the signed checkout is over, paid or not", async () => {
  const r = await start("post-1", 0.01);
  pay(r.checkout.amount, START + 30_000);
  assert.equal((await claim(r.checkout.token, { now: START + LIFE_MS - MIN })).state, "paid");
  assert.equal((await claim(r.checkout.token, { now: START + LIFE_MS + MIN })).state, "expired");
  assert.equal(node.calls.length > 0, true);
  node.calls.length = 0;
  await claim(r.checkout.token, { now: START + LIFE_MS + MIN });
  assert.equal(node.calls.length, 0, "an ended checkout makes no call to the node");
});

test("a lost cookie: the signed checkout alone (the finish-later link) and a pasted block hash unlock", async () => {
  const r = await start("post-1", 0.01);
  const hash = randomHash();
  // The owner's wallet received it long ago, and more than 50 payments came after: no list shows it.
  node.blocks.set(hash, sendBlock(settings.address, r.checkout.amount, START + 5 * MIN));
  assert.equal((await claim(r.checkout.token, { now: START + 2 * 3600_000 })).state, "waiting");
  assert.equal((await claim(r.checkout.token, { hash, now: START + 2 * 3600_000 })).state, "paid");
  assert.equal((await claim(r.checkout.token, { hash: "not a hash" })).state, "invalid");
  assert.equal((await claim(r.checkout.token, { hash: randomHash() })).state, "unknown");
});

test("a forged or changed checkout, or a text of another kind, claims nothing and makes no call to the node", async () => {
  const r = await start("post-1", 0.01);
  pay(r.checkout.amount, START + 30_000);
  const [body] = r.checkout.token.split(".") as [string, string];
  const lower = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), amount: "1" })).toString("base64url");
  const bad: unknown[] = [
    `${lower}.${r.checkout.token.split(".")[1]}`,
    await sign(SECRET, "pass", { id: "x", item: "post-1", usd: 0.01, amount: r.checkout.amount, from: START }, START / 1000 + 3600),
    await sign(SECRET, "offer", { id: "x", item: "post-1", usd: 0.01, amount: r.checkout.amount, from: START }, START / 1000 + 3600),
    await sign("another-secret-0123456789-abcdefghij-KLMNOP", "checkout", { id: "x", item: "post-1", usd: 0.01, amount: r.checkout.amount, from: START }, START / 1000 + 3600),
    await sign(SECRET, "checkout", { id: "x", item: "post-1", usd: 0.01, amount: "not a number", from: START }, START / 1000 + 3600),
    "",
    null,
    { token: r.checkout.token },
  ];
  node.calls.length = 0;
  for (const token of bad) assert.equal((await claim(token)).state, "expired");
  assert.equal(node.calls.length, 0);
  // And a pass is never a checkout, a checkout never a pass.
  assert.equal(await verify(SECRET, "pass", r.checkout.token, START), null);
  assert.equal(await hasPass(SECRET, r.checkout.token, "post-1", START), false);
});

test("a payment that is seen and not confirmed is pending, not paid", async () => {
  const r = await start("post-1", 0.01);
  const hash = pay(r.checkout.amount, START + 30_000);
  node.blocks.set(hash, sendBlock(settings.address, r.checkout.amount, START + 30_000, { confirmed: "false" }));
  assert.deepEqual(await claim(r.checkout.token), { state: "pending" });
});

test("a node that is down throws: no pass", async () => {
  const r = await start("post-1", 0.01);
  pay(r.checkout.amount, START + 30_000);
  node.down = 502;
  await assert.rejects(claim(r.checkout.token));
});

test("with two nodes, a second node that does not agree unlocks nothing", async () => {
  const r = await start("post-1", 0.01);
  const hash = pay(r.checkout.amount, START + 30_000);
  const both = () => claimCheckout(settings, [node.rpc, second.rpc], { token: r.checkout.token, now: START + MIN });
  assert.equal((await both()).state, "pending", "the second node does not know the block yet");
  second.blocks.set(hash, sendBlock(randomAddress(), r.checkout.amount, START + 30_000));
  assert.equal((await both()).state, "disagree");
  second.blocks.set(hash, sendBlock(settings.address, r.checkout.amount, START + 31_000));
  assert.equal((await both()).state, "paid");
});

test("the limit in memory stops a flood for one key and lets other keys pass", () => {
  const allow = memoryLimit(3, 60_000);
  assert.deepEqual([1, 2, 3, 4].map(() => allow("a", START)), [true, true, true, false]);
  assert.equal(allow("b", START), true);
  assert.equal(allow("a", START + 61_000), true);
});
