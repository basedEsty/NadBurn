/**
 * Token logo lookup, layered across two official sources:
 *
 *   1. Uniswap default token list — https://tokens.uniswap.org/
 *      ~1,500 hand-curated tokens across 24 chains, each with a `logoURI`
 *      pulled from CoinGecko / TrustWallet / etc. Smaller, higher signal.
 *
 *   2. CoinGecko per-platform token lists —
 *      https://tokens.coingecko.com/{platform}/all.json
 *      ~10k+ tokens per major chain, vetted by the CoinGecko team. CORS-
 *      friendly and bulk-fetched, so no per-coin API rate limits apply.
 *
 * The two are merged into one in-memory map keyed by `chainId:address`.
 * Uniswap wins on address collisions because its list is the more curated
 * of the two. Both fetches run in parallel; either failing independently
 * doesn't block the other.
 *
 * Native gas tokens (MON, ETH) aren't in either list (token lists only
 * cover ERC-20s), so we override with hardcoded official URLs per chain
 * via `NATIVE_LOGO_BY_CHAIN`.
 *
 * Tokens with no match in either source resolve to `null` — the caller
 * is expected to render a neutral mark (see `TokenMark`) instead of any
 * generated / placeholder image. We don't return colorful synthetic
 * avatars from this module so an unknown scam token can never look like
 * it has an "official" identity.
 */

interface TokenListEntry {
  chainId: number;
  address: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  logoURI?: string;
}

interface TokenList {
  tokens: TokenListEntry[];
}

const UNISWAP_LIST_URL = "https://tokens.uniswap.org/";

// CoinGecko's per-platform token list URL pattern. Slugs are CoinGecko's
// "asset_platform_id" values — these are stable and listed at
// https://api.coingecko.com/api/v3/asset_platforms.
//
// Map our supported `chainId`s to their CoinGecko platform slug. For chains
// CoinGecko doesn't index (Monad testnet today), set to `null` and the
// fetch is skipped — the resolver falls back to Uniswap's coverage if any,
// otherwise a neutral mark.
//
// Slugs verified against https://api.coingecko.com/api/v3/asset_platforms
// (look for `chain_identifier === <our chainId>`). Last verified 2026-05-01:
//   • chain 1   → "ethereum"
//   • chain 143 → "monad"   (https://tokens.coingecko.com/monad/all.json
//                            returns ~70 ERC-20s with logos: WMON, USDC,
//                            USDT, WBTC, WETH, aprMON, shMON, …)
//   • chain 10143 (Monad testnet) → not indexed by CoinGecko
const COINGECKO_PLATFORM_BY_CHAIN: Record<number, string | null> = {
  1: "ethereum",
  143: "monad",
  10143: null,
};

function coingeckoListUrl(platform: string): string {
  return `https://tokens.coingecko.com/${platform}/all.json`;
}

// Bumped to v3 (was v2) on 2026-05-01: prior cached entries on Monad
// mainnet (chainId 143) may have been written before the CoinGecko
// "monad" platform list was confirmed available, so any client with a
// stale v2 cache could be missing real logos for WMON/USDC/USDT/etc.
// Bumping the key forces a one-time refetch instead of waiting on the
// 24h TTL.
const STORAGE_KEY = "nb_token_logo_map_v3";
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Native (gas) token logos by chain ID.
// • Monad mainnet (143)  → official Monad Labs "M" mark
// • Monad testnet (10143) → same brand
// • Ethereum mainnet (1) → TrustWallet's ETH icon (canonical, used everywhere)
const NATIVE_LOGO_BY_CHAIN: Record<number, string> = {
  1: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
  143: "https://avatars.githubusercontent.com/u/142404652?s=200",
  10143: "https://avatars.githubusercontent.com/u/142404652?s=200",
};

// Map "chainId:lowercaseAddress" → logoURI
let logoMap: Map<string, string> | null = null;
let inFlight: Promise<Map<string, string>> | null = null;

// Bumped every time `logoMap` is replaced (cache hit, network completion).
// Components subscribe via `useTokenLogosVersion()` so that rows render with
// the neutral fallback first, then deterministically re-render with real
// logos as soon as the lists hydrate — no waiting for an unrelated re-render
// to happen to pick up the new map.
let version = 0;
const listeners = new Set<() => void>();

function bumpVersion(): void {
  version++;
  for (const l of listeners) l();
}

