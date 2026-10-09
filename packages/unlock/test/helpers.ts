// Test tools: a mock Nano node on this machine, and addresses made at run time. No address is written in this
// repository: an address in a file can be paid by mistake, and nobody holds the key of a made-up one.

import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { blake2b } from "../src/blake2b.ts";
import { nodeRpc, type Rpc } from "../src/node.ts";
import type { BlockInfo } from "../src/payment.ts";

const ALPHABET = "13456789abcdefghijkmnopqrstuwxyz";

function encode(value: bigint, chars: number): string {
  let s = "";
  for (let i = 0; i < chars; i++) {
    s = ALPHABET[Number(value & 31n)] + s;
    value >>= 5n;
  }
  return s;
}

/** A well-formed address of a random public key. Nobody holds its key: use it on the mock node only. */
export function randomAddress(key: Uint8Array = randomBytes(32)): string {
  let n = 0n;
  for (const b of key) n = (n << 8n) | BigInt(b);
  const digest = blake2b(key, 5);
  let sum = 0n;
  for (let i = 4; i >= 0; i--) sum = (sum << 8n) | BigInt(digest[i]!);
  return `nano_${encode(n, 52)}${encode(sum, 8)}`;
}

export const randomHash = () => randomBytes(32).toString("hex").toUpperCase();

export type MockNode = {
  url: string;
  rpc: Rpc;
  /** The blocks that the node knows, by hash. */
  blocks: Map<string, BlockInfo>;
  /** Sends that wait at an address: hash to amount. */
  receivable: Map<string, Record<string, { amount: string }>>;
  /** An address's history entries, newest first. */
  history: Map<string, { subtype: string; amount: string; link: string }[]>;
  /** Each request's action, in order. */
  calls: string[];
  /** When set, every request gets this HTTP status. */
  down: number | null;
  close: () => Promise<void>;
};

/** A mock node on 127.0.0.1, on a free port that the system picks. */
export async function mockNode(): Promise<MockNode> {
  const node = { blocks: new Map(), receivable: new Map(), history: new Map(), calls: [] as string[], down: null as number | null } as MockNode;
  const server: Server = createServer((req, res) => {
    let text = "";
    req.on("data", (c) => (text += c));
    req.on("end", () => {
      const body = JSON.parse(text || "{}") as Record<string, string>;
      node.calls.push(body.action ?? "");
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      };
      if (node.down) return send(node.down, { error: "down" });
      if (body.action === "block_info") {
        const info = node.blocks.get(String(body.hash).toUpperCase());
        return send(200, info ?? { error: "Block not found" });
      }
      if (body.action === "receivable") return send(200, { blocks: node.receivable.get(body.account ?? "") ?? "" });
      if (body.action === "account_history") return send(200, { history: node.history.get(body.account ?? "") ?? "" });
      return send(200, { error: "action not allowed" });
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  node.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
  node.rpc = nodeRpc(node.url);
  node.close = () => new Promise<void>((done) => server.close(() => done()));
  return node;
}

/** A confirmed send of `amount` to `to`, first seen at `seenMs`, as `block_info` gives it. */
export const sendBlock = (to: string, amount: string, seenMs: number, over: Partial<BlockInfo> = {}): BlockInfo => ({
  amount,
  confirmed: "true",
  local_timestamp: String(Math.floor(seenMs / 1000)),
  subtype: "send",
  contents: { subtype: "send", link_as_account: to },
  ...over,
});
