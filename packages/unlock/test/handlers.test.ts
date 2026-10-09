// The route handlers, from the request to the cookie: start, pay on the mock node, claim, read. This is the
// path of the money and of the pass through the site.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { handlersWith } from "../src/next/handlers.ts";
import { CHECKOUT_COOKIE, PAY_MS, makeOffer } from "../src/checkout.ts";
import { PASS_COOKIE, hasPass } from "../src/pass.ts";
import type { Config } from "../src/config.ts";
import { mockNode, randomAddress, randomHash, sendBlock, type MockNode } from "./helpers.ts";

const SECRET = "test-only-secret-0123456789-abcdefghij-KLMNOP";
const START = Date.UTC(2026, 9, 9, 12, 0, 0);
const MIN = 60_000;
const address = randomAddress();

let node: MockNode;
let clock = START;
let config: Config;
let route: ReturnType<typeof handlersWith>;

before(async () => {
  node = await mockNode();
  config = { ok: true, settings: { address, secret: SECRET, nodes: ["mock"] } };
  route = handlersWith({ config: () => config, rpc: () => node.rpc, rate: async () => 0.9, now: () => clock });
});
after(() => node.close());

/** A browser: it keeps the cookies that the site sets, by path, and sends them back. */
function browser() {
  const jar = new Map<string, { value: string; path: string; line: string }>();
  const send = async (method: "GET" | "POST", action: string, o: { body?: unknown; query?: string; headers?: Record<string, string> } = {}) => {
    const path = `/api/unlock/${action}`;
    const cookie = [...jar].filter(([, c]) => path.startsWith(c.path)).map(([name, c]) => `${name}=${c.value}`).join("; ");
    const request = new Request(`https://blog.example${path}${o.query ?? ""}`, {
      method,
      headers: { ...(method === "POST" ? { "content-type": "application/json", "sec-fetch-site": "same-origin" } : {}), ...(cookie ? { cookie } : {}), ...o.headers },
      body: method === "POST" ? JSON.stringify(o.body ?? {}) : undefined,
    });
    const res = await (method === "GET" ? route.GET : route.POST)(request, { params: Promise.resolve({ action }) });
    const line = res.headers.get("set-cookie");
    if (line) {
      const [pair, ...rest] = line.split("; ");
      const at = pair!.indexOf("=");
      jar.set(pair!.slice(0, at), { value: pair!.slice(at + 1), path: rest.find((r) => r.startsWith("Path="))!.slice(5), line });
    }
    return { status: res.status, headers: res.headers, json: res.status === 303 ? null : ((await res.json()) as any) };
  };
  return { jar, send };
}

const offer = (item: string, usd = 0.01) => makeOffer(SECRET, { item, usd }, clock);
const pay = (amount: string, to = address) => {
  const hash = randomHash();
  node.blocks.set(hash, sendBlock(to, amount, clock));
  node.receivable.set(to, { ...(node.receivable.get(to) ?? {}), [hash]: { amount } });
  return hash;
};

test("start, pay, claim: the pass arrives with the answer 'paid', in an httpOnly cookie", async () => {
  clock = START;
  const b = browser();
  // A page that just opened, with no checkout in the browser: no call to the node.
  node.calls.length = 0;
  assert.equal((await b.send("POST", "claim", { body: { item: "post-1" } })).json.state, "none");
  assert.equal(node.calls.length, 0);

  const started = await b.send("POST", "start", { body: { offer: await offer("post-1") } });
  assert.equal(started.status, 200);
  const c = started.json.checkout;
  assert.equal(c.to, address);
  assert.equal(c.payUntil, START + PAY_MS);
  assert.equal(started.json.now, START);
  assert.match(b.jar.get(CHECKOUT_COOKIE)!.line, /Path=\/api\/unlock; Max-Age=86400; HttpOnly; SameSite=Lax/);
  assert.equal(typeof c.token, "string");

  clock = START + MIN;
  const waiting = await b.send("POST", "claim", { body: { item: "post-1", co: c.token } });
  assert.equal(waiting.json.state, "waiting");
  assert.equal(waiting.json.checkout.id, c.id);
  assert.equal(b.jar.has(PASS_COOKIE), false);

  pay(c.amount);
  const paid = await b.send("POST", "claim", { body: { item: "post-1", co: c.token } });
  assert.deepEqual(paid.json, { state: "paid" });
  const pass = b.jar.get(PASS_COOKIE)!;
  assert.match(pass.line, /Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax/);
  assert.equal(await hasPass(SECRET, pass.value, "post-1", clock), true);
  assert.equal(await hasPass(SECRET, pass.value, "post-2", clock), false);

  // Another browser, with no checkout cookie and no signed checkout, gets nothing from that payment.
  const other = browser();
  assert.equal((await other.send("POST", "claim", { body: { item: "post-1", id: c.id } })).json.state, "none");
  assert.equal((await other.send("POST", "claim", { body: { item: "post-1", co: "forged.text" } })).json.state, "expired");
  assert.equal(other.jar.has(PASS_COOKIE), false);
});

