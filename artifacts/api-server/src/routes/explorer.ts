import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";

// Map of chainId -> Blockscout-style API base. Restricting this server-side
// avoids SSRF — clients can only pick from this fixed set of explorers.
const EXPLORER_BASE: Record<number, string> = {
  1: "https://eth.blockscout.com",
  10143: "https://testnet.monadexplorer.com",
};

// Monad mainnet (chain 143) doesn't have a CORS-friendly public Blockscout-
// compatible API yet — the official explorer is behind Cloudflare. We use
// Blockvision's hosted Monad indexer for that chain. Free tier is plenty
// for typical wallet auto-detect usage. Set BLOCKVISION_API_KEY on the
// server to enable; without it, chain 143 returns empty and the UI nudges
// the user to paste tokens manually.
const BLOCKVISION_BASE = "https://api.blockvision.org";

type BlockvisionToken = {
  contractAddress?: string;
  symbol?: string;
  name?: string;
  decimal?: number | string;
  decimals?: number | string;
  balance?: string;
  value?: string;
};
type BlockvisionResponse = {
  code?: number;
  message?: string;
  result?: { data?: BlockvisionToken[] } | BlockvisionToken[];
};

// Cap how often a single client can hammer the proxy.
const CACHE_MS = 15_000;
// Bound memory growth: evict when the cache exceeds this many entries.
const MAX_CACHE_SIZE = 1_000;
// Reject upstream responses larger than this to prevent memory exhaustion.
const MAX_RESPONSE_BYTES = 1_048_576; // 1 MiB

type CacheEntry = { at: number; payload: unknown };
const cache = new Map<string, CacheEntry>();

/**
 * Read a fetch Response body with a hard byte cap, then parse as JSON.
 * Aborts and throws if the body exceeds maxBytes, even when Content-Length
 * is absent, incorrect, or reflects a compressed size.
 */
