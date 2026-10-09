// A plain Worker for one test: the package's own route handlers on the Workers runtime, with a mock node.
// The settings come in headers of each request (a test only; the real handlers read the environment).
import { handlersWith } from "../../dist/next/handlers.js";
import { makeOffer } from "../../dist/checkout.js";
import { hasPass } from "../../dist/pass.js";
import { nodeRpc } from "../../dist/node.js";

const SECRET = "workerd-core-test-only-0123456789-abcdefghij";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const address = request.headers.get("x-test-address");
    const node = request.headers.get("x-test-node");
    if (url.pathname === "/offer") return Response.json({ offer: await makeOffer(SECRET, { item: url.searchParams.get("item"), usd: 0.01 }) });
    if (url.pathname === "/has") return Response.json({ has: await hasPass(SECRET, request.headers.get("x-pass"), url.searchParams.get("item")) });
    if (url.pathname === "/env") return Response.json({ nodeEnv: typeof process === "undefined" ? "no process" : (process.env?.NODE_ENV ?? "unset"), cache: !!globalThis.caches?.default });
    const route = handlersWith({ config: () => ({ ok: true, settings: { address, secret: SECRET, nodes: [node] } }), rpc: (u) => nodeRpc(u), rate: async () => 0.9 });
    const action = url.pathname.split("/").pop();
    // The test runs on plain http on this machine; a deployed Worker gets https. The test says which one to act as.
    const seen = request.headers.get("x-test-https") ? new Request(request.url.replace(/^http:/, "https:"), request) : request;
    return (request.method === "GET" ? route.GET : route.POST)(seen, { params: Promise.resolve({ action }) });
  },
};
