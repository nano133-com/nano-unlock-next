// The call to a Nano node, and the check that a node address is a public one.

/** Calls a node's RPC. It rejects when the node does not answer, answers late, or answers `{ error }`. */
export type Rpc = <T>(body: Record<string, unknown>, timeoutMs?: number) => Promise<T>;

export const DEFAULT_NODE = "https://node.nano133.com/rpc";

export function nodeRpc(url: string, fetchFn: typeof fetch = globalThis.fetch): Rpc {
  return async <T>(body: Record<string, unknown>, timeoutMs = 8000) => {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
      // A node address that passed `nodeProblem` must not send the call on to plain http or a private host:
      // a redirect is never followed. "manual" and not "error", because the Cloudflare Workers runtime refuses
      // the value "error". With "manual" the redirect itself is the answer (a 3xx status, or status 0 in a
      // browser), and the next line refuses it as it refuses every answer that is not a success.
      redirect: "manual",
    });
    if (!res.ok) throw new Error(`the node answered ${res.status}`);
    const json = (await res.json()) as { error?: unknown };
    if (json && typeof json === "object" && json.error) throw new Error(String(json.error).slice(0, 200));
    return json as T;
  };
}

const PRIVATE_V4 = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

/**
 * Why this node address cannot prove a real payment, or null when it can. A node on plain http, on this
 * machine or on a private network is a test node: a reader must never be asked to pay on its word.
 */
export function nodeProblem(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "The node address is not a URL.";
  }
  if (u.protocol !== "https:") return "The node address must start with https://.";
  if (u.username || u.password) return "The node address must not hold a user name or a password.";
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host.includes(":")) return "The node address must be a name, not an IPv6 address.";
  if (/^\d+(\.\d+){3}$/.test(host)) return PRIVATE_V4.test(host) ? "The node address is on a private network." : null;
  if (!host.includes(".") || /(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host)) return "The node address is not a public name.";
  return null;
}
