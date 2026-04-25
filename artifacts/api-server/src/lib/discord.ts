const WEBHOOK_URL =
  'https://discord.com/api/webhooks/1497404651128225822/-PYm5ywPQo1NS2M3-s_TtDDYDjU4LZxq1S-HdY1tPyKOy6zVVQnmTsmpFWyIMb98ErDv';

const MONAD_EXPLORER = 'https://explorer.monad.xyz/tx';

export async function notifyBurn(opts: {
  tokenSymbol: string;
  tokenAddress: string;
  amount: string;
  mode: string;
  txHash: string;
  recoveredNative?: string | null;
}) {
  const { tokenSymbol, tokenAddress, amount, mode, txHash, recoveredNative } = opts;

  // Format amount: trim trailing zeros
  const formattedAmount = Number(amount).toLocaleString('en-US', {
    maximumFractionDigits: 6,
  });

  const modeLabel = mode === 'recover' ? '♻️ Recover' : '🔥 Pure Burn';
  const txUrl = `${MONAD_EXPLORER}/${txHash}`;

  const embed = {
    title: `🔥 ${formattedAmount} ${tokenSymbol} Burned`,
    color: 0xff4500,
    fields: [
      { name: 'Token',  value: tokenSymbol,    inline: true },
      { name: 'Amount', value: formattedAmount, inline: true },
      { name: 'Mode',   value: modeLabel,       inline: true },
      { name: 'Tx Hash', value: `[${txHash.slice(0, 10)}…](${txUrl})`, inline: false },
      ...(recoveredNative
        ? [{ name: 'MON Recovered', value: `${Number(recoveredNative).toFixed(6)} MON`, inline: true }]
        : []),
    ],
    footer: { text: 'nadburn.xyz • burn it all' },
    timestamp: new Date().toISOString(),
  };

  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (err) {
    // Non-fatal — never let Discord errors break the burn record
    console.error('Discord notify failed:', err);
  }
}
