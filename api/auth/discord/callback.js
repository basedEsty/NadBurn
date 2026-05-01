/**
 * GET /api/auth/discord/callback?code=...&state=...
 *
 * Discord redirects here after the user authorizes on Discord's side.
 *   1. Verify state cookie matches (CSRF protection)
 *   2. Verify SIWE session is present (so we know which wallet)
 *   3. Exchange code → access token
 *   4. Fetch user identity from Discord
 *   5. Persist link to Supabase
 *   6. PUT the "Web3 Linked" role on the user in our guild
 *   7. Redirect back with ?discord=linked
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

/**
 * Best-effort: PUT the verified role on the Discord member. Failures here
 * shouldn't block the link itself — we still saved the row to Supabase, so
 * the user can use the site. The role can be retried later from the bot.
 */
async function assignRole(discordUserId) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId  = process.env.DISCORD_GUILD_ID;
  const roleId   = process.env.DISCORD_VERIFIED_ROLE_ID;
  if (!botToken || !guildId || !roleId) return false;

  try {
    const url = `https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`;
    const r = await fetch(url, {
      method: 'PUT',
      headers: {
        authorization: `Bot ${botToken}`,
        'x-audit-log-reason': 'Wallet linked via nadburn.xyz',
      },
    });
    if (!r.ok) {
      const text = await r.text();
      console.warn('Role assign returned', r.status, text.slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Role assign threw:', err.message);
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).end(); return; }

  const { code, state, error } = req.query;

  if (error)             { redirectTo(res, '/?discord=cancelled');     return; }
  if (!code || !state)   { redirectTo(res, '/?discord=missing-params'); return; }

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

  // Exchange auth code → access token
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
      console.error('Token exchange failed:', tokenResp.status, text);
      redirectTo(res, '/?discord=token-exchange-failed');
      return;
    }
    accessToken = (await tokenResp.json()).access_token;
  } catch (err) {
    console.error('Token exchange threw:', err.message);
    redirectTo(res, '/?discord=token-exchange-failed');
    return;
  }

  // Fetch the user identity
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
    console.error('User fetch threw:', err.message);
    redirectTo(res, '/?discord=user-fetch-failed');
    return;
  }

  // Persist the wallet ↔ discord link
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

  // Assign the verified role — best-effort, doesn't block on failure
  await assignRole(String(discordUser.id));

  redirectTo(res, '/?discord=linked');
}
