/**
 * Vercel serverless proxy for Uniswap's Trading API.
 * Handles: /api/uniswap/quote, /api/uniswap/check_approval, /api/uniswap/swap
 *
 * Keeps the API key server-side and sets x-permit2-disabled: true
 * so the swap flow is plain approve-then-swap with no Permit2 signatures.
 */

const TRADING_API_BASE =
  process.env.UNISWAP_TRADING_API_BASE ||
  'https://trade-api.gateway.uniswap.org/v1';

const ALLOWED_ENDPOINTS = new Set(['check_approval', 'quote', 'swap']);
const MAX_BODY_BYTES = 32 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const endpoint = req.query.endpoint;
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    res.status(404).json({ error: 'Unknown Uniswap endpoint' });
    return;
  }

  const apiKey = process.env.UNISWAP_TRADING_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error: 'Uniswap Trading API key is not configured. Set UNISWAP_TRADING_API_KEY in Vercel environment variables. Get a key at https://hub.uniswap.org',
      code: 'MISSING_UNISWAP_API_KEY',
    });
    return;
  }

  const bodyText = JSON.stringify(req.body ?? {});
  if (bodyText.length > MAX_BODY_BYTES) {
    res.status(413).json({ error: 'Request body too large' });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${TRADING_API_BASE}/${endpoint}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-api-key': apiKey,
        'x-permit2-disabled': 'true',
        origin: process.env.UNISWAP_TRADING_API_ORIGIN || 'https://app.uniswap.org',
      },
      body: bodyText,
      signal: controller.signal,
    });

    const text = await upstream.text();
    res.status(upstream.status).setHeader('Content-Type', 'application/json').send(text || '{}');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({
      error: 'Upstream Uniswap Trading API request failed',
      detail: message.slice(0, 200),
    });
  } finally {
    clearTimeout(timer);
  }
}
