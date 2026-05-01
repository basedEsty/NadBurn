/**
 * GET /api/auth/user
 * Reads the SIWE session cookie. Returns the authenticated user or null.
 */

import { applyCors, readSession, supabase } from '../_lib/auth.js';

export default async function handler(req, res) {
  applyCors(req, res, 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const session = readSession(req);
  if (!session) {
    res.status(200).json({ user: null, authenticated: false });
    return;
  }

  // Pull profile fields (nad_name, display_name) from Supabase. Cheap because
  // it's a single PK lookup, and lets the frontend show "nadburn.nad" instead
  // of 0xCfC3... after login.
  let profile = null;
  try {
    const rows = await supabase(
      `/users?wallet_address=eq.${session.walletAddress}&select=wallet_address,nad_name,display_name`,
      { method: 'GET' },
    );
    profile = Array.isArray(rows) ? rows[0] : null;
  } catch (err) {
    console.warn('user profile lookup failed:', err.message);
  }

  res.status(200).json({
    user: {
      walletAddress: session.walletAddress,
      nadName: profile?.nad_name ?? null,
      displayName: profile?.display_name ?? null,
    },
    authenticated: true,
  });
}
