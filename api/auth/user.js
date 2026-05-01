/**
 * Stub for the legacy Replit auth endpoint. The dApp doesn't actually
 * require login on Vercel — it's purely wallet-based — so we return a
 * clean "anonymous" 200 response and let the frontend continue.
 *
 * Returning 200 (instead of 401) keeps the browser console silent.
 */

const ALLOWED_ORIGINS = new Set([
  'https://nadburn.xyz',
  'https://www.nadburn.xyz',
]);

export default function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  res.status(200).json({ user: null, authenticated: false });
}
