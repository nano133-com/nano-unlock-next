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
  assert.equal("token" in c, false);

  clock = START + MIN;
  const waiting = await b.send("POST", "claim", { body: { item: "post-1", id: c.id } });
  assert.equal(waiting.json.state, "waiting");
  assert.equal(waiting.json.checkout.id, c.id);
  assert.equal(b.jar.has(PASS_COOKIE), false);

  pay(c.amount);
  const paid = await b.send("POST", "claim", { body: { item: "post-1", id: c.id } });
  assert.deepEqual(paid.json, { state: "paid" });
  const pass = b.jar.get(PASS_COOKIE)!;
  assert.match(pass.line, /Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax/);
  assert.equal(await hasPass(SECRET, pass.value, "post-1", clock), true);
  assert.equal(await hasPass(SECRET, pass.value, "post-2", clock), false);

  // Another browser, with no checkout cookie, gets nothing from that payment.
  const other = browser();
  assert.equal((await other.send("POST", "claim", { body: { item: "post-1", id: c.id } })).json.state, "none");
  assert.equal(other.jar.has(PASS_COOKIE), false);
});

test("a second item adds a second pass and keeps the first", async () => {
  clock = START;
  const b = browser();
  for (const item of ["post-1", "post-2"]) {
    const c = (await b.send("POST", "start", { body: { offer: await offer(item) } })).json.checkout;
    pay(c.amount);
    assert.equal((await b.send("POST", "claim", { body: { item, id: c.id } })).json.state, "paid");
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

test("the finish-later link puts the checkout into another browser, and a pasted hash unlocks there", async () => {
  clock = START;
  const b = browser();
  const c = (await b.send("POST", "start", { body: { offer: await offer("post-1") } })).json.checkout;
  assert.match(c.finish, /^\/api\/unlock\/finish\?co=/);
  const hash = randomHash();
  node.blocks.set(hash, sendBlock(address, c.amount, START + 5 * MIN));

  clock = START + 3 * 3600_000;
  const phone = browser();
  const went = await phone.send("GET", "finish", { query: `${c.finish.slice(c.finish.indexOf("?"))}&to=${encodeURIComponent("/posts/post-1")}` });
  assert.equal(went.status, 303);
  assert.equal(went.headers.get("location"), "/posts/post-1");
  assert.equal(went.headers.get("referrer-policy"), "no-referrer");
  assert.equal((await phone.send("POST", "claim", { body: { item: "post-1" } })).json.state, "waiting");
  assert.equal((await phone.send("POST", "claim", { body: { item: "post-1", hash } })).json.state, "paid");
  assert.equal(await hasPass(SECRET, phone.jar.get(PASS_COOKIE)!.value, "post-1", clock), true);
});

test("the finish-later link goes only to a path of this site", async () => {
  const b = browser();
  for (const to of ["https://evil.example/", "//evil.example", "/\\evil.example", "javascript:alert(1)", "evil"]) {
    const r = await b.send("GET", "finish", { query: `?co=junk&to=${encodeURIComponent(to)}` });
    assert.equal(r.headers.get("location"), "/", to);
    assert.equal(r.headers.get("set-cookie"), null);
  }
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
  const r = await b.send("POST", "claim", { body: { item: "post-9", id: c.id } });
  node.down = null;
  assert.equal(r.status, 503);
  assert.equal(r.json.state, "busy");
  assert.equal(b.jar.has(PASS_COOKIE), false);
});

test("with a setting absent or wrong, nothing starts and the status names the setting only", async () => {
  const keep = config;
  config = { ok: false, problems: [{ setting: "NANO_ADDRESS", message: "Set NANO_ADDRESS." }] };
  const b = browser();
  assert.deepEqual((await b.send("GET", "status")).json, { ready: false, settings: ["NANO_ADDRESS"] });
  assert.equal((await b.send("POST", "start", { body: { offer: await offer("post-1") } })).status, 503);
  assert.equal((await b.send("POST", "claim", { body: { item: "post-1" } })).status, 503);
  assert.equal((await b.send("GET", "finish", { query: "?co=x" })).status, 503);
  config = keep;
  assert.deepEqual((await b.send("GET", "status")).json, { ready: true });
});
