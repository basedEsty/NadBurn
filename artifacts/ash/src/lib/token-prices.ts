/**
 * USD price lookup for ERC-20s and native gas tokens, mirroring the shape
 * of `./token-logos.ts`.
 *
 * Source: CoinGecko's free `/simple/*` endpoints. ERC-20 contract prices
 * come from `/simple/token_price/{platform}` (up to 30 contracts per call,
 * batched). Native gas tokens (MON, ETH) come from `/simple/price?ids=…`.
 *
 * Caching:
 *   • In-memory map per (chainId, address) survives across renders.
 *   • localStorage snapshot under a versioned key with a short TTL so we
 *     don't hammer the free-tier endpoints on every refresh.
 *   • A pending fetch is deduplicated so two simultaneous hooks for the
 *     same chain/address set share one network round-trip.
 *
 * Tokens with no price returned simply don't appear in the result map —
 * callers render nothing for them rather than a `$0.00` placeholder.
 */

import { useEffect, useState } from "react";

// Reuse the same chain → CoinGecko platform slug map shape as token-logos
// (deliberately duplicated here so the price layer doesn't have a runtime
// dependency on the logo layer). Slugs verified live 2026-05-01.
const COINGECKO_PLATFORM_BY_CHAIN: Record<number, string | null> = {
  1: "ethereum",
  143: "monad",
  10143: null,
};

// CoinGecko `coins/{id}` slugs for the native gas tokens we support.
// These are the same ids whose images we already use for the native logo
// in `token-logos.ts`.
const COINGECKO_NATIVE_ID_BY_CHAIN: Record<number, string | null> = {
  1: "ethereum",
  143: "monad",
  10143: null,
};

const STORAGE_KEY = "nb_token_price_map_v1";
// 7 minute TTL — long enough that a quick wallet/chain switch reuses the
// last fetch, short enough that prices on the burn confirm dialog never
// look obviously stale.
const TTL_MS = 7 * 60 * 1000;

// How often the hook re-checks freshness while a tab is left open. Set
// well below the TTL so a long-lived tab actually does refetch instead
// of pinning the very first batch's prices forever.
const REVALIDATE_INTERVAL_MS = 60 * 1000;

// CoinGecko `/simple/token_price` accepts up to 30 addresses per call on
// the free tier (and tolerates more, but 30 is the documented sweet spot).
const BATCH_SIZE = 30;

const SIMPLE_TOKEN_PRICE_URL = (platform: string, addresses: string[]) =>
  `https://api.coingecko.com/api/v3/simple/token_price/${platform}` +
  `?contract_addresses=${addresses.join(",")}&vs_currencies=usd`;

const SIMPLE_NATIVE_PRICE_URL = (ids: string[]) =>
  `https://api.coingecko.com/api/v3/simple/price` +
  `?ids=${ids.join(",")}&vs_currencies=usd`;

// In-memory map: "chainId:lowercaseAddress" → usd price.
// "native" rows are stored under "chainId:native".
//
// Each entry's fetch timestamp lives in `priceFetchedAt` so the freshness
// check in `ensurePrices()` works for the in-memory cache too — without
// it, the very first fetch in a tab would pin prices forever even though
// the on-disk localStorage snapshot has a TTL.
const priceMap = new Map<string, number>();
const priceFetchedAt = new Map<string, number>();

interface CachedEntry {
  usd: number;
  at: number;
}

interface CachedShape {
  // Kept for backwards compatibility with the v1 disk format that only
  // had a single top-level timestamp; ignored when `entries` carries
  // per-entry timestamps.
  at?: number;
  entries: [string, number | CachedEntry][];
}

