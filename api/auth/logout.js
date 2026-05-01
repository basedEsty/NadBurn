/**
 * POST /api/auth/logout
 * Clears the session cookie.
 */

import { applyCors, clearSessionCookie } from '../_lib/auth.js';

export default function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
}
