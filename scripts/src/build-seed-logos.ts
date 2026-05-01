/**
 * Build the bundled "seed" token-logo subset shipped with the Ash artifact.
 *
 * Why: at runtime, `artifacts/ash/src/lib/token-logos.ts` fetches the full
 * Uniswap + CoinGecko per-platform lists (a few hundred KB combined) on
 * first page load. Until those finish, every token row briefly shows the
 * neutral fallback mark even for blue chips like ETH/USDC/USDT/WBTC.
 *
 * Solution: pre-compute a small JSON file containing the top ~50 tokens
 * per supported chain (by global market cap) and ship it inside the
 * bundle. `token-logos.ts` seeds its in-memory map synchronously from this
 * file before kicking off the network fetch, so the most common rows are
 * instantly correct.
 *
 * Data sources:
 *   • CoinGecko `/coins/markets`           — top N by market cap (id, image)
 *   • CoinGecko `/coins/list?include_platform=true`
 *                                          — id → { ethereum: 0x..., monad: 0x..., ... }
 *   • CoinGecko `/{platform}/all.json`     — full per-platform list (used to
 *                                            top up Monad coverage since
 *                                            its mainnet list is small)
 *
 * Output: `artifacts/ash/src/lib/seed-logos.json` — a deduped, deterministic
 * array of `{ chainId, address, logoURI, symbol }` entries. Re-run via
 * `pnpm --filter @workspace/scripts run build-seed-logos`. Output is
 * checked into the repo; this script is not on the build hot path.
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_PATH = path.join(
  REPO_ROOT,
  "artifacts",
  "ash",
  "src",
  "lib",
  "seed-logos.json",
);

// Mirror the chain list in `artifacts/ash/src/lib/token-logos.ts`.
// Keys are CoinGecko `asset_platform_id` values.
const PLATFORM_BY_CHAIN: Record<number, string | null> = {
  1: "ethereum",
  143: "monad",
  10143: null, // Monad testnet — not indexed by CoinGecko.
};

// How many entries to keep per chain from the global market-cap ranking
// (`coins/markets`). After this we top up with hand-curated entries from
// CoinGecko's per-platform list (`{platform}/all.json`).
const TOP_N_FROM_MARKETS = 50;
// Additional entries to pull from the per-platform list on top of the
// market-cap entries. Captures wrapped / chain-specific blue chips
// (WBTC, WETH, stETH, …) that are individually below the global market
// cap cutoff but are very common to see in a wallet on that chain. The
// Monad mainnet list (~70 entries today) is folded in entirely
// regardless of this cap.
const TOP_N_FROM_PLATFORM = 50;

// CoinGecko free public API — no key required. Two cheap calls.
const MARKETS_URL =
  "https://api.coingecko.com/api/v3/coins/markets" +
  "?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false";
const COINS_LIST_URL =
  "https://api.coingecko.com/api/v3/coins/list?include_platform=true";

// Essential tokens that aren't reliably surfaced by `coins/markets`.
// CoinGecko sets `market_cap_rank: null` for canonical wrappers like
// WBTC and WETH because their cap is folded into the underlying asset,
// yet they're the most commonly held ERC-20s on Ethereum. Force-include
// them via a direct `/coins/{id}` lookup. Keep this list short — every
// entry costs one extra API call against CoinGecko's free tier limit.
const ALWAYS_INCLUDE_COIN_IDS: string[] = [
  "wrapped-bitcoin", // WBTC
  "weth", // WETH
];

interface MarketCoin {
  id: string;
  symbol: string;
  name: string;
  image: string;
  market_cap: number | null;
  market_cap_rank: number | null;
}

interface CoinListEntry {
  id: string;
  symbol: string;
  name: string;
  platforms: Record<string, string | null | undefined>;
}

interface PlatformListEntry {
  chainId: number;
  address: string;
  symbol?: string;
  logoURI?: string;
}

interface PlatformList {
  tokens: PlatformListEntry[];
}

interface SeedEntry {
  chainId: number;
  address: string;
  logoURI: string;
  symbol: string;
}

async function getJson<T>(url: string, retries = 3): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (r.ok) return (await r.json()) as T;
    // Back off and retry on transient CoinGecko rate-limit responses.
    if (r.status === 429 && attempt < retries) {
      const waitMs = 8000 * (attempt + 1);
      console.warn(
        `  → 429 rate-limited, retrying in ${waitMs}ms (attempt ${attempt + 1}/${retries})`,
      );
      await new Promise((res) => setTimeout(res, waitMs));
      continue;
    }
    throw new Error(`GET ${url} → ${r.status} ${r.statusText}`);
  }
  throw new Error(`GET ${url} → exhausted retries`);
}

async function main(): Promise<void> {
  console.log("Fetching CoinGecko top markets…");
  const markets = await getJson<MarketCoin[]>(MARKETS_URL);
  console.log(`  → ${markets.length} top coins`);

  console.log("Fetching CoinGecko coin list (with platforms)…");
  const list = await getJson<CoinListEntry[]>(COINS_LIST_URL);
  const byId = new Map<string, CoinListEntry>(list.map((c) => [c.id, c]));
  console.log(`  → ${list.length} indexed coins`);

  // Fetch full coin records for the always-include allowlist so we can
  // pull both their per-platform addresses and their `image.large`
  // logoURI directly. One call per id (a handful), polite rate.
  console.log(`Fetching ${ALWAYS_INCLUDE_COIN_IDS.length} always-include coin records…`);
  interface CoinRecord {
    id: string;
    symbol: string;
    image: { thumb?: string; small?: string; large?: string };
    platforms: Record<string, string | null | undefined>;
  }
  const alwaysInclude: CoinRecord[] = [];
  for (const id of ALWAYS_INCLUDE_COIN_IDS) {
    try {
      const url =
        `https://api.coingecko.com/api/v3/coins/${id}` +
        "?localization=false&tickers=false&market_data=false" +
        "&community_data=false&developer_data=false";
      const rec = await getJson<CoinRecord>(url);
      alwaysInclude.push(rec);
      // Polite delay — CoinGecko's free tier is roughly 10–30 req/min
      // per IP, so 6s between calls keeps us well under the limit.
      await new Promise((r) => setTimeout(r, 6000));
    } catch (err) {
      console.warn(`  → ${id}: ${(err as Error).message}`);
    }
  }
  console.log(`  → fetched ${alwaysInclude.length} always-include records`);

  // Map chainId → ordered SeedEntry[]. Order = market-cap rank, so the
  // most important tokens appear first in the output (purely cosmetic
  // since lookup is by key, but makes diffs reviewable).
  const perChain = new Map<number, SeedEntry[]>();
  for (const cid of Object.keys(PLATFORM_BY_CHAIN).map(Number)) {
    perChain.set(cid, []);
  }

  // Allowlist first — these wrappers always belong in the seed even
  // when their CoinGecko market_cap_rank is null.
  for (const rec of alwaysInclude) {
    const logo = rec.image.large ?? rec.image.small ?? rec.image.thumb;
    if (!logo) continue;
    for (const [chainIdStr, platformSlug] of Object.entries(PLATFORM_BY_CHAIN)) {
      if (!platformSlug) continue;
      const chainId = Number(chainIdStr);
      const address = rec.platforms[platformSlug];
      if (typeof address !== "string" || !address.startsWith("0x")) continue;
      perChain.get(chainId)!.push({
        chainId,
        address: address.toLowerCase(),
        logoURI: logo,
        symbol: rec.symbol.toUpperCase(),
      });
    }
  }

  for (const coin of markets) {
    const platforms = byId.get(coin.id)?.platforms ?? {};
    for (const [chainIdStr, platformSlug] of Object.entries(PLATFORM_BY_CHAIN)) {
      if (!platformSlug) continue;
      const chainId = Number(chainIdStr);
      const bucket = perChain.get(chainId)!;
      if (bucket.length >= TOP_N_FROM_MARKETS) continue;
      const address = platforms[platformSlug];
      if (typeof address !== "string" || !address.startsWith("0x")) continue;
      const addr = address.toLowerCase();
      // Skip if already added by the always-include allowlist above.
      if (bucket.some((e) => e.address === addr)) continue;
      bucket.push({
        chainId,
        address: addr,
        logoURI: coin.image,
        symbol: coin.symbol.toUpperCase(),
      });
    }
  }

  // Top up coverage from the full per-platform list (CoinGecko hosts a
  // dedicated list per platform with hand-vetted logos). For chains with
  // a small list — Monad mainnet today — we fold in the entire thing so
  // every visible token has a logo on first paint, not just the ones in
  // the global top 250.
  for (const [chainIdStr, platformSlug] of Object.entries(PLATFORM_BY_CHAIN)) {
    if (!platformSlug) continue;
    const chainId = Number(chainIdStr);
    const url = `https://tokens.coingecko.com/${platformSlug}/all.json`;
    console.log(`Fetching ${url}…`);
    let platformList: PlatformList;
    try {
      platformList = await getJson<PlatformList>(url);
    } catch (err) {
      console.warn(`  → skipped: ${(err as Error).message}`);
      continue;
    }
    const bucket = perChain.get(chainId)!;
    const seen = new Set(bucket.map((e) => e.address));
    const startSize = bucket.length;
    let added = 0;
    for (const t of platformList.tokens) {
      if (typeof t.address !== "string" || typeof t.logoURI !== "string") continue;
      if (!t.address.startsWith("0x")) continue;
      const addr = t.address.toLowerCase();
      if (seen.has(addr)) continue;
      // Monad mainnet list is small (~70 entries) — fold in everything so
      // every visible token has a logo on first paint. For Ethereum (and
      // any other large chain) the platform list runs into thousands, so
      // cap the top-up at TOP_N_FROM_PLATFORM beyond the seed already
      // contributed by `coins/markets`.
      if (chainId !== 143 && bucket.length - startSize >= TOP_N_FROM_PLATFORM) break;
      bucket.push({
        chainId,
        address: addr,
        logoURI: t.logoURI,
        symbol: (t.symbol ?? "").toUpperCase(),
      });
      seen.add(addr);
      added++;
    }
    console.log(`  → +${added} entries (chain ${chainId}, total ${bucket.length})`);
  }

  const flat: SeedEntry[] = [];
  for (const cid of Object.keys(PLATFORM_BY_CHAIN).map(Number)) {
    flat.push(...(perChain.get(cid) ?? []));
  }

  // Safety net: if we managed to fetch *something* but the result is
  // clearly degraded compared to the file already on disk (CoinGecko
  // partial outage, half the per-platform lists 404'd, etc.), bail out
  // hard rather than silently overwrite the checked-in seed with a
  // worse version. The scheduled regeneration job (.github/workflows/
  // refresh-seed-logos.yml) will turn red so a human can investigate.
  // Use REFRESH_FORCE=1 to override (e.g. for an intentional shrink).
  const force = process.env.REFRESH_FORCE === "1";
  let previous: SeedEntry[] | null = null;
  try {
    previous = JSON.parse(await readFile(OUTPUT_PATH, "utf8")) as SeedEntry[];
  } catch {
    // No existing file — first run, nothing to compare against.
  }
  if (flat.length === 0) {
    throw new Error(
      "Refusing to write seed-logos.json: produced 0 entries. " +
        "CoinGecko likely failed; existing file left untouched.",
    );
  }
  if (previous && previous.length > 0 && !force) {
    // Per-chain check — the most common degraded outcome is "one
    // platform's all.json 404'd", which would zero out a whole chain.
    const prevByChain = new Map<number, number>();
    for (const e of previous) {
      prevByChain.set(e.chainId, (prevByChain.get(e.chainId) ?? 0) + 1);
    }
    const newByChain = new Map<number, number>();
    for (const e of flat) {
      newByChain.set(e.chainId, (newByChain.get(e.chainId) ?? 0) + 1);
    }
    for (const [chainId, prevCount] of prevByChain) {
      if (prevCount === 0) continue;
      const newCount = newByChain.get(chainId) ?? 0;
      // Allow modest churn (tokens move in and out of the top 250) but
      // a >30% drop on any chain is almost certainly a partial fetch
      // failure, not a real ranking change.
      if (newCount < prevCount * 0.7) {
        throw new Error(
          `Refusing to write seed-logos.json: chain ${chainId} shrank from ` +
            `${prevCount} to ${newCount} entries (>30% drop). ` +
            "Likely a partial CoinGecko outage. " +
            "Re-run later, or set REFRESH_FORCE=1 to override.",
        );
      }
    }
    if (flat.length < previous.length * 0.7) {
      throw new Error(
        `Refusing to write seed-logos.json: total shrank from ` +
          `${previous.length} to ${flat.length} entries (>30% drop). ` +
          "Likely a CoinGecko outage. " +
          "Re-run later, or set REFRESH_FORCE=1 to override.",
      );
    }
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  // Pretty-print so PR diffs of the checked-in JSON are reviewable.
  await writeFile(OUTPUT_PATH, JSON.stringify(flat, null, 2) + "\n", "utf8");
  const bytes = Buffer.byteLength(JSON.stringify(flat));
  console.log(
    `\nWrote ${flat.length} entries to ${path.relative(REPO_ROOT, OUTPUT_PATH)} (${bytes} bytes minified)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
