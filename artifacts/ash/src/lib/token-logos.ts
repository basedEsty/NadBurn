/**
 * Token logo lookup, backed by Uniswap's official default token list.
 *
 *   https://tokens.uniswap.org/  →  ~1,500 tokens across 24 chains, each with a
 *                                   `logoURI` from CoinGecko / TrustWallet / etc.
 *
 * We fetch once on first call, cache in localStorage with a 24-hour TTL, and
 * fall back to a deterministic dicebear avatar for tokens not in the list.
 */

interface UniswapToken {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
}

interface UniswapList {
  tokens: UniswapToken[];
}

const LIST_URL = "https://tokens.uniswap.org/";
const STORAGE_KEY = "nb_uniswap_token_list_v1";
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Map "chainId:lowercaseAddress" → logoURI
let logoMap: Map<string, string> | null = null;
let inFlight: Promise<Map<string, string>> | null = null;

function key(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`;
}

function buildMap(list: UniswapList): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of list.tokens) {
    if (typeof t.address !== "string" || typeof t.chainId !== "number") continue;
    if (typeof t.logoURI !== "string" || !t.logoURI) continue;
    m.set(key(t.chainId, t.address), t.logoURI);
  }
  return m;
}

function readCache(): Map<string, string> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { at, list } = JSON.parse(raw) as { at: number; list: UniswapList };
    if (Date.now() - at > TTL_MS) return null;
    return buildMap(list);
  } catch {
    return null;
  }
}

function writeCache(list: UniswapList): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ at: Date.now(), list }));
  } catch {
    // localStorage full / blocked — silently skip
  }
}

async function ensureLoaded(): Promise<Map<string, string>> {
  if (logoMap) return logoMap;
  const cached = readCache();
  if (cached) {
    logoMap = cached;
    return cached;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const r = await fetch(LIST_URL, { mode: "cors" });
      if (!r.ok) throw new Error(`token list ${r.status}`);
      const list = (await r.json()) as UniswapList;
      writeCache(list);
      logoMap = buildMap(list);
      return logoMap;
    } catch {
      logoMap = new Map();
      return logoMap;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// Kick off the fetch as soon as the module loads — by the time the user is
// looking at the token list it'll already be in memory.
if (typeof window !== "undefined") {
  void ensureLoaded();
}

/**
 * Synchronous lookup. Returns the logo URL if we already have it (cache or
 * fetched), otherwise null. Callers that need to wait for the fetch can
 * `await primeTokenLogos()` first, but for our use case (rendering rows on
 * mount + on every refetch) the cache hits 99% of renders.
 */
export function getTokenLogo(chainId: number, address: string): string | null {
  if (!logoMap) return null;
  return logoMap.get(key(chainId, address)) ?? null;
}

export function primeTokenLogos(): Promise<Map<string, string>> {
  return ensureLoaded();
}

/**
 * Deterministic fallback avatar — used when the token isn't in Uniswap's
 * list. Same address always → same colored shape, so users develop visual
 * memory for their dust tokens even if they're unlabeled.
 */
export function fallbackTokenLogo(address: string): string {
  const seed = address.toLowerCase();
  return `https://api.dicebear.com/7.x/shapes/svg?seed=${seed}&backgroundColor=7c3aed,a855f7,ec4899`;
}
