// The OpenNext adapter's settings for Cloudflare Workers. The blog renders each page for each request (a paid
// part depends on the reader's pass), so it needs no page cache and no store.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
