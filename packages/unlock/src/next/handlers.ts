// The route handlers: plain Web `Request` in, `Response` out, with the cookies read and written by hand. So
// they use nothing of Next.js, and a test can call them with a mock node.

import { CHECKOUT_COOKIE, LIFE_MS, claimCheckout, memoryLimit, openCheckout, readCheckouts, startCheckout, type ClaimResult, type OpenCheckout } from "../checkout.ts";
import { readConfig, type Config, type Settings } from "../config.ts";
import { nodeRpc, type Rpc } from "../node.ts";
import { PASS_COOKIE, addPass, isItem, latestEnd } from "../pass.ts";
import { cachedRate } from "../rate.ts";

/** What the handlers need from outside. The defaults are the real ones; a test gives its own. */
export type Deps = {
  config: () => Config;
  /** The call to one node, by its address. */
  rpc: (url: string) => Rpc;
  /** Dollars for one XNO, or null. */
  rate: () => Promise<number | null>;
  now: () => number;
};

const REAL: Deps = { config: () => readConfig(process.env), rpc: (url) => nodeRpc(url), rate: async () => (await cachedRate())?.usd ?? null, now: () => Date.now() };

/** One cookie's value from the request's Cookie header. */
function cookieOf(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

/**
 * Whether the cookies of this answer get `Secure`: the request came by https, or the site runs in production.
 * Either one is enough. A host that sets no NODE_ENV (a Cloudflare Worker) is covered by the first; a host
 * whose own proxy passes the request on as http (so the URL says http) is covered by the second. Only a
 * plain-http development server gets a cookie with no `Secure`, which a browser would otherwise refuse there.
 */
export function secureCookies(request: Request): boolean {
  let https = false;
  try {
    https = new URL(request.url).protocol === "https:";
  } catch {
    /* no URL: decided by the environment */
  }
  return https || (typeof process !== "undefined" && process.env?.NODE_ENV === "production");
}

/** A Set-Cookie line. The values are base64url texts joined by "~": no character needs an escape. */
const setCookie = (name: string, value: string, o: { path: string; maxAge: number; secure: boolean }) =>
  `${name}=${value}; Path=${o.path}; Max-Age=${Math.floor(o.maxAge)}; HttpOnly; SameSite=Lax${o.secure ? "; Secure" : ""}`;

const json = (status: number, body: unknown, cookie?: string) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...(cookie ? { "set-cookie": cookie } : {}) } });

/**
 * Refuses a request that another site's page sent. A browser marks such a request with Sec-Fetch-Site; our own
 * page sends JSON, which a cross-site form cannot.
 */
function fromOtherSite(request: Request): Response | null {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return json(403, { error: "this request came from another site" });
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json(415, { error: "send JSON" });
  return null;
}

/** The open checkouts: sent only to this route, never to a page. */
const checkoutCookie = (request: Request, value: string) => setCookie(CHECKOUT_COOKIE, value, { path: "/api/unlock", maxAge: LIFE_MS / 1000, secure: secureCookies(request) });

/** What the reader's page gets about an open checkout: the public facts and the signed checkout itself. */
const forPage = (c: OpenCheckout) => ({ id: c.id, item: c.item, to: c.to, amount: c.amount, xno: c.xno, uri: c.uri, payUntil: c.payUntil, token: c.token });

// Best-effort limits in this instance's memory (see `memoryLimit`): a slow-down, not a true rate limit.
const startsAllowed = memoryLimit(300, 60_000);
/**
 * Questions to the node in one minute, for one instance. One question about one checkout is 2 calls to the
 * node, and the default node allows about 120 calls a minute for one address: so the default is 50. An owner
 * with an own node sets UNLOCK_CLAIMS_PER_MINUTE higher.
 */
const claimsLimit = () => {
  const n = Number(process.env.UNLOCK_CLAIMS_PER_MINUTE);
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : 50;
};
let claimsAllowed = memoryLimit(claimsLimit(), 60_000);
let claimsAllowedFor = claimsLimit();
const claimsForOne = memoryLimit(20, 60_000);
/** One question looks at this many checkouts at most: the page's own, then the browser's newest of the item. */
const ASK_MOST = 3;

const BUSY = "The network check is busy. Nothing is lost: try again in a moment.";

async function start(request: Request, settings: Settings, deps: Deps) {
  if (!startsAllowed("all")) return json(429, { error: "Too many payments are starting. Wait a minute." });
  const body = (await request.json().catch(() => null)) as { offer?: unknown } | null;
  const result = await startCheckout(settings, { offer: body?.offer, cookie: cookieOf(request, CHECKOUT_COOKIE), xnoUsd: await deps.rate(), now: deps.now() });
  if (result.state === "stale") return json(409, { state: "stale", error: "This page is old. Load it again." });
  if (result.state === "no-rate") return json(503, { state: "no-rate", error: "The price in XNO is not known right now. Try again in a minute." });
  return json(200, { state: "open", now: deps.now(), checkout: forPage(result.checkout) }, checkoutCookie(request, result.cookie));
}

