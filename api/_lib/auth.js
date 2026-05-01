/**
 * Shared utilities for Vercel serverless functions:
 *   - Supabase REST client (uses service role key, server-side only)
 *   - Session cookie creation/verification (HMAC-signed, no JWT lib needed)
 *   - SIWE message construction (EIP-4361 standard, viem-strict compliant)
 *   - CORS helper
 */

import crypto from 'node:crypto';
import { getAddress } from 'viem';

// ─────────────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  'https://nadburn.xyz',
  'https://www.nadburn.xyz',
]);

export function applyCors(req, res, methods = 'GET, POST, OPTIONS') {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

// ─────────────────────────────────────────────────────────────────────
// Supabase REST client (PostgREST). Uses service role key — server only.
// ─────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function supabase(path, init = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase env vars missing');
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      'prefer': init.method === 'POST' || init.method === 'PATCH' ? 'return=representation' : 'return=minimal',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const err = new Error(`Supabase ${res.status}: ${data?.message || data?.hint || text.slice(0, 200)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────────
// Session cookies — HMAC-signed, HttpOnly
// ─────────────────────────────────────────────────────────────────────
const SESSION_COOKIE = 'nb_session';
const SESSION_TTL_SEC = 60 * 60 * 24 * 14; // 14 days
const SESSION_SECRET = process.env.SIWE_SESSION_SECRET || 'CHANGE_ME_IN_VERCEL_ENV';

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function signSession(walletAddress) {
  const payload = JSON.stringify({
    addr: walletAddress.toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
  });
  const body = b64urlEncode(payload);
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest();
  return `${body}.${b64urlEncode(hmac)}`;
}

export function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest();
  const actual = b64urlDecode(sig);
  if (expected.length !== actual.length) return null;
  if (!crypto.timingSafeEqual(expected, actual)) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(body).toString('utf8')); } catch { return null; }
  if (!payload?.addr || !payload?.exp) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return { walletAddress: payload.addr, expiresAt: payload.exp };
}

export function setSessionCookie(res, walletAddress) {
  const token = signSession(walletAddress);
  const cookie = [
    `${SESSION_COOKIE}=${token}`,
    `Path=/`,
    `Max-Age=${SESSION_TTL_SEC}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
  ].join('; ');
  res.setHeader('Set-Cookie', cookie);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}

export function readSession(req) {
  const raw = req.headers.cookie || '';
  const match = raw.split(/;\s*/).find(c => c.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  const token = match.slice(SESSION_COOKIE.length + 1);
  return verifySession(token);
}

// ─────────────────────────────────────────────────────────────────────
// SIWE message construction — EIP-4361 strict-compliant for viem 2.x
//
// Key requirements that previously broke wallets:
//   1. Address MUST be EIP-55 checksum (mixed-case) — viem rejects lowercase
//   2. Statement MUST be ASCII only — em dashes / smart quotes break parsers
//   3. Exactly two newlines between address and statement, statement and URI
// ─────────────────────────────────────────────────────────────────────
export function buildSiweMessage({ address, nonce, chainId, domain = 'nadburn.xyz', uri = 'https://nadburn.xyz' }) {
  // Checksum the address — viem will refuse to display a SIWE message with
  // a lowercase address ("invalid formatting").
  const checksummed = getAddress(address);
  const issuedAt = new Date().toISOString();
  const statement = 'Sign in to nadburn.xyz - this is gasless and free.'; // ASCII only

  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    checksummed,
    '',
    statement,
    '',
    `URI: ${uri}`,
    `Version: 1`,
    `Chain ID: ${chainId || 1}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Random nonce
// ─────────────────────────────────────────────────────────────────────
export function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}
