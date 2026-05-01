/**
 * POST /api/auth/nonce
 * Body: { address: "0x...", chainId?: number }
 * Returns: { nonce, message }  — caller signs the message with their wallet
 */

import { applyCors, supabase, generateNonce, buildSiweMessage } from '../_lib/auth.js';

export default async function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { address, chainId } = req.body || {};
  if (!/^0x[a-fA-F0-9]{40}$/.test(address || '')) {
    res.status(400).json({ error: 'Invalid wallet address' });
    return;
  }

  const lower = address.toLowerCase();
  const nonce = generateNonce();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  try {
    await supabase('/auth_nonces', {
      method: 'POST',
      body: JSON.stringify({
        nonce,
        wallet_address: lower,
        expires_at: expiresAt,
      }),
    });
  } catch (err) {
    console.error('nonce insert failed:', err.message);
    res.status(500).json({ error: 'Failed to issue nonce' });
    return;
  }

  const message = buildSiweMessage({ address: lower, nonce, chainId });
  res.status(200).json({ nonce, message });
}