test("a second item adds a second pass and keeps the first", async () => {
  clock = START;
  const b = browser();
  for (const item of ["post-1", "post-2"]) {
    const c = (await b.send("POST", "start", { body: { offer: await offer(item) } })).json.checkout;
    pay(c.amount);
    assert.equal((await b.send("POST", "claim", { body: { item, co: c.token } })).json.state, "paid");
  }
  const value = b.jar.get(PASS_COOKIE)!.value;
  assert.equal(await hasPass(SECRET, value, "post-1", clock), true);
  assert.equal(await hasPass(SECRET, value, "post-2", clock), true);
});

test("a page that opens later finds the late payment of an older checkout", async () => {
  clock = START;
  const b = browser();
  const first = (await b.send("POST", "start", { body: { offer: await offer("post-1") } })).json.checkout;
  clock = START + 20 * MIN;
  const second = (await b.send("POST", "start", { body: { offer: await offer("post-1") } })).json.checkout;
  assert.notEqual(second.id, first.id);
  // The reader's wallet sends the FIRST amount, 2 hours late.
  clock = START + 2 * 3600_000;
  pay(first.amount);
  assert.equal((await b.send("POST", "claim", { body: { item: "post-1" } })).json.state, "paid");
});

test("a payment of an old amount is found without a reload: the question for all checkouts", async () => {
  clock = START;
  const b = browser();
  const first = (await b.send("POST", "start", { body: { offer: await offer("post-1") } })).json.checkout;
  clock = START + 20 * MIN;
  const second = (await b.send("POST", "start", { body: { offer: await offer("post-1") } })).json.checkout;
  clock = START + 21 * MIN;
  pay(first.amount);
  // The page's normal question names its own (new) checkout: not paid.
  assert.equal((await b.send("POST", "claim", { body: { item: "post-1", co: second.token } })).json.state, "waiting");
  // Each fifth question, and "I paid", ask for all of the browser's checkouts of the item.
  assert.equal((await b.send("POST", "claim", { body: { item: "post-1", co: second.token, all: true } })).json.state, "paid");
});

test("the page's own signed checkout is enough: a lost cookie does not hide a payment", async () => {
  clock = START;
  const b = browser();
  const c = (await b.send("POST", "start", { body: { offer: await offer("post-1") } })).json.checkout;
  b.jar.clear();
  pay(c.amount);
  clock = START + MIN;
  assert.equal((await b.send("POST", "claim", { body: { item: "post-1", co: c.token } })).json.state, "paid");
  assert.equal(await hasPass(SECRET, b.jar.get(PASS_COOKIE)!.value, "post-1", clock), true);
});

test("a finish-later link in another browser: it only asks, and a pasted hash unlocks there", async () => {
  clock = START;
  const b = browser();
  const c = (await b.send("POST", "start", { body: { offer: await offer("post-1") } })).json.checkout;
  const hash = randomHash();
  // Received long ago, with more than 50 payments after it: no list shows it.
  node.blocks.set(hash, sendBlock(address, c.amount, START + 5 * MIN));

  clock = START + 3 * 3600_000;
  const phone = browser();
  const asked = await phone.send("POST", "claim", { body: { item: "post-1", co: c.token } });
  assert.equal(asked.json.state, "waiting");
  assert.equal(asked.json.checkout, null, "a link's checkout is never a pay step");
  assert.equal(phone.jar.size, 0, "a link's checkout never enters the cookie");
  assert.equal((await phone.send("POST", "claim", { body: { item: "post-1", co: c.token, hash } })).json.state, "paid");
  assert.equal(await hasPass(SECRET, phone.jar.get(PASS_COOKIE)!.value, "post-1", clock), true);
  assert.equal(phone.jar.has(CHECKOUT_COOKIE), false);
});

