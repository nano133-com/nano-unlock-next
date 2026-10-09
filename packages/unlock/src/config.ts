// The site owner's settings, from environment variables, and what is wrong with them. The package starts no
// checkout and shows no amount while a problem is open: a reader must never be asked to pay an address that
// is absent or mistyped, or on the word of a test node.

import { isAddress } from "./address.ts";
import { DEFAULT_NODE, nodeProblem } from "./node.ts";
import { secretProblem } from "./signed.ts";

export type Settings = {
  /** The owner's receive address. The package never holds a key for it. */
  address: string;
  /** Signs the offers, the checkouts and the passes. */
  secret: string;
  /** One node, or two that must agree. */
  nodes: string[];
};

export type Problem = { setting: "NANO_ADDRESS" | "UNLOCK_SECRET" | "NANO_NODE_URL" | "NANO_NODE_URL_2"; message: string };

export type Config = { ok: true; settings: Settings } | { ok: false; problems: Problem[] };

type Env = Record<string, string | undefined>;

/** Reads the settings. `ok` only when every one is present and sound. */
export function readConfig(env: Env = process.env): Config {
  const problems: Problem[] = [];
  const address = (env.NANO_ADDRESS ?? "").trim();
  if (!address) problems.push({ setting: "NANO_ADDRESS", message: "Set NANO_ADDRESS to the Nano address that receives the payments." });
  else if (!isAddress(address)) problems.push({ setting: "NANO_ADDRESS", message: "NANO_ADDRESS is not a valid Nano address. Copy it again from your wallet: one wrong character is enough." });

  const secret = (env.UNLOCK_SECRET ?? "").trim();
  if (!secret) problems.push({ setting: "UNLOCK_SECRET", message: "Set UNLOCK_SECRET to a long random text (32 characters or more)." });
  else if (secretProblem(secret)) problems.push({ setting: "UNLOCK_SECRET", message: `UNLOCK_SECRET is not strong enough. ${secretProblem(secret)}` });

  const nodes: string[] = [];
  const first = (env.NANO_NODE_URL ?? "").trim() || DEFAULT_NODE;
  const second = (env.NANO_NODE_URL_2 ?? "").trim();
  const firstProblem = nodeProblem(first);
  if (firstProblem) problems.push({ setting: "NANO_NODE_URL", message: `${firstProblem} A test node cannot see a real payment.` });
  else nodes.push(first);
  if (second) {
    const secondProblem = nodeProblem(second);
    if (secondProblem) problems.push({ setting: "NANO_NODE_URL_2", message: `${secondProblem} A test node cannot see a real payment.` });
    // The same node twice would make "both must agree" an empty rule.
    else if (!firstProblem && new URL(second).host.toLowerCase() === new URL(first).host.toLowerCase())
      problems.push({ setting: "NANO_NODE_URL_2", message: "NANO_NODE_URL_2 is the same node as the first one. Set a different node, or remove it." });
    else nodes.push(second);
  }
  return problems.length ? { ok: false, problems } : { ok: true, settings: { address, secret, nodes } };
}
