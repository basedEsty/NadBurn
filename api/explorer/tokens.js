/**
 * Vercel serverless function — /api/explorer/tokens
 * Auto-detects ERC-20 tokens held by a wallet address.
 *
 * - Ethereum mainnet (chain 1): Blockscout
 * - Monad testnet (chain 10143): Blockscout
 * - Monad mainnet (chain 143): Blockvision (requires BLOCKVISION_API_KEY)
 */

const EXPLORER_BASE = {
  1: 'https://eth.blockscout.com',
  10143: 'https://testnet.monadexplorer.com',
};

const BLOCKVISION_BASE = 'https://api.blockvision.org';
const MAX_RESPONSE_BYTES = 1_048_576;

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

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const chainId = Number(req.query.chainId);
  const address = String(req.query.address ?? '');

  if (!Number.isInteger(chainId) || (!EXPLORER_BASE[chainId] && chainId !== 143)) {
    res.status(400).json({ error: 'Unsupported chainId' });
    return;
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    res.status(400).json({ error: 'Invalid address' });
    return;
  }

  // ─── Monad mainnet via Blockvision ───────────────────────────────
  if (chainId === 143) {
    const apiKey = process.env.BLOCKVISION_API_KEY;
    if (!apiKey) {
      res.status(200).json({
        source: 'missing-key',
        code: 'MISSING_BLOCKVISION_API_KEY',
        count: 0,
        tokens: [],
      });
      return;
    }
    try {
      const url = `${BLOCKVISION_BASE}/v2/monad/account/tokens?address=${address}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const r = await fetch(url, {
        headers: { accept: 'application/json', 'x-api-key': apiKey },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!r.ok) {
        res.status(200).json({ source: 'blockvision-error', status: r.status, count: 0, tokens: [] });
        return;
      }
      const raw = await readJsonWithLimit(r, MAX_RESPONSE_BYTES);
      const items = Array.isArray(raw?.result) ? raw.result
                  : Array.isArray(raw?.result?.data) ? raw.result.data
                  : [];
      const tokens = items.map(it => {
        const addr = typeof it.contractAddress === 'string' ? it.contractAddress.toLowerCase() : null;
        if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) return null;
        if (addr === '0x0000000000000000000000000000000000000000') return null;
        const dec = typeof it.decimal !== 'undefined' ? it.decimal : it.decimals;
        return {
          address: addr,
          symbol: typeof it.symbol === 'string' ? it.symbol : null,
          name: typeof it.name === 'string' ? it.name : null,
          decimals: dec ? Number(dec) : 18,
          value: typeof it.balance === 'string' ? it.balance : '0',
        };
      }).filter(t => t !== null);
      res.status(200).json({ source: 'blockvision', count: tokens.length, tokens });
      return;
    } catch (err) {
      res.status(200).json({ source: 'blockvision-error', count: 0, tokens: [] });
      return;
    }
  }

  // ─── Blockscout-based chains ─────────────────────────────────────
  const base = EXPLORER_BASE[chainId];
  const candidates = [
    `${base}/api/v2/addresses/${address}/token-balances?type=ERC-20`,
    `${base}/api/v2/addresses/${address}/tokens?type=ERC-20`,
  ];

  for (const url of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const r = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
      clearTimeout(timer);
      if (!r.ok) continue;
      const cl = r.headers.get('content-length');
      if (cl !== null && Number(cl) > MAX_RESPONSE_BYTES) continue;
      const raw = await readJsonWithLimit(r, MAX_RESPONSE_BYTES);
      const items = Array.isArray(raw) ? raw
                  : Array.isArray(raw?.items) ? raw.items
                  : [];
      const tokens = items.map(it => {
        const tok = it?.token;
        const addr = tok?.address_hash ?? tok?.address;
        if (typeof addr !== 'string') return null;
        if (tok?.type !== 'ERC-20') return null;
        if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return null;
        return {
          address: addr.toLowerCase(),
          symbol: tok.symbol ?? null,
          name: tok.name ?? null,
          decimals: tok.decimals ? Number(tok.decimals) : 18,
          value: typeof it.value === 'string' ? it.value : '0',
        };
      }).filter(t => t !== null);
      res.status(200).json({ source: url, count: tokens.length, tokens });
      return;
    } catch { continue; }
  }

  res.status(200).json({ source: null, count: 0, tokens: [] });
}