test("a link from another person cannot remove, replace or stand in for the reader's open checkout", async () => {
  clock = START;
  const stranger = browser();
  const planted: string[] = [];
  for (let i = 0; i < 12; i++) {
    clock = START + i * 1000 + 16 * MIN * i;
    planted.push((await stranger.send("POST", "start", { body: { offer: await offer("post-1") } })).json.checkout.token);
  }
  clock = START + 4 * 3600_000;
  const reader = browser();
  const own = (await reader.send("POST", "start", { body: { offer: await offer("post-1") } })).json.checkout;
  const before = reader.jar.get(CHECKOUT_COOKIE)!.value;

  // The reader opens the stranger's links, one after the other, and a "chain" of them in one text.
  for (const co of [...planted, planted.join("~")]) {
    const r = await reader.send("POST", "claim", { body: { item: "post-1", co } });
    assert.notEqual(r.json.state, "paid");
    assert.equal(r.headers.get("set-cookie"), null);
    assert.equal(r.json.checkout?.id ?? own.id, own.id, "the pay step stays the reader's own");
  }
  assert.equal(reader.jar.get(CHECKOUT_COOKIE)!.value, before, "the reader's cookie is as it was");

  // A new start still gives the reader's own checkout, not a planted one.
  const again = (await reader.send("POST", "start", { body: { offer: await offer("post-1") } })).json.checkout;
  assert.equal(again.id, own.id);
  assert.equal(again.amount, own.amount);

  // The reader pays the own amount and gets the pass. The stranger's checkouts stay unpaid.
  pay(own.amount);
  assert.equal((await reader.send("POST", "claim", { body: { item: "post-1", co: own.token } })).json.state, "paid");
  assert.equal((await stranger.send("POST", "claim", { body: { item: "post-1", co: planted.at(-1) } })).json.state, "waiting");
  assert.equal(stranger.jar.has(PASS_COOKIE), false);
});

test("a link gives no pass without the block that fits its own checkout", async () => {
  clock = START;
  const a = browser();
  const b = browser();
  const ca = (await a.send("POST", "start", { body: { offer: await offer("post-1") } })).json.checkout;
  const cb = (await b.send("POST", "start", { body: { offer: await offer("post-1") } })).json.checkout;
  const hash = pay(ca.amount);
  clock = START + MIN;
  const third = browser();
  assert.equal((await third.send("POST", "claim", { body: { item: "post-1", co: cb.token } })).json.state, "waiting");
  assert.equal((await third.send("POST", "claim", { body: { item: "post-1", co: cb.token, hash } })).json.state, "wrong");
  // A link for another item opens nothing here.
  assert.equal((await third.send("POST", "claim", { body: { item: "post-2", co: ca.token } })).json.state, "expired");
  assert.equal(third.jar.size, 0);
});

test("a GET changes nothing: there is no route that puts a checkout into a browser", async () => {
  const b = browser();
  for (const action of ["finish", "claim", "start"]) {
    const r = await b.send("GET", action, { query: "?co=x&to=/api/unlock/finish" });
    assert.equal(r.status, 404, action);
    assert.equal(r.headers.get("set-cookie"), null);
  }
});

test("forged texts use no count and reset no count; a true checkout is counted by its id", async () => {
  clock = START + 9 * 3600_000;
  const b = browser();
  const c = (await b.send("POST", "start", { body: { offer: await offer("post-7") } })).json.checkout;
  node.calls.length = 0;
  for (let i = 0; i < 6000; i += 100) assert.equal((await b.send("POST", "claim", { body: { item: "post-7", co: `forged-${i}.${"x".repeat(43)}` } })).json.state, "expired");
  assert.equal(node.calls.length, 0, "a forged text makes no call to the node");
  let slow = 0;
  for (let i = 0; i < 25; i++) if ((await b.send("POST", "claim", { body: { item: "post-7", co: c.token } })).status === 429) slow++;
  assert.equal(slow, 5, "20 questions in a minute for one checkout, then 'slow'");
  clock += 61_000;
  assert.equal((await b.send("POST", "claim", { body: { item: "post-7", co: c.token } })).json.state, "waiting");
});

