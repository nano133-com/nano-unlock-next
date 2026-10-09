// The payment check, against a mock node on this machine. These are the money rules: a block unlocks only
// when it is a confirmed send of exactly the amount, to the owner's address, first seen inside the time.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { checkBlock, checkPayment } from "../src/payment.ts";
import { isAddress } from "../src/address.ts";
import { blake2b } from "../src/blake2b.ts";
import { createHash } from "node:crypto";
import { mockNode, randomAddress, randomHash, sendBlock, type MockNode } from "./helpers.ts";

const AMOUNT = "28100000000000000000000734201";
const START = Date.UTC(2026, 9, 9, 12, 0, 0);
const window = { from: START, until: START + 15 * 60_000 };

let node: MockNode;
let second: MockNode;
const owner = randomAddress();
const other = randomAddress();

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

const named = (hash: string) => checkBlock(node.rpc, { hash, to: owner, amount: AMOUNT, window });

test("BLAKE2b gives the published digest of 'abc'", () => {
  const hex = Buffer.from(blake2b(new TextEncoder().encode("abc"), 64)).toString("hex");
  assert.equal(hex.slice(0, 32), "ba80a53f981c4d0d6a2797b69f12f6e9");
});

test("the address form agrees with the Nano network's: a vector from outside", () => {
  // The address of the all-zero public key is known to every Nano tool. This file holds no address, so the
  // test holds the SHA-256 of that address's text and compares the one that our code makes.
  const known = "a179a8c88fe63be0dc17454075a9c3570113cff90a081aeace90d8215d7b989b";
  const zero = randomAddress(new Uint8Array(32));
  assert.equal(createHash("sha256").update(zero).digest("hex"), known);
  assert.equal(isAddress(zero), true);
  assert.equal(isAddress(zero.slice(0, -1) + "q"), false);
});

test("an address with one changed character is refused", () => {
  assert.equal(isAddress(owner), true);
  const at = 20;
  const typo = owner.slice(0, at) + (owner[at] === "1" ? "3" : "1") + owner.slice(at + 1);
  assert.equal(isAddress(typo), false);
  assert.equal(isAddress(owner.slice(0, -1)), false);
  assert.equal(isAddress(""), false);
});

test("a confirmed send of the exact amount to the owner, inside the time, is paid", async () => {
  const hash = randomHash();
  node.blocks.set(hash, sendBlock(owner, AMOUNT, START + 60_000));
  assert.deepEqual(await named(hash), { state: "paid", hash });
  assert.deepEqual(await named(hash.toLowerCase()), { state: "paid", hash });
});

test("a send that is not confirmed is not paid", async () => {
  const hash = randomHash();
  node.blocks.set(hash, sendBlock(owner, AMOUNT, START + 60_000, { confirmed: "false" }));
  assert.equal((await named(hash)).state, "unconfirmed");
});

test("a block that is not a send is refused", async () => {
  const hash = randomHash();
  node.blocks.set(hash, sendBlock(owner, AMOUNT, START + 60_000, { subtype: "receive", contents: { subtype: "receive", link_as_account: owner } }));
  assert.equal((await named(hash)).state, "wrong");
});

test("another amount is refused, by one raw more or less", async () => {
  for (const amount of [(BigInt(AMOUNT) + 1n).toString(), (BigInt(AMOUNT) - 1n).toString(), "28100000000000000000000000000"]) {
    const hash = randomHash();
    node.blocks.set(hash, sendBlock(owner, amount, START + 60_000));
    assert.equal((await named(hash)).state, "wrong", amount);
  }
});

test("a send to another address is refused", async () => {
  const hash = randomHash();
  node.blocks.set(hash, sendBlock(other, AMOUNT, START + 60_000));
  assert.equal((await named(hash)).state, "wrong");
});

test("a payment that the node first saw before the start, or after the end, is not this payment", async () => {
  const early = randomHash();
  const late = randomHash();
  node.blocks.set(early, sendBlock(owner, AMOUNT, START - 10 * 60_000));
  node.blocks.set(late, sendBlock(owner, AMOUNT, window.until + 10 * 60_000));
  assert.equal((await named(early)).state, "none");
  assert.equal((await named(late)).state, "none");
});

test("a block with no first-seen time is refused", async () => {
  const hash = randomHash();
  node.blocks.set(hash, sendBlock(owner, AMOUNT, START + 60_000, { local_timestamp: "0" }));
  assert.equal((await named(hash)).state, "none");
  const none = randomHash();
  node.blocks.set(none, { ...sendBlock(owner, AMOUNT, START), local_timestamp: undefined });
  assert.equal((await named(none)).state, "none");
});