function key(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`;
}

function isFresh(k: string): boolean {
  const at = priceFetchedAt.get(k);
  if (typeof at !== "number") return false;
  return Date.now() - at < TTL_MS;
}

function recordPrice(k: string, usd: number, at: number = Date.now()): void {
  priceMap.set(k, usd);
  priceFetchedAt.set(k, at);
}

function readCache(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as CachedShape;
    if (!Array.isArray(parsed?.entries)) return;
    const now = Date.now();
    // Per-entry timestamps mean a long-lived cache can keep fresh entries
    // even after some have aged out — readers see whatever is still inside
    // the TTL window rather than the whole snapshot getting nuked.
    for (const [k, v] of parsed.entries) {
      if (typeof k !== "string") continue;
      if (typeof v === "number") {
        // v1 fallback: stamp every entry with the snapshot's top-level `at`,
        // dropping anything already past TTL at hydration time.
        const at = typeof parsed.at === "number" ? parsed.at : 0;
        if (now - at < TTL_MS) recordPrice(k, v, at);
      } else if (
        v &&
        typeof v.usd === "number" &&
        typeof v.at === "number" &&
        now - v.at < TTL_MS
      ) {
        recordPrice(k, v.usd, v.at);
      }
    }
  } catch {
    // localStorage blocked / malformed — silently skip.
  }
}

function writeCache(): void {
  try {
    const entries: [string, CachedEntry][] = [];
    for (const [k, usd] of priceMap) {
      const at = priceFetchedAt.get(k);
      if (typeof at === "number") entries.push([k, { usd, at }]);
    }
    const payload: CachedShape = { at: Date.now(), entries };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage full / blocked — silently skip.
  }
}

let cacheHydrated = false;
function ensureCacheHydrated(): void {
  if (cacheHydrated) return;
  cacheHydrated = true;
  if (typeof window !== "undefined") readCache();
}

// Dedupe in-flight requests by their cache key. A second caller asking
// for the same set during the same tick reuses the first promise.
const inFlight = new Map<string, Promise<void>>();

async function fetchTokenPriceBatch(
  platform: string,
  chainId: number,
  addresses: string[],
): Promise<void> {
  const url = SIMPLE_TOKEN_PRICE_URL(platform, addresses);
  try {
    const r = await fetch(url, { mode: "cors" });
    if (!r.ok) return;
    const data = (await r.json()) as Record<string, { usd?: number }>;
    for (const [addr, entry] of Object.entries(data)) {
      if (entry && typeof entry.usd === "number" && Number.isFinite(entry.usd)) {
        recordPrice(key(chainId, addr), entry.usd);
      }
    }
  } catch {
    // Network / CORS / rate-limit failure — leave the map alone so the
    // caller's row simply renders without a USD line.
  }
}

async function fetchNativePrices(
  ids: { chainId: number; id: string }[],
): Promise<void> {
  if (ids.length === 0) return;
  const url = SIMPLE_NATIVE_PRICE_URL(ids.map((x) => x.id));
  try {
    const r = await fetch(url, { mode: "cors" });
    if (!r.ok) return;
    const data = (await r.json()) as Record<string, { usd?: number }>;
    for (const { chainId, id } of ids) {
      const usd = data[id]?.usd;
      if (typeof usd === "number" && Number.isFinite(usd)) {
        recordPrice(key(chainId, "native"), usd);
      }
    }
  } catch {
    // Same swallow-and-render-without policy as the ERC-20 branch.
  }
}

/**
 * Imperative fetch: ensures the in-memory + localStorage cache has a
 * recent USD price for the given (chainId, addresses) tuple. Resolves
 * once the network call completes — never throws. Safe to call repeatedly:
 * concurrent calls for the same key collapse onto one fetch.
 */
async function ensurePrices(
  chainId: number,
  addresses: string[],
): Promise<void> {
  ensureCacheHydrated();
  const platform = COINGECKO_PLATFORM_BY_CHAIN[chainId];
  const nativeId = COINGECKO_NATIVE_ID_BY_CHAIN[chainId];

  // Decide what's actually missing from the cache so we don't refetch on
  // every render. An entry counts as fresh only while its per-key
  // timestamp is inside the TTL window — anything older falls back into
  // the "missing" bucket and triggers a real network call. Without this,
  // a long-lived tab would pin its very first prices forever.
  const missingErc20 = addresses.filter(
    (a) =>
      a !== "native" &&
      typeof a === "string" &&
      a.startsWith("0x") &&
      !isFresh(key(chainId, a)),
  );
  const wantNative =
    addresses.includes("native") && !isFresh(key(chainId, "native"));

  const fetches: Promise<void>[] = [];

  if (platform && missingErc20.length > 0) {
    // Batch ERC-20 contract addresses up to BATCH_SIZE per call.
    const batches: string[][] = [];
    for (let i = 0; i < missingErc20.length; i += BATCH_SIZE) {
      batches.push(missingErc20.slice(i, i + BATCH_SIZE));
    }
    for (const batch of batches) {
      const cacheKey = `tp:${chainId}:${batch.join(",")}`;
      let p = inFlight.get(cacheKey);
      if (!p) {
        p = fetchTokenPriceBatch(platform, chainId, batch).finally(() => {
          inFlight.delete(cacheKey);
        });
        inFlight.set(cacheKey, p);
      }
      fetches.push(p);
    }
  }

  if (wantNative && nativeId) {
    const cacheKey = `np:${chainId}:${nativeId}`;
    let p = inFlight.get(cacheKey);
    if (!p) {
      p = fetchNativePrices([{ chainId, id: nativeId }]).finally(() => {
        inFlight.delete(cacheKey);
      });
      inFlight.set(cacheKey, p);
    }
    fetches.push(p);
  }

  if (fetches.length === 0) return;
  await Promise.all(fetches);
  writeCache();
}

/**
 * React hook: returns a `Record<lowercaseAddress, usd>` for the given
 * `(chainId, addresses)`. Addresses missing from CoinGecko simply don't
 * appear in the result. Use the `loading` flag if you want to gate skeleton
 * UI; otherwise it's fine to ignore — the hook re-renders as soon as new
 * prices land.
 *
 * The hook reuses a process-lifetime in-memory cache, so re-mounting a
 * row that has already been priced this session is a synchronous read.
 */
export function useTokenPrices(
  chainId: number | undefined,
  addresses: string[],
): { prices: Record<string, number>; loading: boolean } {
  // Stable derived key so an addresses array with the same contents but a
  // new reference doesn't retrigger the effect on every render.
  const sortedKey = addresses.length === 0 ? "" : [...addresses].sort().join(",");
  const [, force] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!chainId || sortedKey === "") return;
    let cancelled = false;
    const addrs = sortedKey.split(",");

    const run = () => {
      setLoading(true);
      ensurePrices(chainId, addrs)
        .then(() => {
          if (cancelled) return;
          setLoading(false);
          force((n) => n + 1);
        })
        .catch(() => {
          if (!cancelled) setLoading(false);
        });
    };

    run();

    // Periodic revalidation: `ensurePrices` is a no-op for any key still
    // inside the TTL window thanks to `isFresh`, so this is essentially
    // free CPU until TTL elapses, at which point it triggers exactly one
    // CoinGecko round-trip per chain. Keeps long-lived open tabs from
    // showing indefinitely stale prices without us needing a manual
    // wallet/chain switch.
    const interval = window.setInterval(run, REVALIDATE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [chainId, sortedKey]);

  // Build the result map from the current in-memory cache. Re-render is
  // triggered by the `force` bump above once the fetch lands.
  const prices: Record<string, number> = {};
  if (chainId) {
    for (const a of addresses) {
      const v = priceMap.get(key(chainId, a));
      if (typeof v === "number") prices[a.toLowerCase()] = v;
    }
  }
  return { prices, loading };
}

/**
 * Synchronous lookup against the in-memory cache. Useful in non-hook
 * code paths (e.g. building a snapshot at confirm time). Returns
 * `undefined` if the price isn't cached — callers should treat that as
 * "no USD line", same as the hook.
 */
export function getCachedTokenPrice(
  chainId: number,
  address: string,
): number | undefined {
  ensureCacheHydrated();
  return priceMap.get(key(chainId, address));
}

/**
 * Convert a raw token balance + USD unit price into a presentation
 * string. Returns null when the price is unknown so callers can skip
 * rendering instead of showing a misleading `$0.00`.
 *
 *   ≥ $1        → `$1,234.56`
 *   ≥ $0.01     → `$0.1234`
 *   > 0         → `<$0.01`
 *   = 0         → `$0`     (the row is technically priced but the user
 *                            holds none — surfaces a real dust signal
 *                            without claiming bogus precision)
 */
export function formatUsd(
  balance: bigint,
  decimals: number,
  unitPriceUsd: number | undefined,
): string | null {
  if (unitPriceUsd === undefined) return null;
  const amount = Number(balance) / 10 ** decimals;
  if (!Number.isFinite(amount)) return null;
  const usd = amount * unitPriceUsd;
  if (!Number.isFinite(usd)) return null;
  if (usd === 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  if (usd < 1) {
    return `$${usd.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    })}`;
  }
  return `$${usd.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format a precomputed dollar amount (already in USD, no decimals math)
 * for the confirm dialog subtotal. Same thresholds as `formatUsd`.
 */
export function formatUsdAmount(usd: number): string {
  if (!Number.isFinite(usd)) return "$0";
  if (usd === 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  if (usd < 1) {
    return `$${usd.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    })}`;
  }
  return `$${usd.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
