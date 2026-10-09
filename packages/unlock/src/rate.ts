// The XNO/USD rate: the median of the public feeds that answer, and only when two feeds agree, so one wrong
// feed cannot set the price. Taken from @nano133/checkout (rate.ts), plus the rule of two.

type Feed = { name: string; url: string; read: (j: any) => unknown };

const FEEDS: Feed[] = [
  { name: "coingecko", url: "https://api.coingecko.com/api/v3/simple/price?ids=nano&vs_currencies=usd", read: (j) => j?.nano?.usd },
  { name: "kraken", url: "https://api.kraken.com/0/public/Ticker?pair=NANOUSD", read: (j) => (Object.values(j?.result ?? {})[0] as any)?.c?.[0] },
  { name: "kucoin", url: "https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=XNO-USDT", read: (j) => j?.data?.price },
];

/** Outside this range a rate is a feed error, not a market move. */
const SANE = { min: 0.05, max: 100 };

export type Rate = { usd: number; sources: string[] };

/** Two feeds agree when they differ by this much or less. */
const AGREE = 1.1;

/** Dollars for one XNO, or null when fewer than two feeds give a believable rate that agrees with another. */
export async function xnoUsdRate(fetchFn: typeof fetch = globalThis.fetch): Promise<Rate | null> {
  const results = await Promise.allSettled(
    FEEDS.map(async (s) => Number(s.read(await (await fetchFn(s.url, { signal: AbortSignal.timeout(6000), cache: "no-store" })).json()))),
  );
  const good = results
    .map((r, i) => ({ name: FEEDS[i]!.name, v: r.status === "fulfilled" ? r.value : NaN }))
    .filter((x) => Number.isFinite(x.v) && x.v >= SANE.min && x.v <= SANE.max)
    .sort((a, b) => a.v - b.v);
  // The feeds that have a neighbour within 10%: a lone feed, or one far from the others, is left out.
  const agreed = good.filter((g, i) => (i > 0 && g.v / good[i - 1]!.v <= AGREE) || (i < good.length - 1 && good[i + 1]!.v / g.v <= AGREE));
  if (agreed.length < 2) return null;
  return { usd: agreed[Math.floor(agreed.length / 2)]!.v, sources: agreed.map((g) => g.name) };
}

const FRESH_MS = 5 * 60_000;
const LAST_GOOD_MS = 24 * 3600_000;
let kept: { rate: Rate; at: number } | null = null;

/** The part of a platform cache (the Cache API) that the rate uses. */
export type SharedCache = { match: (key: string) => Promise<Response | undefined>; put: (key: string, value: Response) => Promise<unknown> };
/** A name for the kept rate. It is a key only: nothing is ever fetched from it. */
const SHARED_KEY = "https://nano-unlock.invalid/xno-usd-rate/v1";
/**
 * The platform's own cache, where one exists (`caches.default` on Cloudflare Workers). There an instance lives
 * for a short time, so a rate in memory alone would make most requests ask the 3 feeds again.
 */
const platformCache = (): SharedCache | null => (globalThis as { caches?: { default?: SharedCache } }).caches?.default ?? null;

/** A rate from the shared cache: believed only when it is in the sane range and not older than 5 minutes. */
async function sharedRate(cache: SharedCache, now: number): Promise<{ rate: Rate; at: number } | null> {
  try {
    const j = (await (await cache.match(SHARED_KEY))?.json()) as { usd?: unknown; sources?: unknown; at?: unknown } | undefined;
    if (!j || typeof j.usd !== "number" || typeof j.at !== "number" || !(j.usd >= SANE.min && j.usd <= SANE.max) || !(now - j.at >= 0 && now - j.at < FRESH_MS)) return null;
    return { rate: { usd: j.usd, sources: Array.isArray(j.sources) ? j.sources.map(String).slice(0, 8) : [] }, at: j.at };
  } catch {
    return null;
  }
}

/**
 * The rate, kept for 5 minutes in this instance's memory. When every feed fails, the last good rate is used
 * for up to a day; with none, null, and no checkout can start.
 */
export async function cachedRate(fetchFn: typeof fetch = globalThis.fetch, now = Date.now(), cache: SharedCache | null = platformCache()): Promise<Rate | null> {
  if (kept && now - kept.at < FRESH_MS) return kept.rate;
  const shared = cache ? await sharedRate(cache, now) : null;
  if (shared) {
    kept = shared;
    return kept.rate;
  }
  const rate = await xnoUsdRate(fetchFn).catch(() => null);
  if (rate) {
    kept = { rate, at: now };
    // Kept for the other instances too. A failure here changes nothing: this instance has the rate.
    await cache?.put(SHARED_KEY, new Response(JSON.stringify({ ...rate, at: now }), { headers: { "content-type": "application/json", "cache-control": `max-age=${FRESH_MS / 1000}` } })).catch(() => undefined);
  }
  return kept && now - kept.at < LAST_GOOD_MS ? kept.rate : null;
}

/** For tests: forgets the rate in this instance's memory. */
export function forgetRateForTests() {
  kept = null;
}