async function claim(request: Request, settings: Settings, deps: Deps) {
  const now = deps.now();
  const body = (await request.json().catch(() => null)) as { item?: unknown; hash?: unknown; co?: unknown; all?: unknown } | null;
  const item = body?.item;
  if (!isItem(item)) return json(400, { error: "no item" });
  const hash = typeof body?.hash === "string" && body.hash ? body.hash.trim() : null;
  const cookie = cookieOf(request, CHECKOUT_COOKIE);

  // Which signed checkouts to look at. First the one that the page sends (`co`): the page holds its own
  // checkout, and a "finish later" link carries one, so a lost or changed cookie cannot hide a payment. Then,
  // for a page that just opened or that asks for all, this browser's newest checkouts of the item: a wallet
  // may have paid an older amount. Each is checked by its signature here, before any count or node call; a
  // checkout from `co` is only looked at, and never enters the cookie.
  const sent = typeof body?.co === "string" && body.co ? (await readCheckouts(settings.secret, body.co, now)).filter((c) => c.item === item).slice(0, 1) : [];
  // A `co` that is forged or over gets no other checkout in its place.
  const mine = !body?.co || body?.all === true ? (await readCheckouts(settings.secret, cookie, now)).filter((c) => c.item === item) : [];
  const asked = [...sent, ...mine.filter((c) => !sent.some((s) => s.id === c.id))].slice(0, ASK_MOST);
  const open = await openCheckout(settings, cookie, item, now);
  const answer = (r: { state: string }) => json(200, { ...r, now, checkout: open ? forPage(open) : null });
  // No valid checkout: nothing to ask the node. (A `co` that is forged or over is "expired" for the page.)
  if (!asked.length) return answer({ state: body?.co ? "expired" : "none" });
  if (claimsAllowedFor !== claimsLimit()) [claimsAllowed, claimsAllowedFor] = [memoryLimit(claimsLimit(), 60_000), claimsLimit()];
  // Counted by the signed checkout's own id, so a forged text can neither use a count nor reset the counts.
  if (!claimsForOne(asked[0]!.id, now) || !asked.every(() => claimsAllowed("all", now))) return json(429, { state: "slow", error: "Many readers pay right now. The check goes on: wait a moment." });
  const tokens = asked.map((c) => c.token);

  const rpcs = settings.nodes.map((url) => deps.rpc(url));
  let last: ClaimResult = { state: "waiting" };
  try {
    for (const token of tokens) {
      const r = await claimCheckout(settings, rpcs, { token, hash, now });
      if (r.state !== "paid") {
        // The first (newest or named) checkout's word is what the page shows.
        if (token === tokens[0]) last = r;
        continue;
      }
      if (r.item !== item) continue;
      const passes = await addPass(settings.secret, cookieOf(request, PASS_COOKIE), r.pass, now);
      const maxAge = Math.max(60, (await latestEnd(settings.secret, passes, now)) - now / 1000);
      // "paid" is said only in the answer that also carries the pass.
      return json(200, { state: "paid" }, setCookie(PASS_COOKIE, passes, { path: "/", maxAge, secure: secureCookies(request) }));
    }
  } catch (e) {
    console.error("nano unlock: the node did not answer", (e as Error)?.message);
    return json(503, { state: "busy", error: BUSY });
  }
  return answer(last);
}

type Context = { params: Promise<{ action?: string }> };

/** The route handlers, with the given outside parts. The package's own `handlers()` uses the real ones. */
export function handlersWith(given: Partial<Deps> = {}) {
  const deps: Deps = { ...REAL, ...given };
  // A GET changes nothing: no cookie, no checkout. (The "finish later" link is the page's own address with the
  // signed checkout after the "#"; the page reads it and asks `claim`.)
  async function GET(_request: Request, context: Context) {
    const { action } = await context.params;
    const config = deps.config();
    // Only the names of the settings with a problem: never a value.
    if (action === "status") return json(200, config.ok ? { ready: true } : { ready: false, settings: config.problems.map((p) => p.setting) });
    return json(404, { error: "not found" });
  }

  async function POST(request: Request, context: Context) {
    const refused = fromOtherSite(request);
    if (refused) return refused;
    const { action } = await context.params;
    if (action !== "start" && action !== "claim") return json(404, { error: "not found" });
    const config = deps.config();
    if (!config.ok) return json(503, { error: "This site is not ready to take payments yet." });
    return action === "start" ? start(request, config.settings, deps) : claim(request, config.settings, deps);
  }

  return { GET, POST };
}