test("a hash that is not 64 hex characters never reaches the node", async () => {
  for (const hash of ["", "abc", `${randomHash()}00`, `${randomHash().slice(0, 63)}Z`, '{"$ne":1}']) assert.equal((await named(hash)).state, "invalid");
  assert.equal(node.calls.length, 0);
});

test("a hash that the node does not know is unknown, not paid", async () => {
  assert.equal((await named(randomHash())).state, "unknown");
});

test("a node that is down throws: nothing is unlocked", async () => {
  const hash = randomHash();
  node.blocks.set(hash, sendBlock(owner, AMOUNT, START + 60_000));
  node.down = 503;
  await assert.rejects(named(hash));
  await assert.rejects(checkPayment([node.rpc], { to: owner, amount: AMOUNT, window }));
});

test("a node that answers with a redirect is refused, and the redirect is never followed", async () => {
  const { createServer } = await import("node:http");
  let followed = 0;
  // The place that the redirect points to: a second "node" that would say "paid" for anything.
  const target = createServer((_req, res) => {
    followed++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(sendBlock(owner, AMOUNT, START + 60_000)));
  });
  await new Promise<void>((done) => target.listen(0, "127.0.0.1", done));
  const to = `http://127.0.0.1:${(target.address() as { port: number }).port}/rpc`;
  for (const status of [301, 302, 307, 308]) {
    const redirecting = createServer((_req, res) => {
      res.writeHead(status, { location: to });
      res.end();
    });
    await new Promise<void>((done) => redirecting.listen(0, "127.0.0.1", done));
    const { nodeRpc } = await import("../src/node.ts");
    const rpc = nodeRpc(`http://127.0.0.1:${(redirecting.address() as { port: number }).port}/rpc`);
    await assert.rejects(checkBlock(rpc, { hash: randomHash(), to: owner, amount: AMOUNT, window }), new RegExp(`the node answered ${status}`), `status ${status}`);
    await new Promise<void>((done) => redirecting.close(() => done()));
  }
  assert.equal(followed, 0, "no call reached the place that the redirect named");
  await new Promise<void>((done) => target.close(() => done()));
});

test("with no hash, the search finds a waiting send and a received one, and skips an old one of the same amount", async () => {
  const old = randomHash();
  const fresh = randomHash();
  node.blocks.set(old, sendBlock(owner, AMOUNT, START - 3600_000));
  node.blocks.set(fresh, sendBlock(owner, AMOUNT, START + 30_000));
  node.receivable.set(owner, { [old]: { amount: AMOUNT }, [fresh]: { amount: AMOUNT }, [randomHash()]: { amount: (BigInt(AMOUNT) + 5n).toString() } });
  assert.deepEqual(await checkPayment([node.rpc], { to: owner, amount: AMOUNT, window }), { state: "paid", hash: fresh });

  node.receivable.clear();
  node.history.set(owner, [{ subtype: "receive", amount: AMOUNT, link: fresh }]);
  assert.deepEqual(await checkPayment([node.rpc], { to: owner, amount: AMOUNT, window }), { state: "paid", hash: fresh });

  node.history.clear();
  assert.deepEqual(await checkPayment([node.rpc], { to: owner, amount: AMOUNT, window }), { state: "none" });
});

test("a list entry is only a place to look: the block itself decides", async () => {
  const hash = randomHash();
  // The list says the amount fits, but the block is a send to another address.
  node.receivable.set(owner, { [hash]: { amount: AMOUNT } });
  node.blocks.set(hash, sendBlock(other, AMOUNT, START + 30_000));
  assert.equal((await checkPayment([node.rpc], { to: owner, amount: AMOUNT, window })).state, "none");
});

test("with two nodes, both must say paid for the same block", async () => {
  const hash = randomHash();
  node.blocks.set(hash, sendBlock(owner, AMOUNT, START + 60_000));
  const both = () => checkPayment([node.rpc, second.rpc], { to: owner, amount: AMOUNT, window, hash });

  assert.equal((await both()).state, "unconfirmed", "the second node does not know the block yet");
  second.blocks.set(hash, sendBlock(owner, AMOUNT, START + 60_000, { confirmed: "false" }));
  assert.equal((await both()).state, "unconfirmed");
  second.blocks.set(hash, sendBlock(other, AMOUNT, START + 60_000));
  assert.equal((await both()).state, "disagree");
  second.blocks.set(hash, sendBlock(owner, AMOUNT, START + 61_000));
  assert.deepEqual(await both(), { state: "paid", hash });
  second.down = 500;
  await assert.rejects(both());
});
