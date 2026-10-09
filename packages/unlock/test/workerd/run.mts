// The package's own route handlers on the Cloudflare Workers runtime (workerd, started here by wrangler on this
// machine: no login, no deploy), against the mock node: start, claim, the pass, the cookie flags. Run it with
// `npm run test:workers` at the repository's root, after `npm run build`. It needs wrangler, which the
// template's tools bring; the 63 Node tests do not need it.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { mockNode, randomAddress, randomHash, sendBlock } from "../helpers.ts";

/** A free port of this machine. */
const freePort = () =>
  new Promise<number>((done) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => done(port));
    });
  });
const port = await freePort();
const inspector = await freePort();
const here = fileURLToPath(new URL(".", import.meta.url));
// Plain http on this machine. The Worker is told that the reader's request was https (a test header), so the
// cookie flags are the ones of a deployed Worker.
// The tool by its own file, with the config named: `npx` in a workspace starts in the package's folder, not here.
const tool = fileURLToPath(new URL("../../../../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const runtime = spawn(process.execPath, [tool, "dev", "--config", `${here}wrangler.jsonc`, "--port", String(port), "--ip", "127.0.0.1", "--inspector-port", String(inspector)], { cwd: here, stdio: ["ignore", "pipe", "pipe"], detached: true });
let log = "";
runtime.stdout.on("data", (d) => (log += d));
runtime.stderr.on("data", (d) => (log += d));
const stop = () => {
  try {
    // The tool and the runtime that it started: its whole process group.
    process.kill(-runtime.pid!, "SIGTERM");
  } catch {
    /* gone already */
  }
};
process.on("exit", stop);
const B = `http://127.0.0.1:${port}`;
for (let i = 0; ; i++) {
  if (await fetch(`${B}/env`).then((r) => r.ok, () => false)) break;
  if (i > 60) {
    console.log(log.slice(-2000));
    console.log("FAIL the Workers runtime did not start");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
const node = await mockNode();
const address = randomAddress();
const h = { "x-test-address": address, "x-test-node": node.url, "x-test-https": "1" };
const post = async (action: string, body: unknown, cookie = "") => {
  const r = await fetch(`${B}/api/unlock/${action}`, { method: "POST", headers: { ...h, "content-type": "application/json", "sec-fetch-site": "same-origin", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, cookie: r.headers.get("set-cookie") ?? "", json: (await r.json()) as any };
};
let bad = 0;
const check = (ok: boolean, what: string) => { if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"} ${what}`); };
console.log("runtime:", JSON.stringify(await (await fetch(`${B}/env`, { headers: h })).json()));
const { offer } = (await (await fetch(`${B}/offer?item=post-1`, { headers: h })).json()) as { offer: string };
const s = await post("start", { offer });
check(s.status === 200 && s.json.state === "open" && s.json.checkout.to === address && /^\d+$/.test(s.json.checkout.amount), `start on the Workers runtime: an exact amount (${s.json.checkout?.xno})`);
check(/Path=\/api\/unlock; Max-Age=86400; HttpOnly; SameSite=Lax; Secure$/.test(s.cookie), "the checkout cookie is httpOnly, Lax and Secure (https, whatever NODE_ENV says)");
const c = s.json.checkout;
const w = await post("claim", { item: "post-1", co: c.token });
check(w.json.state === "waiting" && node.calls.join() === "receivable,account_history", `claim with no payment: waiting; the node got ${node.calls.join()}`);
const hash = randomHash();
node.blocks.set(hash, sendBlock(address, c.amount, Date.now()));
node.receivable.set(address, { [hash]: { amount: c.amount } });
const wrong = randomHash();
node.blocks.set(wrong, sendBlock(address, (BigInt(c.amount) + 1n).toString(), Date.now()));
check((await post("claim", { item: "post-1", co: c.token, hash: wrong })).json.state === "wrong", "a block of another amount (1 raw more): wrong");
const p = await post("claim", { item: "post-1", co: c.token });
check(p.json.state === "paid" && /^nano_unlock=.*; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax; Secure$/.test(p.cookie), "the payment arrives: paid, and the pass cookie is Secure");
const pass = p.cookie.split(";")[0]!.slice("nano_unlock=".length);
const has = async (item: string, value: string) => ((await (await fetch(`${B}/has?item=${item}`, { headers: { ...h, "x-pass": value } })).json()) as { has: boolean }).has;
check((await has("post-1", pass)) && !(await has("post-2", pass)) && !(await has("post-1", pass.slice(0, -2) + "AA")), "the pass opens its item only, and a changed pass opens nothing (Web Crypto on the runtime)");
node.down = 503;
const busy = await post("claim", { item: "post-1", co: c.token });
node.down = null;
check(busy.status === 503 && busy.json.state === "busy", "a node that is down: busy, no pass");
await node.close();
stop();
console.log(bad ? `${bad} FAILED` : "all passed");
process.exit(bad ? 1 : 0);
