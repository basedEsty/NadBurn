/**
 * GET /api/auth/discord/callback?code=...&state=...
 * Discord redirects users here after they authorize on Discord's side.
 * We exchange the code for an access token, fetch the user, and write a
 * `discord_links` row keyed to their authenticated wallet address.
 */

import { readSession, supabase } from '../../_lib/auth.js';

const STATE_COOKIE = 'nb_discord_state';

function readStateCookie(req) {
  const raw = req.headers.cookie || '';
  const match = raw.split(/;\s*/).find(c => c.startsWith(`${STATE_COOKIE}=`));
  return match ? match.slice(STATE_COOKIE.length + 1) : null;
}

function redirectTo(res, target) {
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  res.status(302).setHeader('Location', target).end();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).end(); return; }

  const { code, state, error } = req.query;

  if (error) {
    redirectTo(res, '/?discord=cancelled');
    return;
  }

  if (!code || !state) {
    redirectTo(res, '/?discord=missing-params');
    return;
  }

  const expectedState = readStateCookie(req);
  if (!expectedState || expectedState !== state) {
    redirectTo(res, '/?discord=state-mismatch');
    return;
  }

  const session = readSession(req);
  if (!session) {
    redirectTo(res, '/?discord=signin-required');
    return;
  }

  const clientId     = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    redirectTo(res, '/?discord=not-configured');
    return;
  }

  // Exchange the authorization code for an access token
  let accessToken;
  try {
    const tokenResp = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        grant_type:    'authorization_code',
        code:          String(code),
        redirect_uri:  'https://nadburn.xyz/api/auth/discord/callback',
      }),
    });
    if (!tokenResp.ok) {
      const text = await tokenResp.text();
      console.error('Discord token exchange failed:', tokenResp.status, text);
      redirectTo(res, '/?discord=token-exchange-failed');
      return;
    }
    const tokenData = await tokenResp.json();
    accessToken = tokenData.access_token;
  } catch (err) {
    console.error('Discord token exchange threw:', err.message);
    redirectTo(res, '/?discord=token-exchange-failed');
    return;
  }

  // Fetch the user's Discord identity
  let discordUser;
  try {
    const userResp = await fetch('https://discord.com/api/users/@me', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!userResp.ok) {
      redirectTo(res, '/?discord=user-fetch-failed');
      return;
    }
    discordUser = await userResp.json();
  } catch (err) {
    console.error('Discord user fetch threw:', err.message);
    redirectTo(res, '/?discord=user-fetch-failed');
    return;
  }

  // Upsert the link in Supabase (wallet_address is the primary key)
  try {
    await supabase('/discord_links?on_conflict=wallet_address', {
      method: 'POST',
      headers: { 'prefer': 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify({
        wallet_address:   session.walletAddress,
        discord_user_id:  String(discordUser.id),
        discord_username: discordUser.username || discordUser.global_name || null,
      }),
    });
  } catch (err) {
    console.error('discord_links upsert failed:', err.message);
    redirectTo(res, '/?discord=db-error');
    return;
  }

  redirectTo(res, '/?discord=linked');
}
