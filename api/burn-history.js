/**
 * Vercel serverless function — /api/burn-history
 * Handles burn recording from the Nadburn frontend and fires
 * a Discord webhook notification on every successful burn.
 */

const WEBHOOK_URL =
  'https://discord.com/api/webhooks/1497404651128225822/-PYm5ywPQo1NS2M3-s_TtDDYDjU4LZxq1S-HdY1tPyKOy6zVVQnmTsmpFWyIMb98ErDv';

const MONAD_EXPLORER = 'https://explorer.monad.xyz/tx';

async function notifyDiscord(item) {
  const raw = Number(item.amount) / Math.pow(10, item.tokenDecimals ?? 18);
  const amount = raw.toLocaleString('en-US', { maximumFractionDigits: 6 });
  const modeLabel = item.mode === 'recover' ? '♻️ Recover' : '🔥 Pure Burn';
  const txUrl = `${MONAD_EXPLORER}/${item.txHash}`;

  const embed = {
    title: `🔥 ${amount} ${item.tokenSymbol} Burned`,
    color: 0xff4500,
    fields: [
      { name: 'Token',   value: item.tokenSymbol, inline: true },
      { name: 'Amount',  value: amount,            inline: true },
      { name: 'Mode',    value: modeLabel,         inline: true },
      { name: 'Tx Hash', value: `[${item.txHash.slice(0, 10)}…](${txUrl})`, inline: false },
      ...(item.recoveredNative
        ? [{ name: 'MON Recovered', value: `${(Number(item.recoveredNative) / 1e18).toFixed(6)} MON`, inline: true }]
        : []),
    ],
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
    throw new Error(`Discord webhook ${resp.status}: ${text}`);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (req.method === 'GET') {
    res.status(200).json({ items: [] });
    return;
  }

  if (req.method === 'POST') {
    const data = req.body;

    if (!data?.txHash || !data?.tokenSymbol || !data?.amount) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

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
    };

    // Await Discord before responding — serverless shuts down after res.json()
    try {
      await notifyDiscord(item);
    } catch (err) {
      console.error('Discord notify failed:', err.message);
      // Non-fatal — still return success to frontend
    }

    res.status(201).json(item);
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
