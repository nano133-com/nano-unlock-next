// The Next.js part (App Router, Next.js 15 and 16):
//
//   app/api/unlock/[action]/route.ts   export const { GET, POST } = handlers();
//   a server component                 (await unlocked("post-1")) ? <PaidPart /> : <Unlock item="post-1" price={0.01} />
//
// The paid part is rendered on the server only, after `unlocked`. That function reads the request's cookies,
// so Next.js renders the page for each request and never stores one reader's page for another.

// With the ".js": Node's own module rules need the file's full name, and Next.js has no export map.
import { cookies } from "next/headers.js";
import { readConfig, type Config } from "../config.ts";
import { PASS_COOKIE, hasPass, isItem } from "../pass.ts";

export { Unlock, type UnlockProps } from "./Unlock.tsx";
export { readConfig, type Config, type Problem } from "../config.ts";

/** The owner's settings, read from the environment at the time of the request. */
export const unlockConfig = (): Config => readConfig(process.env);

/** Whether this reader holds a valid pass for `item`. False while a setting is absent or wrong. */
export async function unlocked(item: string): Promise<boolean> {
  const jar = await cookies();
  const config = unlockConfig();
  if (!config.ok || !isItem(item)) return false;
  return hasPass(config.settings.secret, jar.get(PASS_COOKIE)?.value, item);
}

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * Refuses a request that another site's page sent. A browser marks such a request with Sec-Fetch-Site; our own
 * page sends JSON, which a cross-site form cannot.
 */
function fromOtherSite(request: Request): Response | null {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return json(403, { error: "this request came from another site" });
  if (request.method !== "GET" && !(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json(415, { error: "send JSON" });
  return null;
}

type Context = { params: Promise<{ action?: string }> };

/** The route handlers of `app/api/unlock/[action]/route.ts`. */
export function handlers() {
  async function GET(_request: Request, context: Context) {
    const { action } = await context.params;
    if (action !== "status") return json(404, { error: "not found" });
    const config = unlockConfig();
    // Only the names of the settings with a problem: never a value.
    return json(200, config.ok ? { ready: true } : { ready: false, settings: config.problems.map((p) => p.setting) });
  }

  async function POST(request: Request, context: Context) {
    const refused = fromOtherSite(request);
    if (refused) return refused;
    const { action } = await context.params;
    if (action !== "start" && action !== "claim") return json(404, { error: "not found" });
    if (!unlockConfig().ok) return json(503, { error: "This site is not ready to take payments yet." });
    // HOLD (PLAN.md 2a): the checkout and the claim are a money rule that waits for its "go". Until then this
    // build starts no checkout, shows no amount and sets no pass.
    return json(501, { error: "Payments are not switched on in this build." });
  }

  return { GET, POST };
}
