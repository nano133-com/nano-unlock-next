// The XNO/USD rate: the median of the public feeds that answer, so one bad feed cannot move it.
// Taken from @nano133/checkout (rate.ts).

type Feed = { name: string; url: string; read: (j: any) => unknown };

const FEEDS: Feed[] = [
  { name: "coingecko", url: "https://api.coingecko.com/api/v3/simple/price?ids=nano&vs_currencies=usd", read: (j) => j?.nano?.usd },
  { name: "kraken", url: "https://api.kraken.com/0/public/Ticker?pair=NANOUSD", read: (j) => (Object.values(j?.result ?? {})[0] as any)?.c?.[0] },
  { name: "kucoin", url: "https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=XNO-USDT", read: (j) => j?.data?.price },
];

/** Outside this range a rate is a feed error, not a market move. */
const SANE = { min: 0.05, max: 100 };

export type Rate = { usd: number; sources: string[] };

/** Dollars for one XNO, or null when no feed gives a believable rate. */
export async function xnoUsdRate(fetchFn: typeof fetch = globalThis.fetch): Promise<Rate | null> {
  const results = await Promise.allSettled(
    FEEDS.map(async (s) => Number(s.read(await (await fetchFn(s.url, { signal: AbortSignal.timeout(6000), cache: "no-store" })).json()))),
  );
  const good = results
    .map((r, i) => ({ name: FEEDS[i]!.name, v: r.status === "fulfilled" ? r.value : NaN }))
    .filter((x) => Number.isFinite(x.v) && x.v >= SANE.min && x.v <= SANE.max)
    .sort((a, b) => a.v - b.v);
  if (!good.length) return null;
  return { usd: good[Math.floor(good.length / 2)]!.v, sources: good.map((g) => g.name) };
}

const FRESH_MS = 5 * 60_000;
const LAST_GOOD_MS = 24 * 3600_000;
let kept: { rate: Rate; at: number } | null = null;

/**
 * The rate, kept for 5 minutes in this instance's memory. When every feed fails, the last good rate is used
 * for up to a day; with none, null, and no checkout can start.
 */
export async function cachedRate(fetchFn: typeof fetch = globalThis.fetch, now = Date.now()): Promise<Rate | null> {
  if (kept && now - kept.at < FRESH_MS) return kept.rate;
  const rate = await xnoUsdRate(fetchFn).catch(() => null);
  if (rate) kept = { rate, at: now };
  return kept && now - kept.at < LAST_GOOD_MS ? kept.rate : null;
}
