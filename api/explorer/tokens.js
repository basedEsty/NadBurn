/**
 * Vercel serverless function — /api/explorer/tokens
 * Auto-detects ERC-20 tokens held by a wallet address.
 *
 * Provider priority:
 *   - Ethereum mainnet (1): Alchemy → Blockscout
 *   - Monad mainnet (143): Alchemy → Blockvision → empty
 *   - Monad testnet (10143): Alchemy testnet → Blockscout testnet
 */

const BLOCKSCOUT_BASE = {
  1: 'https://eth.blockscout.com',
  10143: 'https://testnet.monadexplorer.com',
};

const ALCHEMY_HOST = {
  1:     'https://eth-mainnet.g.alchemy.com',
  143:   'https://monad-mainnet.g.alchemy.com',
  10143: 'https://monad-testnet.g.alchemy.com',
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

/**
 * Try Alchemy's alchemy_getTokenBalances RPC method.
 * Returns null if no API key, or the chain isn't supported.
 * Returns tokens array on success (only addresses with non-zero balance).
 */
async function tryAlchemy(chainId, address) {
  const host = ALCHEMY_HOST[chainId];
  if (!host) return null;
  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const r = await fetch(`${host}/v2/${apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'alchemy_getTokenBalances',
        params: [address, 'erc20'],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const raw = await readJsonWithLimit(r, MAX_RESPONSE_BYTES);
    const balances = raw?.result?.tokenBalances;
    if (!Array.isArray(balances)) return null;

    const tokens = balances
      .filter(t => {
        // Skip zero / 0x0 balances — alchemy returns dust as "0x0" sometimes.
        if (!t?.contractAddress) return false;
        if (!t.tokenBalance) return false;
        // Treat any "0x" + only zeros as zero.
        return /^0x0*$/.test(t.tokenBalance) === false;
      })
      .map(t => ({
        address: t.contractAddress.toLowerCase(),
        symbol: null,
        name: null,
        decimals: 18,
        value: t.tokenBalance,
      }));

    return { source: 'alchemy', count: tokens.length, tokens };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function tryBlockvision(address) {
  const apiKey = process.env.BLOCKVISION_API_KEY;
  if (!apiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const r = await fetch(`${BLOCKVISION_BASE}/v2/monad/account/tokens?address=${address}`, {
      headers: { accept: 'application/json', 'x-api-key': apiKey },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return null;
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
    return { source: 'blockvision', count: tokens.length, tokens };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function tryBlockscout(chainId, address) {
  const base = BLOCKSCOUT_BASE[chainId];
  if (!base) return null;
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
      const items = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
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
      return { source: url, count: tokens.length, tokens };
    } catch { continue; }
  }
  return null;
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const chainId = Number(req.query.chainId);
  const address = String(req.query.address ?? '');

  const supported = chainId in ALCHEMY_HOST || chainId in BLOCKSCOUT_BASE || chainId === 143;
  if (!Number.isInteger(chainId) || !supported) {
    res.status(400).json({ error: 'Unsupported chainId' });
    return;
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    res.status(400).json({ error: 'Invalid address' });
    return;
  }

  // Provider chain: try Alchemy first, then chain-specific fallback
  let result = await tryAlchemy(chainId, address);
  if (!result) {
    if (chainId === 143) result = await tryBlockvision(address);
    else                 result = await tryBlockscout(chainId, address);
  }
  if (!result) {
    res.status(200).json({ source: null, count: 0, tokens: [] });
    return;
  }
  res.status(200).json(result);
}
