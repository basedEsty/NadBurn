/**
 * POST /api/auth/verify
 * Body: { address, signature, message, nonce }
 * On success: sets HttpOnly session cookie, returns { user: {...} }
 */

import { verifyMessage } from 'viem';
import { applyCors, supabase, setSessionCookie } from '../_lib/auth.js';

export default async function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { address, signature, message, nonce } = req.body || {};

  if (!/^0x[a-fA-F0-9]{40}$/.test(address || '')) {
    res.status(400).json({ error: 'Invalid address' });
    return;
  }
  if (!signature || !message || !nonce) {
    res.status(400).json({ error: 'Missing signature/message/nonce' });
    return;
  }

  const lower = address.toLowerCase();

  // 1. Look up nonce — must exist, not be used, not expired, and match this wallet
  let nonceRows;
  try {
    nonceRows = await supabase(
      `/auth_nonces?nonce=eq.${encodeURIComponent(nonce)}&wallet_address=eq.${lower}&select=*`,
      { method: 'GET' },
    );
  } catch (err) {
    console.error('nonce lookup failed:', err.message);
    res.status(500).json({ error: 'Auth lookup failed' });
    return;
  }

  const nonceRow = Array.isArray(nonceRows) ? nonceRows[0] : null;
  if (!nonceRow) {
    res.status(401).json({ error: 'Invalid or expired nonce' });
    return;
  }
  if (nonceRow.used_at) {
    res.status(401).json({ error: 'Nonce already used' });
    return;
  }
  if (new Date(nonceRow.expires_at).getTime() < Date.now()) {
    res.status(401).json({ error: 'Nonce expired' });
    return;
  }

  // 2. Make sure the message we got contains the nonce we issued
  if (!message.includes(nonce)) {
    res.status(401).json({ error: 'Message does not match nonce' });
    return;
  }

  // 3. Verify the signature using viem
  let valid = false;
  try {
    valid = await verifyMessage({
      address: lower,
      message,
      signature,
    });
  } catch (err) {
    console.error('verifyMessage threw:', err.message);
    res.status(401).json({ error: 'Signature verification failed' });
    return;
  }
  if (!valid) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // 4. Mark nonce as used
  try {
    await supabase(
      `/auth_nonces?nonce=eq.${encodeURIComponent(nonce)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ used_at: new Date().toISOString() }),
      },
    );
  } catch (err) {
    console.warn('Could not mark nonce as used:', err.message);
  }

  // 5. Upsert user record
  let user;
  try {
    const upserted = await supabase(`/users?on_conflict=wallet_address`, {
      method: 'POST',
      headers: { 'prefer': 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify({
        wallet_address: lower,
        last_login: new Date().toISOString(),
      }),
    });
    user = Array.isArray(upserted) ? upserted[0] : upserted;
  } catch (err) {
    console.error('user upsert failed:', err.message);
    res.status(500).json({ error: 'Could not create user' });
    return;
  }

  // 6. Issue session cookie
  setSessionCookie(res, lower);
  res.status(200).json({
    user: {
      walletAddress: lower,
      nadName: user?.nad_name ?? null,
      displayName: user?.display_name ?? null,
    },
    authenticated: true,
  });
}