async function readJsonWithLimit(r: Awaited<ReturnType<typeof fetch>>, maxBytes: number): Promise<unknown> {
  const reader = r.body?.getReader();
  if (!reader) throw new Error("No response body");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new Error(`Response body exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(combined));
}

/**
 * Evict expired entries from the cache. If the cache is still at or above
 * MAX_CACHE_SIZE after removing stale entries, delete the oldest ones until
 * the size is within the limit.
 */
function evictCache(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.at >= CACHE_MS) {
      cache.delete(key);
    }
  }
  // If we are still over the limit, delete from the front (oldest inserted).
  while (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey === undefined) break;
    cache.delete(firstKey);
  }
}

const router: IRouter = Router();

// GET /api/explorer/tokens?chainId=1&address=0x...
router.get("/explorer/tokens", async (req: Request, res: Response) => {
  const chainId = Number(req.query.chainId);
  const address = String(req.query.address ?? "");
  // Monad mainnet (143) is handled by the Blockvision branch below.
  if (
    !Number.isInteger(chainId) ||
    (!EXPLORER_BASE[chainId] && chainId !== 143)
  ) {
    res.status(400).json({ error: "Unsupported chainId" });
    return;
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }
  const cacheKey = `${chainId}:${address.toLowerCase()}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && now - cached.at < CACHE_MS) {
    res.json(cached.payload);
    return;
  }

  // ─── Monad mainnet via Blockvision ──────────────────────────────────
  if (chainId === 143) {
    const apiKey = process.env.BLOCKVISION_API_KEY;
    if (!apiKey) {
      // Mirror the "missing key" UX of the Trading API proxy: return a
      // distinct code so the frontend can render a friendly banner with
      // setup instructions instead of silently showing an empty list.
      const payload = {
        source: "missing-key",
        code: "MISSING_BLOCKVISION_API_KEY",
        count: 0,
        tokens: [] as unknown[],
      };
      evictCache();
      cache.set(cacheKey, { at: now, payload });
      res.json(payload);
      return;
    }
    try {
      const url = `${BLOCKVISION_BASE}/v2/monad/account/tokens?address=${address}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const r = await fetch(url, {
        headers: { accept: "application/json", "x-api-key": apiKey },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!r.ok) {
        logger.warn(
          { status: r.status, url },
          "Blockvision Monad tokens upstream non-2xx",
        );
        // Don't cache upstream errors (esp. 429 rate limits) — caching
        // would block legit retries for the next 15s. Just return the
        // empty payload and let the next request try again.
        res.json({
          source: "blockvision-error",
          status: r.status,
          count: 0,
          tokens: [] as unknown[],
        });
        return;
      }
      const raw = (await readJsonWithLimit(
        r,
        MAX_RESPONSE_BYTES,
      )) as BlockvisionResponse;
      // Blockvision occasionally wraps the array in `{ result: { data } }`
      // and other times returns it directly under `result`. Handle both.
      const items: BlockvisionToken[] = Array.isArray(raw?.result)
        ? raw.result
        : Array.isArray(raw?.result?.data)
        ? raw.result.data
        : [];
      const tokens = items
        .map((it) => {
          const addr =
            typeof it.contractAddress === "string"
              ? it.contractAddress.toLowerCase()
              : null;
          if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) return null;
          const dec =
            typeof it.decimal !== "undefined" ? it.decimal : it.decimals;
          // Skip the chain's native MON entry — auto-detect is for ERC-20s
          // only; native balance is read separately via wagmi.
          if (addr === "0x0000000000000000000000000000000000000000") return null;
          return {
            address: addr,
            symbol: typeof it.symbol === "string" ? it.symbol : null,
            name: typeof it.name === "string" ? it.name : null,
            decimals: dec ? Number(dec) : 18,
            value: typeof it.balance === "string" ? it.balance : "0",
          };
        })
        .filter((t): t is NonNullable<typeof t> => t !== null);

      const payload = { source: "blockvision", count: tokens.length, tokens };
      evictCache();
      cache.set(cacheKey, { at: now, payload });
      res.json(payload);
      return;
    } catch (err) {
      logger.warn({ err }, "Blockvision fetch failed");
      // Don't cache transient fetch failures (timeouts, DNS, parse errors) —
      // a retry should actually re-attempt, not return the stale empty.
      res.json({
        source: "blockvision-error",
        count: 0,
        tokens: [] as unknown[],
      });
      return;
    }
  }

  const base = EXPLORER_BASE[chainId];
  // Try a couple of known Blockscout endpoint shapes — different deployments
  // expose tokens via different paths and the response shapes also vary.
  // Both candidates include type=ERC-20 to avoid downloading large NFT/multi-token dumps.
  const candidates = [
    `${base}/api/v2/addresses/${address}/token-balances?type=ERC-20`,
    `${base}/api/v2/addresses/${address}/tokens?type=ERC-20`,
  ];

  for (const url of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const r = await fetch(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!r.ok) continue;

      // Reject obviously oversized responses early via the Content-Length hint,
      // then enforce the hard byte cap during streaming to cover absent or
      // inaccurate headers (e.g. when transport compression is in use).
      const contentLength = r.headers.get("content-length");
      if (contentLength !== null && Number(contentLength) > MAX_RESPONSE_BYTES) {
        logger.warn({ url, contentLength }, "explorer response too large, skipping");
        continue;
      }

      const raw: unknown = await readJsonWithLimit(r, MAX_RESPONSE_BYTES);

      // Normalize both response shapes:
      //   /token-balances -> [{ token: {...}, value: "..." }, ...]
      //   /tokens         -> { items: [{ token: {...}, value: "..." }, ...], next_page_params }
      type BlockscoutTokenItem = {
        token?: {
          address_hash?: unknown;
          address?: unknown;
          symbol?: unknown;
          name?: unknown;
          decimals?: unknown;
          icon_url?: unknown;
          type?: unknown;
        };
        value?: unknown;
      };
      const isObjectWithItems = (
        v: unknown,
      ): v is { items: BlockscoutTokenItem[] } =>
        typeof v === "object" &&
        v !== null &&
        Array.isArray((v as { items?: unknown }).items);
      const items: BlockscoutTokenItem[] = Array.isArray(raw)
        ? (raw as BlockscoutTokenItem[])
        : isObjectWithItems(raw)
        ? raw.items
        : [];

      const tokens = items
        .map((it) => {
          const tok = it?.token;
          // Blockscout uses `address_hash` on most chains; some shards return
          // `address`. Accept either.
          const addr: unknown = tok?.address_hash ?? tok?.address;
          if (typeof addr !== "string") return null;
          if (tok?.type !== "ERC-20") return null;
          if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return null;
          return {
            address: addr.toLowerCase(),
            symbol: tok.symbol ?? null,
            name: tok.name ?? null,
            decimals: tok.decimals ? Number(tok.decimals) : 18,
            value: typeof it.value === "string" ? it.value : "0",
          };
        })
        .filter((t): t is NonNullable<typeof t> => t !== null);

      const payload = { source: url, count: tokens.length, tokens };
      evictCache();
      cache.set(cacheKey, { at: now, payload });
      res.json(payload);
      return;
    } catch (err) {
      logger.warn({ err, url }, "explorer fetch failed");
      continue;
    }
  }

  // Nothing worked — return empty so the client can fall back gracefully.
  const payload = { source: null, count: 0, tokens: [] as unknown[] };
  evictCache();
  cache.set(cacheKey, { at: now, payload });
  res.json(payload);
});

// ─── NFT discovery ──────────────────────────────────────────────────────
//
// Mirrors /explorer/tokens but for ERC-721 + ERC-1155. Same chain matrix,
// caching, byte caps, and missing-key payload contract so the frontend can
// reuse its UX patterns. Normalized output shape:
//   { source, count, nfts: [{ contractAddress, tokenId, type,
//                             balance, name?, collectionName?, imageUrl? }] }
type BlockvisionNft = {
  contractAddress?: string;
  tokenId?: string | number;
  ercStandard?: string;     // "ERC721" | "ERC1155"
  qty?: string | number;    // ERC-1155 owned amount
  name?: string;            // token (item) name
  image?: string;
  imageUrl?: string;
  collectionName?: string;
  collection?: { name?: string };
};
type BlockvisionNftResponse = {
  code?: number;
  message?: string;
  result?:
    | { data?: BlockvisionNft[]; collections?: unknown[] }
    | BlockvisionNft[];
};

// Safety ceiling so a misbehaving indexer (infinite "next" links, etc.)
// can't OOM the server or the browser. Real wallets, including whale
// collectors, are well under this. Not a product cap — pagination loops
// continue until either the upstream signals no more pages or this guard
// fires.
const MAX_NFTS = 5000;
// Cap how many pagination round-trips we'll make per request, defense in
// depth against a malformed indexer that always returns a next-page
// pointer. Page sizes default to 100 so 50 pages × 100 = 5000 ceiling.
const MAX_NFT_PAGES = 50;
const NFT_PAGE_SIZE = 100;

// Narrow shape we accept from Blockscout's NFT endpoints. Blockscout has
// two response variants: /addresses/{addr}/nft returns NFT instances with
// metadata + a value; /addresses/{addr}/tokens with type filter returns
// token holdings (may lack per-instance ids). Both are normalized below.
type BlockscoutNftItem = {
  id?: string | number;
  token_id?: string | number;
  value?: string | number;
  metadata?: { name?: unknown; image?: unknown; image_url?: unknown };
  token_instance?: {
    metadata?: { name?: unknown; image?: unknown; image_url?: unknown };
  };
  token?: {
    address_hash?: unknown;
    address?: unknown;
    type?: unknown;
    name?: unknown;
  };
  address_hash?: unknown;
  address?: unknown;
  type?: unknown;
  name?: unknown;
};
type BlockscoutNftPage = {
  items?: BlockscoutNftItem[];
  next_page_params?: Record<string, unknown> | null;
};

function isBlockscoutNftPage(value: unknown): value is BlockscoutNftPage {
  return typeof value === "object" && value !== null && "items" in value;
}

function normalizeNftType(raw: unknown): "erc721" | "erc1155" | null {
  const s = typeof raw === "string" ? raw.toUpperCase().replace(/[-_]/g, "") : "";
  if (s.includes("1155")) return "erc1155";
  if (s.includes("721")) return "erc721";
  return null;
}

// Lift IPFS / arweave URIs to a public gateway so the browser can render
// them. We don't proxy the binary — just rewrite the scheme.
function normalizeImage(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (raw.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${raw.slice("ipfs://".length).replace(/^ipfs\//, "")}`;
  }
  if (raw.startsWith("ar://")) {
    return `https://arweave.net/${raw.slice("ar://".length)}`;
  }
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return null;
}

router.get("/explorer/nfts", async (req: Request, res: Response) => {
  const chainId = Number(req.query.chainId);
  const address = String(req.query.address ?? "");
  if (
    !Number.isInteger(chainId) ||
    (!EXPLORER_BASE[chainId] && chainId !== 143)
  ) {
    res.status(400).json({ error: "Unsupported chainId" });
    return;
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }
  const cacheKey = `nfts:${chainId}:${address.toLowerCase()}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && now - cached.at < CACHE_MS) {
    res.json(cached.payload);
    return;
  }

  // ─── Monad mainnet via Blockvision ──────────────────────────────────
  if (chainId === 143) {
    const apiKey = process.env.BLOCKVISION_API_KEY;
    if (!apiKey) {
      const payload = {
        source: "missing-key",
        code: "MISSING_BLOCKVISION_API_KEY",
        count: 0,
        nfts: [] as unknown[],
      };
      evictCache();
      cache.set(cacheKey, { at: now, payload });
      res.json(payload);
      return;
    }
    try {
      // Page through Blockvision until cursor exhausts or safety caps fire.
      // Blockvision returns `result.nextPageIndex` (or sometimes a cursor)
      // when more data is available. We accept either by reading whatever
      // `nextPageIndex` field the API echoes back.
      const collected: BlockvisionNft[] = [];
      let pageIndex: string | number | undefined = 1;
      for (
        let page = 0;
        page < MAX_NFT_PAGES && collected.length < MAX_NFTS;
        page++
      ) {
        const url =
          `${BLOCKVISION_BASE}/v2/monad/account/nfts?address=${address}` +
          `&pageSize=${NFT_PAGE_SIZE}&pageIndex=${pageIndex ?? 1}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        const r = await fetch(url, {
          headers: { accept: "application/json", "x-api-key": apiKey },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!r.ok) {
          logger.warn(
            { status: r.status, url, page },
            "Blockvision Monad nfts upstream non-2xx",
          );
          // First page failure → bubble up an error payload. Mid-pagination
          // failure → stop here and return what we already have so the
          // user still sees the partial scan.
          if (page === 0) {
            res.json({
              source: "blockvision-error",
              status: r.status,
              count: 0,
              nfts: [] as unknown[],
            });
            return;
          }
          break;
        }
        const raw = (await readJsonWithLimit(
          r,
          MAX_RESPONSE_BYTES,
        )) as BlockvisionNftResponse & {
          result?: { nextPageIndex?: string | number; total?: number };
        };
        const result = raw?.result;
        const items: BlockvisionNft[] = Array.isArray(result)
          ? result
          : Array.isArray(result?.data)
          ? result.data
          : [];
        if (items.length === 0) break;
        collected.push(...items);
        const nextIndex =
          result && !Array.isArray(result)
            ? (result as { nextPageIndex?: string | number }).nextPageIndex
            : undefined;
        if (!nextIndex || nextIndex === pageIndex) break;
        pageIndex = nextIndex;
      }

      const nfts = collected
        .map((it) => {
          const addr =
            typeof it.contractAddress === "string"
              ? it.contractAddress.toLowerCase()
              : null;
          if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) return null;
          const type = normalizeNftType(it.ercStandard);
          if (!type) return null;
          const tokenId =
            typeof it.tokenId === "string"
              ? it.tokenId
              : typeof it.tokenId === "number"
              ? String(it.tokenId)
              : null;
          if (!tokenId || !/^[0-9]+$/.test(tokenId)) return null;
          const balance =
            typeof it.qty === "string"
              ? it.qty
              : typeof it.qty === "number"
              ? String(it.qty)
              : "1";
          return {
            contractAddress: addr,
            tokenId,
            type,
            balance,
            name: typeof it.name === "string" ? it.name : null,
            collectionName:
              (typeof it.collectionName === "string"
                ? it.collectionName
                : undefined) ??
              (typeof it.collection?.name === "string"
                ? it.collection.name
                : null),
            imageUrl: normalizeImage(it.image ?? it.imageUrl),
          };
        })
        .filter((n): n is NonNullable<typeof n> => n !== null)
        .slice(0, MAX_NFTS);

      const payload = { source: "blockvision", count: nfts.length, nfts };
      evictCache();
      cache.set(cacheKey, { at: now, payload });
      res.json(payload);
      return;
    } catch (err) {
      logger.warn({ err }, "Blockvision NFT fetch failed");
      res.json({
        source: "blockvision-error",
        count: 0,
        nfts: [] as unknown[],
      });
      return;
    }
  }

  // ─── Blockscout-compatible chains (Ethereum / Monad testnet) ───────
  const base = EXPLORER_BASE[chainId];
  // Blockscout exposes NFTs via /addresses/{addr}/nft. The `?type=` filter
  // accepts a comma-separated list. Some shards return a paginated
  // `{items, next_page_params}` shape, others return a bare array.
  const candidates = [
    `${base}/api/v2/addresses/${address}/nft?type=ERC-721,ERC-1155`,
    `${base}/api/v2/addresses/${address}/tokens?type=ERC-721,ERC-1155`,
  ];

  // Merge results across both Blockscout candidate endpoints: /nft returns
  // per-instance ids when supported; /tokens carries holdings on shards
  // where /nft is sparse. Dedup by contract+tokenId so wallets that show up
  // in both don't double-render.
  const merged = new Map<
    string,
    {
      contractAddress: string;
      tokenId: string;
      type: "erc721" | "erc1155";
      balance: string;
      name: string | null;
      collectionName: string | null;
      imageUrl: string | null;
    }
  >();
  let lastSource: string | null = null;
  let anyCandidateOk = false;

  for (const baseUrl of candidates) {
    try {
      const collected: BlockscoutNftItem[] = [];
      let nextPageParams: Record<string, unknown> | null | undefined =
        undefined;
      let firstPageOk = false;

      for (
        let page = 0;
        page < MAX_NFT_PAGES && collected.length < MAX_NFTS;
        page++
      ) {
        const url =
          page === 0 || !nextPageParams
            ? baseUrl
            : `${baseUrl}&${new URLSearchParams(
                Object.entries(nextPageParams).map(([k, v]) => [
                  k,
                  String(v),
                ]),
              ).toString()}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const r = await fetch(url, {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!r.ok) {
          if (page === 0) break; // try next candidate
          break; // mid-pagination upstream failure → keep partial
        }
        const contentLength = r.headers.get("content-length");
        if (
          contentLength !== null &&
          Number(contentLength) > MAX_RESPONSE_BYTES
        ) {
          logger.warn(
            { url, contentLength },
            "explorer NFT response too large, skipping page",
          );
          break;
        }

        const raw: unknown = await readJsonWithLimit(r, MAX_RESPONSE_BYTES);
        const pageItems: BlockscoutNftItem[] = Array.isArray(raw)
          ? (raw as BlockscoutNftItem[])
          : isBlockscoutNftPage(raw) && Array.isArray(raw.items)
          ? raw.items
          : [];
        firstPageOk = firstPageOk || page === 0;
        if (pageItems.length === 0) break;
        collected.push(...pageItems);
        // Bare-array responses don't paginate.
        if (!isBlockscoutNftPage(raw)) break;
        nextPageParams = raw.next_page_params ?? null;
        if (!nextPageParams) break;
      }

      if (firstPageOk) {
        anyCandidateOk = true;
        lastSource = baseUrl;
      }

      for (const it of collected) {
        const tok = it?.token ?? it;
        const addrRaw: unknown = tok?.address_hash ?? tok?.address;
        if (typeof addrRaw !== "string") continue;
        if (!/^0x[a-fA-F0-9]{40}$/.test(addrRaw)) continue;
        const type = normalizeNftType(tok?.type);
        if (!type) continue;
        const tokenId =
          typeof it.id === "string"
            ? it.id
            : typeof it.id === "number"
            ? String(it.id)
            : typeof it?.token_id === "string"
            ? it.token_id
            : typeof it?.token_id === "number"
            ? String(it.token_id)
            : null;
        // Blockscout's /tokens endpoint doesn't carry a per-instance id.
        // Skip those rows — they describe the collection, not a burnable
        // item.
        if (!tokenId || !/^[0-9]+$/.test(tokenId)) continue;
        const balance =
          typeof it.value === "string"
            ? it.value
            : typeof it.value === "number"
            ? String(it.value)
            : "1";
        const meta = it?.metadata ?? it?.token_instance?.metadata;
        const image =
          typeof meta?.image === "string"
            ? meta.image
            : typeof meta?.image_url === "string"
            ? meta.image_url
            : null;
        const contractAddress = addrRaw.toLowerCase();
        const key = `${contractAddress}:${tokenId}`;
        if (merged.has(key)) continue;
        merged.set(key, {
          contractAddress,
          tokenId,
          type,
          balance,
          name:
            typeof meta?.name === "string"
              ? meta.name
              : typeof tok?.name === "string"
              ? tok.name
              : null,
          collectionName:
            typeof tok?.name === "string" ? tok.name : null,
          imageUrl: normalizeImage(image),
        });
        if (merged.size >= MAX_NFTS) break;
      }
      if (merged.size >= MAX_NFTS) break;
    } catch (err) {
      logger.warn({ err, url: baseUrl }, "explorer NFT fetch failed");
      continue;
    }
  }

  const nfts = Array.from(merged.values()).slice(0, MAX_NFTS);
  const payload = {
    source: anyCandidateOk ? lastSource : null,
    count: nfts.length,
    nfts,
  };
  evictCache();
  cache.set(cacheKey, { at: now, payload });
  res.json(payload);
});

export default router;
