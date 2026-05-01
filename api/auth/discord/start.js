/**
 * GET /api/auth/discord/start
 * Redirects the user to Discord's OAuth consent screen.
 * Requires a SIWE session — we link the resulting Discord identity to the
 * authenticated wallet, so the user has to be signed in first.
 */

import crypto from 'node:crypto';
import { readSession } from '../../_lib/auth.js';

const STATE_COOKIE = 'nb_discord_state';

export default function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).end(); return; }

  const session = readSession(req);
  if (!session) {
    res.status(401).redirect('/?discord=signin-required');
    return;
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    res.status(503).json({ error: 'Discord OAuth not configured' });
    return;
  }

  // Random state token — protects against CSRF / link-replay attacks.
  // Stored in an HttpOnly cookie so the callback can verify it matches
  // what was issued for this browser session.
  const state = crypto.randomBytes(24).toString('hex');
  res.setHeader('Set-Cookie', [
    `${STATE_COOKIE}=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
  ]);

  const redirectUri = 'https://nadburn.xyz/api/auth/discord/callback';
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'none');

  res.status(302).setHeader('Location', url.toString()).end();
}
