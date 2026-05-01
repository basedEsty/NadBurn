/**
 * Stub for the legacy Replit auth endpoint. The dApp doesn't actually
 * require login on Vercel — it's purely wallet-based — so we return a
 * clean "not authenticated" response and let the frontend continue.
 *
 * This kills the 404 console noise from /api/auth/user that the
 * `@workspace/replit-auth-web` provider polls for.
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

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // 401 is the standard "not authenticated" response — the frontend
  // expects this and treats it as "user is anonymous, show the connect-
  // wallet flow" rather than throwing an error.
  res.status(401).json({ user: null, authenticated: false });
}
