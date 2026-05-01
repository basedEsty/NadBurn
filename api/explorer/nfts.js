/**
 * Vercel serverless function — /api/explorer/nfts
 * Auto-detects ERC-721 + ERC-1155 NFTs held by a wallet address.
 *
 * Provider priority:
 *   - Ethereum mainnet (1):  Alchemy NFT API
 *   - Monad mainnet (143):   Alchemy → Blockvision → empty
 *   - Monad testnet (10143): Alchemy testnet → empty
 *
 * Returns the same shape the frontend already expects:
 *   { nfts: [{ contractAddress, tokenId, type, balance, name, collectionName, imageUrl }] }
 */

const ALCHEMY_NFT_HOST = {
  1:     'https://eth-mainnet.g.alchemy.com',
  143:   'https://monad-mainnet.g.alchemy.com',
  10143: 'https://monad-testnet.g.alchemy.com',
};

const BLOCKVISION_BASE = 'https://api.blockvision.org';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024; // NFTs are heavier than tokens

const ALLOWED_ORIGINS = new Set([
  'https://nadburn.xyz',
  'https://www.nadburn.xyz',
]);

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readJsonWithLimit(r, maxBytes) {
  const reader = r.body?.getReader();
  if (!reader) throw new Error('No response body');
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`Response > ${maxBytes} bytes`);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { combined.set(c, off); off += c.byteLength; }
  return JSON.parse(new TextDecoder().decode(combined));
}

/**
 * Alchemy NFT API v3 — getNFTsForOwner.
 *   GET {host}/nft/v3/{key}/getNFTsForOwner?owner={addr}&pageSize=100&withMetadata=true
 *
 * Returns null when not configured / chain unsupported / request fails so
 * the caller can move on to the next provider.
 */
async function tryAlchemy(chainId, address) {
  const host = ALCHEMY_NFT_HOST[chainId];
  if (!host) return null;
  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const url = `${host}/nft/v3/${apiKey}/getNFTsForOwner?owner=${address}&pageSize=100&withMetadata=true&excludeFilters[]=SPAM`;
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const raw = await readJsonWithLimit(r, MAX_RESPONSE_BYTES);
    const owned = Array.isArray(raw?.ownedNfts) ? raw.ownedNfts : [];
    const nfts = owned.map(n => {
      const contract = (n?.contract?.address ?? '').toLowerCase();
      if (!/^0x[a-fA-F0-9]{40}$/.test(contract)) return null;
      const tokenId = String(n?.tokenId ?? '');
      if (!/^[0-9]+$/.test(tokenId)) return null;
      const std = (n?.tokenType ?? '').toUpperCase();
      const type = std === 'ERC721' ? 'erc721' : std === 'ERC1155' ? 'erc1155' : null;
      if (!type) return null;
      const balance = type === 'erc721' ? '1' : (typeof n?.balance === 'string' ? n.balance : '1');
      // Pick a usable image URL — Alchemy provides a few options
      const img = n?.image?.cachedUrl
              ?? n?.image?.thumbnailUrl
              ?? n?.image?.originalUrl
              ?? null;
      return {
        contractAddress: contract,
        tokenId,
        type,
        balance,
        name:           typeof n?.name === 'string' ? n.name : null,
        collectionName: typeof n?.contract?.name === 'string' ? n.contract.name : null,
        imageUrl:       typeof img === 'string' ? img : null,
      };
    }).filter(x => x !== null);
    return { source: 'alchemy', count: nfts.length, nfts };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Blockvision Monad NFT endpoint as a fallback for chain 143 when Alchemy
 * isn't configured for Monad. Only reached if tryAlchemy returned null.
 */
async function tryBlockvision(address) {
  const apiKey = process.env.BLOCKVISION_API_KEY;
  if (!apiKey) return { source: 'missing-key', code: 'MISSING_BLOCKVISION_API_KEY', count: 0, nfts: [] };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const url = `${BLOCKVISION_BASE}/v2/monad/account/nfts?address=${address}`;
    const r = await fetch(url, {
      headers: { accept: 'application/json', 'x-api-key': apiKey },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const raw = await readJsonWithLimit(r, MAX_RESPONSE_BYTES);
    const items = Array.isArray(raw?.result?.data)
      ? raw.result.data
      : Array.isArray(raw?.result)
      ? raw.result
      : [];
    const nfts = items.map(it => {
      const contract = (it?.contractAddress ?? '').toLowerCase();
      if (!/^0x[a-fA-F0-9]{40}$/.test(contract)) return null;
      const tokenId = String(it?.tokenId ?? '');
      if (!/^[0-9]+$/.test(tokenId)) return null;
      const std = (it?.ercStandard ?? it?.tokenType ?? '').toString().toUpperCase();
      const type = std.includes('721') ? 'erc721' : std.includes('1155') ? 'erc1155' : null;
      if (!type) return null;
      return {
        contractAddress: contract,
        tokenId,
        type,
        balance:        type === 'erc721' ? '1' : (typeof it?.amount === 'string' ? it.amount : '1'),
        name:           typeof it?.name === 'string' ? it.name : null,
        collectionName: typeof it?.collectionName === 'string' ? it.collectionName : null,
        imageUrl:       typeof it?.image === 'string' ? it.image : null,
      };
    }).filter(x => x !== null);
    return { source: 'blockvision', count: nfts.length, nfts };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET')      { res.status(405).json({ error: 'Method not allowed' }); return; }

  const chainId = Number(req.query.chainId);
  const address = String(req.query.address ?? '');

  if (!Number.isInteger(chainId) || !ALCHEMY_NFT_HOST[chainId]) {
    res.status(400).json({ error: 'Unsupported chainId' });
    return;
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    res.status(400).json({ error: 'Invalid address' });
    return;
  }

  let result = await tryAlchemy(chainId, address);
  if (!result && chainId === 143) result = await tryBlockvision(address);
  if (!result) {
    res.status(200).json({ source: null, count: 0, nfts: [] });
    return;
  }
  res.status(200).json(result);
}