test("a request from another site, or one that is not JSON, is refused before anything else", async () => {
  const b = browser();
  node.calls.length = 0;
  assert.equal((await b.send("POST", "start", { body: { offer: await offer("post-1") }, headers: { "sec-fetch-site": "cross-site" } })).status, 403);
  assert.equal((await b.send("POST", "claim", { body: { item: "post-1" }, headers: { "sec-fetch-site": "same-site" } })).status, 403);
  assert.equal((await b.send("POST", "start", { body: {}, headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await b.send("POST", "pass", { body: {} })).status, 404);
  assert.equal(b.jar.size, 0);
  assert.equal(node.calls.length, 0);
});

test("an old page's offer answers 'stale', and a price in the request is not read", async () => {
  clock = START;
  const b = browser();
  const old = await offer("post-1");
  clock = START + 16 * MIN;
  const r = await b.send("POST", "start", { body: { offer: old } });
  assert.equal(r.status, 409);
  assert.equal(r.json.state, "stale");
  assert.equal((await b.send("POST", "start", { body: { item: "post-1", usd: 0.01, price: 0.01 } })).status, 409);
  assert.equal(b.jar.size, 0);
});

test("a node that is down answers 'busy' and sets no pass", async () => {
  clock = START;
  const b = browser();
  const c = (await b.send("POST", "start", { body: { offer: await offer("post-9") } })).json.checkout;
  pay(c.amount);
  node.down = 500;
  const r = await b.send("POST", "claim", { body: { item: "post-9", co: c.token } });
  node.down = null;
  assert.equal(r.status, 503);
  assert.equal(r.json.state, "busy");
  assert.equal(b.jar.has(PASS_COOKIE), false);
});

test("the cookies are Secure when the request is https, also on a host with no NODE_ENV (a Worker)", async () => {
  clock = START;
  const flags = async (url: string, mode: string | undefined) => {
    const keep = process.env.NODE_ENV;
    if (mode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = mode;
    try {
      const start = await route.POST(
        new Request(`${url}/api/unlock/start`, { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ offer: await offer(`secure-${Math.random().toString(36).slice(2)}`) }) }),
        { params: Promise.resolve({ action: "start" }) },
      );
      const body = (await start.json()) as { checkout: { item: string; amount: string; token: string } };
      pay(body.checkout.amount);
      const claim = await route.POST(
        new Request(`${url}/api/unlock/claim`, { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ item: body.checkout.item, co: body.checkout.token }) }),
        { params: Promise.resolve({ action: "claim" }) },
      );
      return [start.headers.get("set-cookie") ?? "", claim.headers.get("set-cookie") ?? ""].map((line) => /; Secure$/.test(line));
    } finally {
      if (keep === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = keep;
    }
  };
  // [the checkout cookie, the pass cookie]
  assert.deepEqual(await flags("https://blog.example", undefined), [true, true], "https, no NODE_ENV: a Worker");
  assert.deepEqual(await flags("https://blog.example", "development"), [true, true], "https in development");
  assert.deepEqual(await flags("http://blog.example", "production"), [true, true], "production behind a proxy that passes http on");
  assert.deepEqual(await flags("http://localhost:3000", "development"), [false, false], "a plain-http development server");
  assert.deepEqual(await flags("http://localhost:3000", undefined), [false, false], "plain http and no NODE_ENV");
});

test("with a setting absent or wrong, nothing starts and the status names the setting only", async () => {
  const keep = config;
  config = { ok: false, problems: [{ setting: "NANO_ADDRESS", message: "Set NANO_ADDRESS." }] };
  const b = browser();
  assert.deepEqual((await b.send("GET", "status")).json, { ready: false, settings: ["NANO_ADDRESS"] });
  assert.equal((await b.send("POST", "start", { body: { offer: await offer("post-1") } })).status, 503);
  assert.equal((await b.send("POST", "claim", { body: { item: "post-1" } })).status, 503);
  config = keep;
  assert.deepEqual((await b.send("GET", "status")).json, { ready: true });
});
