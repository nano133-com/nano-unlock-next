// The signed texts and the pass: a pass opens one item, until its end time, and only when this site's
// secret signed it as a pass.

import { test } from "node:test";
import assert from "node:assert/strict";
import { sign, verify, SECRET_MIN } from "../src/signed.ts";
import { PASS_COOKIE_BYTES, PASS_SECONDS, addPass, hasPass, latestEnd, makePass } from "../src/pass.ts";
import { readConfig } from "../src/config.ts";
import { nodeProblem } from "../src/node.ts";
import { xnoUsdRate } from "../src/rate.ts";
import { randomAddress } from "./helpers.ts";

const SECRET = "test-only-secret-0123456789-abcdefghij-KLMNOP";
const OTHER = "test-only-other-9876543210-zyxwvutsrq-ABCDEF";
const START = Date.UTC(2026, 9, 9, 12, 0, 0);
const DAY = 24 * 3600_000;

const pass = (item: string, startedMs = START, cid = "c1") => makePass(SECRET, { item, cid, startedMs });
const flip = (token: string, at: number) => token.slice(0, at) + (token[at] === "A" ? "B" : "A") + token.slice(at + 1);

test("a pass opens its item and no other item", async () => {
  const cookie = await pass("post-1");
  assert.equal(await hasPass(SECRET, cookie, "post-1", START), true);
  assert.equal(await hasPass(SECRET, cookie, "post-2", START), false);
  assert.equal(await hasPass(SECRET, "", "post-1", START), false);
  assert.equal(await hasPass(SECRET, null, "post-1", START), false);
});

test("a pass ends 30 days after the checkout's start, whenever it was claimed", async () => {
  const cookie = await pass("post-1");
  assert.equal(await hasPass(SECRET, cookie, "post-1", START + 30 * DAY - 1000), true);
  assert.equal(await hasPass(SECRET, cookie, "post-1", START + 30 * DAY + 1000), false);
  // The same checkout gives the same pass: a later claim adds no days.
  assert.equal(await pass("post-1"), cookie);
  assert.equal(await latestEnd(SECRET, cookie, START), START / 1000 + PASS_SECONDS);
});

test("a forged or changed pass is refused", async () => {
  const good = await pass("post-1");
  const [body, mac] = good.split(".") as [string, string];
  const bad = [
    await makePass(OTHER, { item: "post-1", cid: "c1", startedMs: START }),
    flip(good, 5),
    flip(good, good.length - 3),
    body,
    `${body}.`,
    `.${mac}`,
    `${body}.${mac}.x`,
    `${Buffer.from(JSON.stringify({ item: "post-1", cid: "c1", k: "pass", v: 1, exp: 9e9 })).toString("base64url")}.${mac}`,
    "x".repeat(3000),
  ];
  for (const token of bad) assert.equal(await hasPass(SECRET, token, "post-1", START), false, token.slice(0, 30));
});

test("a signature has one text only: another last character with the same bytes is refused", async () => {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  for (let i = 0; i < 20; i++) {
    const good = await pass("post-1", START, `c${i}`);
    // The 43rd character of a 32-byte signature holds 4 bits; the 2 spare bits give 3 other texts of the same bytes.
    const last = ALPHABET.indexOf(good.at(-1)!);
    for (const other of [last ^ 1, last ^ 2, last ^ 3]) {
      const twin = good.slice(0, -1) + ALPHABET[other];
      assert.deepEqual(Buffer.from(twin.split(".")[1]!, "base64url"), Buffer.from(good.split(".")[1]!, "base64url"));
      assert.equal(await hasPass(SECRET, twin, "post-1", START), false);
    }
    assert.equal(await hasPass(SECRET, good, "post-1", START), true);
    assert.equal(await hasPass(SECRET, `${good}=`, "post-1", START), false);
  }
});

test("a text of another kind is never a pass, with the same secret and the same claims", async () => {
  const end = START / 1000 + 3600;
  for (const kind of ["offer", "checkout"] as const) {
    const token = await sign(SECRET, kind, { item: "post-1", cid: "c1" }, end);
    assert.equal(await hasPass(SECRET, token, "post-1", START), false);
    assert.equal(await verify(SECRET, "pass", token, START), null);
    assert.notEqual(await verify(SECRET, kind, token, START), null);
  }
  // A claim that names another kind inside the signed part cannot change the kind either.
  const sneaky = await sign(SECRET, "offer", { item: "post-1", cid: "c1", k: "pass" } as object, end);
  assert.equal(await verify(SECRET, "pass", sneaky, START), null);
});

test("a signed text has an end time and is refused after it", async () => {
  const token = await sign(SECRET, "offer", { item: "post-1" }, START / 1000 + 900);
  assert.notEqual(await verify(SECRET, "offer", token, START + 899_000), null);
  assert.equal(await verify(SECRET, "offer", token, START + 901_000), null);
  await assert.rejects(sign(SECRET, "offer", {}, NaN));
});

test("a short or absent secret signs nothing and checks nothing", async () => {
  for (const secret of ["", "short", "x".repeat(SECRET_MIN - 1), "a".repeat(64), "abcabcabc".repeat(8)]) {
    await assert.rejects(makePass(secret, { item: "post-1", cid: "c1", startedMs: START }));
    await assert.rejects(hasPass(secret, await pass("post-1"), "post-1", START));
  }
});

