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
  tokenType?: string | null;
  tokenId?: string | null;
  collectionName?: string | null;
}) {
  const {
    tokenSymbol,
    amount,
    mode,
    txHash,
    recoveredNative,
    tokenType,
    tokenId,
    collectionName,
  } = opts;

  const isNft = tokenType === 'erc721' || tokenType === 'erc1155';
  const txUrl = `${MONAD_EXPLORER}/${txHash}`;

  // Different titles + field shapes for fungible vs NFT burns. NFTs have no
  // meaningful "amount" axis (1 for ERC-721, batch size for ERC-1155 — but
  // it's per-token-id, not per-collection), so we surface the token id and
  // collection name instead.
  if (isNft) {
    const collectionLabel = collectionName || tokenSymbol || 'NFT';
    const tokenLabel = tokenId ? `#${tokenId}` : '';
    const editions =
      tokenType === 'erc1155' && amount && amount !== '0'
        ? ` (×${amount})`
        : '';

    const embed = {
      title: `🔥 ${collectionLabel} ${tokenLabel}${editions} Burned`,
      color: 0xff4500,
      fields: [
        { name: 'Collection', value: collectionLabel, inline: true },
        ...(tokenId
          ? [{ name: 'Token ID', value: tokenLabel, inline: true }]
          : []),
        {
          name: 'Standard',
          value: tokenType === 'erc1155' ? 'ERC-1155' : 'ERC-721',
          inline: true,
        },
        {
          name: 'Tx Hash',
          value: `[${txHash.slice(0, 10)}…](${txUrl})`,
          inline: false,
        },
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
      console.error('Discord notify failed:', err);
    }
    return;
  }

  // Fungible (ERC-20 / native) — original format unchanged.
  // Format amount: trim trailing zeros
  const formattedAmount = Number(amount).toLocaleString('en-US', {
    maximumFractionDigits: 6,
  });

  const modeLabel = mode === 'recover' ? '♻️ Recover' : '🔥 Pure Burn';

  const embed = {
    title: `🔥 ${formattedAmount} ${tokenSymbol} Burned`,
    color: 0xff4500,
    fields: [
      { name: 'Token', value: tokenSymbol, inline: true },
      { name: 'Amount', value: formattedAmount, inline: true },
      { name: 'Mode', value: modeLabel, inline: true },
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
