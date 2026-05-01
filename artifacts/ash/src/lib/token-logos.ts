/**
 * Token logo lookup, backed by Uniswap's official default token list.
 *
 *   https://tokens.uniswap.org/  →  ~1,500 tokens across 24 chains, each with a
 *                                   `logoURI` from CoinGecko / TrustWallet / etc.
 *
 * Native gas tokens (MON, ETH, etc.) aren't in the list because token lists
 * only cover ERC-20s, so we override with hardcoded official URLs per chain.
 *
 * Fetches once on first call, caches in localStorage with a 24-hour TTL,
 * and falls back to a deterministic dicebear avatar when nothing matches.
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

if (typeof window !== "undefined") {
  void ensureLoaded();
}

/**
 * Resolves the native gas-token logo for a chain (MON, ETH, etc.). Returns
 * null when we don't have one configured — caller falls back to dicebear.
 */
export function getNativeLogo(chainId: number): string | null {
  return NATIVE_LOGO_BY_CHAIN[chainId] ?? null;
}

/**
 * Synchronous lookup. Returns the logo URL if we already have it (cache or
 * fetched), otherwise null.
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
 * list and isn't a known native token. Same address always → same colored
 * shape, so users develop visual memory for unlabeled dust tokens.
 */
export function fallbackTokenLogo(address: string): string {
  const seed = address.toLowerCase();
  return `https://api.dicebear.com/7.x/shapes/svg?seed=${seed}&backgroundColor=7c3aed,a855f7,ec4899`;
}