test("the cookie keeps one pass for each item, the newest first, and never grows past its limit", async () => {
  let cookie = "";
  for (let i = 0; i < 60; i++) cookie = await addPass(SECRET, cookie, await pass(`post-${i}`, START, `checkout-${i}`), START);
  assert.ok(cookie.length <= PASS_COOKIE_BYTES, `${cookie.length} bytes`);
  assert.equal(await hasPass(SECRET, cookie, "post-59", START), true, "the newest is kept");
  assert.equal(await hasPass(SECRET, cookie, "post-0", START), false, "the oldest is dropped");
  const count = cookie.split("~").length;
  assert.ok(count >= 15, `${count} passes fit`);

  // The same item again replaces its old pass.
  const again = await addPass(SECRET, cookie, await pass("post-59", START + DAY, "checkout-new"), START + DAY);
  assert.equal(again.split("~").length, count);

  // Texts from outside, and ended passes, are dropped.
  const dirty = await addPass(SECRET, `junk~${await makePass(OTHER, { item: "a", cid: "c", startedMs: START })}~${await pass("old", START - 31 * DAY)}`, await pass("post-1"), START);
  assert.equal(dirty, await pass("post-1"));
});

test("an item name with unsafe characters is refused", async () => {
  for (const item of ["", "a b", "a~b", "a;b", "x".repeat(81)]) {
    await assert.rejects(async () => makePass(SECRET, { item, cid: "c1", startedMs: START }));
    assert.equal(await hasPass(SECRET, await pass("post-1"), item, START), false);
  }
});

test("the settings: no address, a mistyped address, a short secret or a test node stop every checkout", () => {
  const address = randomAddress();
  const good = { NANO_ADDRESS: address, UNLOCK_SECRET: SECRET };
  const ok = readConfig(good);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.settings.nodes, ["https://node.nano133.com/rpc"]);

  const problems = (env: Record<string, string>) => {
    const c = readConfig(env);
    return c.ok ? [] : c.problems.map((p) => p.setting);
  };
  assert.deepEqual(problems({}), ["NANO_ADDRESS", "UNLOCK_SECRET"]);
  assert.deepEqual(problems({ ...good, NANO_ADDRESS: address.slice(0, -1) + (address.endsWith("1") ? "3" : "1") }), ["NANO_ADDRESS"]);
  assert.deepEqual(problems({ ...good, UNLOCK_SECRET: "short" }), ["UNLOCK_SECRET"]);
  for (const node of ["http://node.example.org/rpc", "https://localhost/rpc", "https://127.0.0.1/rpc", "https://10.0.0.5/rpc", "https://192.168.1.9/rpc", "https://node.local/rpc", "https://host.docker.internal/rpc", "https://nodename/rpc", "https://[::1]/rpc", "not a url"])
    assert.deepEqual(problems({ ...good, NANO_NODE_URL: node }), ["NANO_NODE_URL"], node);
  assert.deepEqual(problems({ ...good, NANO_NODE_URL_2: "http://127.0.0.1:7076" }), ["NANO_NODE_URL_2"]);
  assert.deepEqual(problems({ ...good, NANO_NODE_URL_2: "https://NODE.nano133.com/other" }), ["NANO_NODE_URL_2"], "the same node twice");
  assert.deepEqual(problems({ ...good, NANO_NODE_URL_2: "https://rpc.example.org/" }), []);
  assert.equal(nodeProblem("https://rpc.nano.to"), null);
});

test("the rate needs two feeds that agree: one feed alone, or one far from the others, sets no price", async () => {
  // The 3 feeds answer in their own forms; `null` is a feed that fails.
  const feeds = (coingecko: number | null, kraken: number | null, kucoin: number | null) =>
    (async (url: string | URL | Request) => {
      const u = String(url);
      const v = u.includes("coingecko") ? coingecko : u.includes("kraken") ? kraken : kucoin;
      if (v === null) throw new Error("down");
      const body = u.includes("coingecko") ? { nano: { usd: v } } : u.includes("kraken") ? { result: { NANOUSD: { c: [String(v)] } } } : { data: { price: String(v) } };
      return new Response(JSON.stringify(body));
    }) as typeof fetch;
  assert.equal((await xnoUsdRate(feeds(0.9, 0.91, 0.92)))?.usd, 0.91);
  assert.equal((await xnoUsdRate(feeds(0.9, 0.91, null)))?.usd, 0.91);
  assert.equal(await xnoUsdRate(feeds(0.9, null, null)), null, "one feed alone");
  assert.equal(await xnoUsdRate(feeds(null, null, null)), null);
  assert.equal(await xnoUsdRate(feeds(0.9, 9, null)), null, "two feeds that do not agree");
  // One wrong feed (10 times too high, which would make the price 10 times too low) is left out.
  const r = await xnoUsdRate(feeds(0.9, 0.91, 9));
  assert.equal(r?.usd, 0.91);
  assert.deepEqual(r?.sources, ["coingecko", "kraken"]);
  assert.equal((await xnoUsdRate(feeds(0.09, 0.9, 0.91)))?.usd, 0.91);
  assert.equal(await xnoUsdRate(feeds(1000, 0.001, 0.9)), null, "outside the sane range");
});
