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
import { handlersWith } from "./handlers.ts";

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

/** The route handlers of `app/api/unlock/[action]/route.ts`. */
export const handlers = () => handlersWith();
