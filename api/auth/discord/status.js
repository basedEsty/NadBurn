/**
 * GET    /api/auth/discord/status  — does the auth'd user have a Discord linked?
 * DELETE /api/auth/discord/status  — remove the link (lets users re-link a different account)
 */

import { applyCors, readSession, supabase } from '../../_lib/auth.js';

export default async function handler(req, res) {
  applyCors(req, res, 'GET, DELETE, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const session = readSession(req);
  if (!session) {
    res.status(200).json({ linked: false, signedIn: false });
    return;
  }

  if (req.method === 'GET') {
    try {
      const rows = await supabase(
        `/discord_links?wallet_address=eq.${session.walletAddress}&select=discord_user_id,discord_username,linked_at`,
        { method: 'GET' },
      );
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) {
        res.status(200).json({ linked: false, signedIn: true });
        return;
      }
      res.status(200).json({
        linked: true,
        signedIn: true,
        discordUserId:   row.discord_user_id,
        discordUsername: row.discord_username,
        linkedAt:        row.linked_at,
      });
    } catch (err) {
      console.error('discord status query failed:', err.message);
      res.status(500).json({ error: 'Status lookup failed' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      await supabase(`/discord_links?wallet_address=eq.${session.walletAddress}`, {
        method: 'DELETE',
      });
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('discord unlink failed:', err.message);
      res.status(500).json({ error: 'Unlink failed' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
