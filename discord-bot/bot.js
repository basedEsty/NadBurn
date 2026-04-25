import { Client, GatewayIntentBits, EmbedBuilder, Events } from 'discord.js';

const TOKEN   = process.env.DISCORD_BOT_TOKEN;
const BURNS_CHANNEL_ID = '1497404621142888539';

if (!TOKEN) {
  console.error('❌  Set DISCORD_BOT_TOKEN env var before starting.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅  Logged in as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  await interaction.deferReply();

  try {
    const channel = await client.channels.fetch(BURNS_CHANNEL_ID);
    const messages = await channel.messages.fetch({ limit: 100 });

    // Filter to webhook burn embeds only
    const burnMsgs = messages.filter(
      (m) => m.webhookId && m.embeds.length > 0 && m.embeds[0].title?.includes('🔥')
    );

    if (commandName === 'burn-stats') {
      const totalBurns = burnMsgs.size;
      const tokenCounts = {};

      burnMsgs.forEach((m) => {
        const embed = m.embeds[0];
        const symbolField = embed.fields?.find((f) => f.name === 'Token');
        if (symbolField) {
          const sym = symbolField.value.trim();
          tokenCounts[sym] = (tokenCounts[sym] || 0) + 1;
        }
      });

      const topTokens = Object.entries(tokenCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([sym, count]) => `\`${sym}\` — ${count} burns`)
        .join('\n') || 'No burns yet';

      const embed = new EmbedBuilder()
        .setColor(0xff4500)
        .setTitle('📊 Nadburn Statistics')
        .setURL('https://nadburn.xyz')
        .addFields(
          { name: 'Total Burns Recorded', value: `**${totalBurns}**`, inline: true },
          { name: 'Top Tokens', value: topTokens },
        )
        .setFooter({ text: 'nadburn.xyz • burn it all' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } else if (commandName === 'latest-burns') {
      const recent = [...burnMsgs.values()].slice(0, 5);

      if (recent.length === 0) {
        await interaction.editReply('No burns recorded yet. Be the first at **nadburn.xyz**!');
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0xff4500)
        .setTitle('🔥 Latest Burns')
        .setURL('https://nadburn.xyz')
        .setFooter({ text: 'nadburn.xyz • burn it all' })
        .setTimestamp();

      recent.forEach((m) => {
        const e = m.embeds[0];
        const amtField  = e.fields?.find((f) => f.name === 'Amount');
        const symField  = e.fields?.find((f) => f.name === 'Token');
        const modeField = e.fields?.find((f) => f.name === 'Mode');
        const txField   = e.fields?.find((f) => f.name === 'Tx Hash');
        const label = `${symField?.value ?? '?'} — ${amtField?.value ?? '?'}`;
        const detail = [
          modeField ? `Mode: ${modeField.value}` : '',
          txField   ? `[View tx](${txField.value})` : '',
        ].filter(Boolean).join(' • ');
        embed.addFields({ name: label, value: detail || '—' });
      });

      await interaction.editReply({ embeds: [embed] });
    }
  } catch (err) {
    console.error(err);
    await interaction.editReply('Something went wrong. Try again in a moment.');
  }
});

client.login(TOKEN);