export function subscribeTokenLogos(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTokenLogosVersion(): number {
  return version;
}

function key(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`;
}

// Merge a token list into an existing map. Always overwrites on
// collision — caller controls precedence by ordering the merge calls
// (the last list merged wins).
function mergeList(m: Map<string, string>, list: TokenList): void {
  for (const t of list.tokens) {
    if (typeof t.address !== "string" || typeof t.chainId !== "number") continue;
    if (typeof t.logoURI !== "string" || !t.logoURI) continue;
    m.set(key(t.chainId, t.address), t.logoURI);
  }
}

interface CachedShape {
  at: number;
  entries: [string, string][];
}

function readCache(): Map<string, string> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedShape;
    if (typeof parsed?.at !== "number") return null;
    if (!Array.isArray(parsed.entries)) return null;
    if (Date.now() - parsed.at > TTL_MS) return null;
    return new Map(parsed.entries);
  } catch {
    return null;
  }
}

function writeCache(m: Map<string, string>): void {
  try {
    const payload: CachedShape = { at: Date.now(), entries: Array.from(m) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage full / blocked — silently skip
  }
}

async function fetchList(url: string): Promise<TokenList | null> {
  try {
    const r = await fetch(url, { mode: "cors" });
    if (!r.ok) return null;
    const data = (await r.json()) as TokenList;
    if (!data || !Array.isArray(data.tokens)) return null;
    return data;
  } catch {
    return null;
  }
}

async function ensureLoaded(): Promise<Map<string, string>> {
  if (logoMap) return logoMap;
  const cached = readCache();
  if (cached) {
    logoMap = cached;
    bumpVersion();
    return cached;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      // Run Uniswap + every CoinGecko platform list in parallel. A null
      // result from any single source just means "no coverage from that
      // source" — never throws, never blocks the others.
      const platformSlugs = Array.from(
        new Set(
          Object.values(COINGECKO_PLATFORM_BY_CHAIN).filter(
            (p): p is string => typeof p === "string" && p.length > 0,
          ),
        ),
      );
      const [uniswap, ...coingeckoLists] = await Promise.all([
        fetchList(UNISWAP_LIST_URL),
        ...platformSlugs.map((p) => fetchList(coingeckoListUrl(p))),
      ]);
      const m = new Map<string, string>();
      // Layer CoinGecko first; Uniswap is merged last so its more curated
      // entries overwrite CoinGecko on address collision.
      for (const list of coingeckoLists) {
        if (list) mergeList(m, list);
      }
      if (uniswap) mergeList(m, uniswap);
      writeCache(m);
      logoMap = m;
      bumpVersion();
      return m;
    } finally {
      // Always clear so a transient failure doesn't pin a stuck rejected
      // promise and block every later caller from retrying.
      inFlight = null;
    }
  })();
  return inFlight;
}

if (typeof window !== "undefined") {
  void ensureLoaded();
}

/**
 * Resolves the native gas-token logo for a chain (MON, ETH, etc.). Returns
 * null when we don't have one configured.
 */
export function getNativeLogo(chainId: number): string | null {
  return NATIVE_LOGO_BY_CHAIN[chainId] ?? null;
}

/**
 * Synchronous lookup for an ERC-20 logo. Returns the URL if we already
 * have it (cache or fetched), otherwise null. Does not handle the
 * "native" sentinel — see `resolveTokenLogo` for the unified resolver.
 */
export function getTokenLogo(chainId: number, address: string): string | null {
  if (!logoMap) return null;
  return logoMap.get(key(chainId, address)) ?? null;
}

/**
 * Unified resolver used by every render site. Returns:
 *  - the canonical native-gas logo when `address === "native"`
 *  - the Uniswap- or CoinGecko-hosted logoURI for a known ERC-20
 *  - `null` for everything else (caller renders a neutral `TokenMark`)
 *
 * Never returns a generated / placeholder image. If the lists haven't
 * loaded yet this also returns null — the caller falls back to the
 * neutral mark and re-renders once the lists hydrate.
 */
export function resolveTokenLogo(
  chainId: number,
  address: string,
): string | null {
  if (address === "native") return getNativeLogo(chainId);
  return getTokenLogo(chainId, address);
}

export function primeTokenLogos(): Promise<Map<string, string>> {
  return ensureLoaded();
}
