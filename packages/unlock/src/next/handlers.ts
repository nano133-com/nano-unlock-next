// The route handlers: plain Web `Request` in, `Response` out, with the cookies read and written by hand. So
// they use nothing of Next.js, and a test can call them with a mock node.

import { CHECKOUT_COOKIE, LIFE_MS, addCheckout, claimCheckout, memoryLimit, openCheckout, readCheckouts, startCheckout, type ClaimResult, type OpenCheckout } from "../checkout.ts";
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

/** A Set-Cookie line. The values are base64url texts joined by "~": no character needs an escape. */
const setCookie = (name: string, value: string, o: { path: string; maxAge: number }) =>
  `${name}=${value}; Path=${o.path}; Max-Age=${Math.floor(o.maxAge)}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

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
const checkoutCookie = (value: string) => setCookie(CHECKOUT_COOKIE, value, { path: "/api/unlock", maxAge: LIFE_MS / 1000 });

/** What the reader's page gets about an open checkout: the public facts and the "finish later" link's query. */
const forPage = (c: OpenCheckout) => ({ id: c.id, item: c.item, to: c.to, amount: c.amount, xno: c.xno, uri: c.uri, payUntil: c.payUntil, finish: `/api/unlock/finish?co=${encodeURIComponent(c.token)}` });

// Best-effort limits in this instance's memory (see `memoryLimit`): a slow-down, not a true rate limit.
const startsAllowed = memoryLimit(300, 60_000);
const claimsAllowed = memoryLimit(1200, 60_000);
const claimsForOne = memoryLimit(30, 60_000);
/** A page that opens with no named checkout looks at this many of the item's checkouts, the newest first. */
const RESUME_MOST = 3;

const BUSY = "The network check is busy. Nothing is lost: try again in a moment.";

async function start(request: Request, settings: Settings, deps: Deps) {
  if (!startsAllowed("all")) return json(429, { error: "Too many payments are starting. Wait a minute." });
  const body = (await request.json().catch(() => null)) as { offer?: unknown } | null;
  const result = await startCheckout(settings, { offer: body?.offer, cookie: cookieOf(request, CHECKOUT_COOKIE), xnoUsd: await deps.rate(), now: deps.now() });
  if (result.state === "stale") return json(409, { state: "stale", error: "This page is old. Load it again." });
  if (result.state === "no-rate") return json(503, { state: "no-rate", error: "The price in XNO is not known right now. Try again in a minute." });
  return json(200, { state: "open", now: deps.now(), checkout: forPage(result.checkout) }, checkoutCookie(result.cookie));
}

async function claim(request: Request, settings: Settings, deps: Deps) {
  const now = deps.now();
  const body = (await request.json().catch(() => null)) as { item?: unknown; id?: unknown; hash?: unknown; co?: unknown } | null;
  const item = body?.item;
  if (!isItem(item)) return json(400, { error: "no item" });
  const hash = typeof body?.hash === "string" && body.hash ? body.hash.trim() : null;
  const cookie = cookieOf(request, CHECKOUT_COOKIE);

  // Which signed checkouts to look at: the one a "finish later" link carried, the one the page names, or
  // (a page that just opened) the item's newest ones in this browser.
  let tokens: string[];
  if (typeof body?.co === "string" && body.co) tokens = [body.co];
  else {
    const mine = (await readCheckouts(settings.secret, cookie, now)).filter((c) => c.item === item);
    tokens = (typeof body?.id === "string" ? mine.filter((c) => c.id === body.id) : mine.slice(0, RESUME_MOST)).map((c) => c.token);
  }
  const open = await openCheckout(settings, cookie, item, now);
  const answer = (r: { state: string }) => json(200, { ...r, now, checkout: open ? forPage(open) : null });
  // No checkout in this browser: nothing to ask the node.
  if (!tokens.length) return answer({ state: "none" });
  if (!claimsAllowed("all") || !claimsForOne(tokens[0]!.slice(-32))) return json(429, { error: "Too many checks. Wait a minute." });

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
      return json(200, { state: "paid" }, setCookie(PASS_COOKIE, passes, { path: "/", maxAge }));
    }
  } catch (e) {
    console.error("nano unlock: the node did not answer", (e as Error)?.message);
    return json(503, { state: "busy", error: BUSY });
  }
  return answer(last);
}

/**
 * The "finish later" link: puts its signed checkout into this browser, then goes to the page with a clean
 * address. The checkout holds no secret, and it unlocks nothing until its own payment is on the network.
 */
async function finish(request: Request, settings: Settings, deps: Deps) {
  const url = new URL(request.url);
  const to = url.searchParams.get("to") ?? "/";
  // A path on this site only: one leading slash, no scheme, no backslash.
  const path = /^\/(?![/\\])[^\\]*$/.test(to) ? to : "/";
  const next = await addCheckout(settings.secret, cookieOf(request, CHECKOUT_COOKIE), url.searchParams.get("co") ?? "", deps.now());
  return new Response(null, { status: 303, headers: { location: path, "cache-control": "no-store", "referrer-policy": "no-referrer", ...(next ? { "set-cookie": checkoutCookie(next) } : {}) } });
}

type Context = { params: Promise<{ action?: string }> };

/** The route handlers, with the given outside parts. The package's own `handlers()` uses the real ones. */
export function handlersWith(given: Partial<Deps> = {}) {
  const deps: Deps = { ...REAL, ...given };
  async function GET(request: Request, context: Context) {
    const { action } = await context.params;
    const config = deps.config();
    // Only the names of the settings with a problem: never a value.
    if (action === "status") return json(200, config.ok ? { ready: true } : { ready: false, settings: config.problems.map((p) => p.setting) });
    if (action === "finish") return config.ok ? finish(request, config.settings, deps) : json(503, { error: "This site is not ready to take payments yet." });
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
