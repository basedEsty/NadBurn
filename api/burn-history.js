/**
 * GET  /api/burn-history → list YOUR burns (auth required)
 * POST /api/burn-history → record a burn (auth required), fires Discord webhook
 *
 * Wallet identity comes from the SIWE session cookie. Anonymous calls work
 * for backward-compat (POST still fires Discord webhook + returns the item)
 * but won't be persisted to the user's history.
 *
 * Now supports both ERC-20 and NFT (ERC-721 / ERC-1155) burns. NFT-specific
 * fields (tokenType, tokenId, collectionName) are optional — when absent the
 * burn is treated as a fungible token transfer.
 */

import { applyCors, readSession, supabase } from './_lib/auth.js';

const WEBHOOK_URL =
  'https://discord.com/api/webhooks/1497404651128225822/-PYm5ywPQo1NS2M3-s_TtDDYDjU4LZxq1S-HdY1tPyKOy6zVVQnmTsmpFWyIMb98ErDv';
const MONAD_EXPLORER = 'https://explorer.monad.xyz/tx';

async function notifyDiscord(item) {
  const isNft = item.tokenType === 'erc721' || item.tokenType === 'erc1155';
  const txUrl = `${MONAD_EXPLORER}/${item.txHash}`;

  let title, fields;
  if (isNft) {
    const label = item.collectionName
      ? `${item.collectionName} #${item.tokenId}`
      : `${item.tokenSymbol} #${item.tokenId}`;
    title = `🔥 ${label} Burned`;
    fields = [
      { name: 'Collection', value: item.collectionName || item.tokenSymbol, inline: true },
      { name: 'Token ID',   value: `#${item.tokenId}`, inline: true },
      { name: 'Standard',   value: item.tokenType.toUpperCase(), inline: true },
      { name: 'Tx Hash',    value: `[${item.txHash.slice(0, 10)}…](${txUrl})`, inline: false },
    ];
    if (item.tokenType === 'erc1155' && item.amount && item.amount !== '1') {
      fields.splice(2, 0, { name: 'Amount', value: `×${item.amount}`, inline: true });
    }
  } else {
    const raw = Number(item.amount) / Math.pow(10, item.tokenDecimals ?? 18);
    const amount = raw.toLocaleString('en-US', { maximumFractionDigits: 6 });
    const modeLabel = item.mode === 'recover' ? '♻️ Recover' : '🔥 Pure Burn';
    title = `🔥 ${amount} ${item.tokenSymbol} Burned`;
    fields = [
      { name: 'Token',   value: item.tokenSymbol, inline: true },
      { name: 'Amount',  value: amount,            inline: true },
      { name: 'Mode',    value: modeLabel,         inline: true },
      { name: 'Tx Hash', value: `[${item.txHash.slice(0, 10)}…](${txUrl})`, inline: false },
    ];
    if (item.recoveredNative) {
      fields.push({ name: 'MON Recovered', value: `${(Number(item.recoveredNative) / 1e18).toFixed(6)} MON`, inline: true });
    }
  }

  if (item.walletAddress) {
    fields.push({ name: 'Burner', value: `\`${item.walletAddress.slice(0, 6)}…${item.walletAddress.slice(-4)}\``, inline: true });
  }

  const embed = {
    title,
    color: 0xff4500,
    fields,
    footer: { text: 'nadburn.xyz • burn it all' },
    timestamp: new Date().toISOString(),
  };

  const resp = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Discord ${resp.status}: ${text}`);
  }
}

export default async function handler(req, res) {
  applyCors(req, res, 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const session = readSession(req);

  // ─── GET /api/burn-history → user's history ──────────────────────
  if (req.method === 'GET') {
    if (!session) { res.status(200).json({ items: [] }); return; }
    try {
      const rows = await supabase(
        `/burns?wallet_address=eq.${session.walletAddress}&select=*&order=created_at.desc&limit=100`,
        { method: 'GET' },
      );
      const items = (rows || []).map(r => ({
        id:              r.id,
        chainId:         r.chain_id,
        tokenAddress:    r.token_address,
        tokenSymbol:     r.token_symbol,
        tokenDecimals:   r.token_decimals,
        amount:          r.amount,
        mode:            r.mode,
        txHash:          r.tx_hash,
        recoveredNative: r.recovered_native,
        createdAt:       r.created_at,
        // NFT fields — null for ERC-20 rows, populated for NFT burns.
        tokenType:       r.token_type,
        tokenId:         r.token_id,
        collectionName:  r.collection_name,
      }));
      res.status(200).json({ items });
      return;
    } catch (err) {
      console.error('burn-history GET failed:', err.message);
      res.status(200).json({ items: [] });
      return;
    }
  }

  // ─── POST /api/burn-history → record a new burn ─────────────────
  if (req.method === 'POST') {
    const data = req.body;
    if (!data?.txHash || !data?.tokenSymbol || !data?.amount) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Normalize tokenType — assume erc20 if not supplied.
    const tokenType = ['erc20', 'erc721', 'erc1155'].includes(data.tokenType)
      ? data.tokenType
      : 'erc20';

    const item = {
      id:              crypto.randomUUID(),
      chainId:         data.chainId,
      tokenAddress:    data.tokenAddress ?? '',
      tokenSymbol:     data.tokenSymbol,
      tokenDecimals:   data.tokenDecimals ?? 18,
      amount:          data.amount,
      mode:            data.mode ?? 'burn',
      txHash:          data.txHash,
      recoveredNative: data.recoveredNative ?? null,
      createdAt:       new Date().toISOString(),
      walletAddress:   session?.walletAddress ?? null,
      tokenType,
      tokenId:         typeof data.tokenId === 'string' ? data.tokenId : null,
      collectionName:  typeof data.collectionName === 'string' ? data.collectionName : null,
    };

    if (session) {
      try {
        await supabase('/burns', {
          method: 'POST',
          body: JSON.stringify({
            wallet_address:   session.walletAddress,
            chain_id:         item.chainId,
            token_address:    item.tokenAddress,
            token_symbol:     item.tokenSymbol,
            token_decimals:   item.tokenDecimals,
            amount:           item.amount,
            mode:             item.mode,
            tx_hash:          item.txHash,
            recovered_native: item.recoveredNative,
            token_type:       item.tokenType,
            token_id:         item.tokenId,
            collection_name:  item.collectionName,
          }),
        });
      } catch (err) {
        console.warn('burns insert failed:', err.message);
      }
    }

    try {
      await notifyDiscord(item);
    } catch (err) {
      console.error('Discord notify failed:', err.message);
    }

    res.status(201).json(item);
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
