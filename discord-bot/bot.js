import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder, Events, ChannelType } from 'discord.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const TOKEN            = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID         = '1446101090717270069';
const BURNS_CHANNEL    = '1497404621142888539';
const GENERAL_CHANNEL  = '1446101092906827790';
const ANNOUNCE_CHANNEL = '1497404649219686481';
const TEXT_CATEGORY    = '1446101092906827789'; // "Text Channels" category

// ── Chess role IDs ──────────────────────────────────────────────
const CHESS_ROLES = [
  { id: '1497409676529373396', name: '♟️ Pawn',   minLevel: 1,  maxLevel: 5  },
  { id: '1497409680287207566', name: '♞ Knight',  minLevel: 6,  maxLevel: 10 },
  { id: '1497409688025956393', name: '♜ Rook',    minLevel: 11, maxLevel: 15 },
  { id: '1497409684221726812', name: '♝ Bishop',  minLevel: 16, maxLevel: 20 },
  { id: '1497409691284934737', name: '♛ Queen',   minLevel: 21, maxLevel: 25 },
  { id: '1497409695273586698', name: '♚ King',    minLevel: 26, maxLevel: 30 },
];

const CHESS_ROLE_IDS = new Set(CHESS_ROLES.map(r => r.id));

function xpForLevel(n)    { return (n * (n + 1) / 2) * 100; }
function levelFromXP(xp)  { let l = 0; while (l < 30 && xp >= xpForLevel(l + 1)) l++; return l; }
function roleForLevel(lvl){ if (lvl < 1) return null; return CHESS_ROLES.find(r => lvl >= r.minLevel && lvl <= r.maxLevel) ?? null; }

const DATA_FILE = './levels.json';
function loadData() {
  if (!existsSync(DATA_FILE)) return {};
  try { return JSON.parse(readFileSync(DATA_FILE, 'utf8')); } catch { return {}; }
}
function saveData(d) { writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }

if (!TOKEN) { console.error('❌  Set DISCORD_BOT_TOKEN env var'); process.exit(1); }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

const cooldowns = new Map();

client.once(Events.ClientReady, async c => {
  console.log(`✅  Logged in as ${c.user.tag}`);

  let guild, channels;
  try {
    guild    = await client.guilds.fetch(GUILD_ID);
    channels = await guild.channels.fetch();
  } catch (err) {
    console.error('❌  Failed to fetch guild/channels:', err.message);
    return;
  }

  // ── Channel setup ────────────────────────────────────────────
  try {
    const find = kw => channels.find(c => c && c.name.toLowerCase().includes(kw.toLowerCase()));

    const feedback      = find('feedback');
    const announcements = channels.get(ANNOUNCE_CHANNEL);
    const instructions  = find('instruction');
    const links         = find('links');

    // Move feedback under Text Channels (hardcoded category ID)
    if (feedback) {
      await feedback.setParent(TEXT_CATEGORY, { lockPermissions: false });
      console.log(`✅  Moved #${feedback.name} → Text Channels`);
    }

    // Lock: @everyone deny, bot allow
    const botId  = c.user.id;
    const toLock = [announcements, instructions, links].filter(Boolean);
    for (const ch of toLock) {
      await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
      await ch.permissionOverwrites.edit(botId, { SendMessages: true, ViewChannel: true });
      console.log(`🔒  Locked #${ch.name}`);
    }
  } catch (err) {
    console.error('❌  Channel setup error:', err.message);
  }

  // ── Launch announcement (once) ───────────────────────────────
  try {
    const announceCh    = await client.channels.fetch(ANNOUNCE_CHANNEL);
    const recent        = await announceCh.messages.fetch({ limit: 20 });
    const alreadyPosted = recent.some(
      m => m.author.id === c.user.id && m.embeds?.[0]?.title?.includes('Nadburn is Live')
    );

    if (alreadyPosted) {
      console.log('ℹ️   Launch announcement already posted — skipping');
    } else {
      const embed = new EmbedBuilder()
        .setColor(0xff4500)
        .setTitle('🔥 Nadburn is Live')
        .setDescription(
          '**The app is now live and ready to burn!**\n\n' +
          'Head over to [nadburn.xyz](https://nadburn.xyz) and start burning your tokens.\n\n' +
          '**[🚀 Launch App → nadburn.xyz/app](https://nadburn.xyz/app)**'
        )
        .setThumbnail('https://nadburn.xyz/favicon.svg')
        .addFields(
          { name: '🌐 Website',   value: '[nadburn.xyz](https://nadburn.xyz)',          inline: true },
          { name: '🚀 App',       value: '[nadburn.xyz/app](https://nadburn.xyz/app)',  inline: true },
          { name: '💬 Community', value: '[Join Discord](https://discord.gg/sbUnEANQ)', inline: true },
        )
        .setFooter({ text: 'nadburn.xyz • burn it all' })
        .setTimestamp();

      await announceCh.send({ embeds: [embed] });
      console.log('📢  Launch announcement posted to #announcements');
    }
  } catch (err) {
    console.error('❌  Announcement error:', err.message);
  }
});

// ── XP on every message ─────────────────────────────────────────
client.on(Events.MessageCreate, async message => {
  if (message.author.bot || !message.guild) return;

  const userId = message.author.id;
  const now    = Date.now();
  if (cooldowns.has(userId) && now - cooldowns.get(userId) < 60_000) return;
  cooldowns.set(userId, now);

  const data = loadData();
  if (!data[userId]) data[userId] = { xp: 0, level: 0, username: message.author.username };

  const xpGain = Math.floor(Math.random() * 11) + 15;
  data[userId].xp      += xpGain;
  data[userId].username = message.author.username;

  const oldLevel = data[userId].level;
  const newLevel = levelFromXP(data[userId].xp);
  data[userId].level = newLevel;
  saveData(data);

  if (newLevel > oldLevel) {
    const newRole = roleForLevel(newLevel);
    const oldRole = roleForLevel(oldLevel);

    try {
      const member = message.member;
      for (const rid of CHESS_ROLE_IDS) {
        if (member.roles.cache.has(rid)) await member.roles.remove(rid);
      }
      if (newRole) await member.roles.add(newRole.id);
    } catch (err) {
      console.warn(`⚠️  Role update failed for ${message.author.username}: ${err.message}`);
    }

    try {
      const ch = await client.channels.fetch(GENERAL_CHANNEL);
      const rankChanged = newRole && newRole.id !== oldRole?.id;
      const embed = new EmbedBuilder()
        .setColor(0xff4500)
        .setTitle('⬆️ Level Up!')
        .setDescription(
          `<@${userId}> reached **Level ${newLevel}**!` +
          (rankChanged ? `\nNew rank: **${newRole.name}**` : '')
        )
        .addFields({ name: 'Total XP', value: `${data[userId].xp.toLocaleString()}`, inline: true })
        .setFooter({ text: 'nadburn.xyz • keep chatting to rank up' })
        .setTimestamp();
      await ch.send({ embeds: [embed] });
    } catch (err) {
      console.warn('Level-up announce failed:', err.message);
    }
  }
});

// ── Slash commands ──────────────────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply();
  const { commandName } = interaction;

  try {
    if (commandName === 'rank') {
      const data  = loadData();
      const entry = data[interaction.user.id];
      if (!entry || entry.level === 0) { await interaction.editReply('You have no XP yet — start chatting!'); return; }
      const role      = roleForLevel(entry.level);
      const nextLevel = entry.level < 30 ? entry.level + 1 : null;
      const xpNeeded  = nextLevel ? xpForLevel(nextLevel) - entry.xp : 0;
      const embed = new EmbedBuilder()
        .setColor(0xff4500)
        .setTitle(`${role?.name ?? '🎖️'} ${entry.username}`)
        .addFields(
          { name: 'Level', value: `**${entry.level}** / 30`, inline: true },
          { name: 'XP',    value: `${entry.xp.toLocaleString()}`, inline: true },
          { name: nextLevel ? `XP to Level ${nextLevel}` : 'Status',
            value: nextLevel ? `${xpNeeded.toLocaleString()} more` : '👑 Max level reached!', inline: true },
        )
        .setFooter({ text: 'nadburn.xyz • burn it all' }).setTimestamp();
      await interaction.editReply({ embeds: [embed] });

    } else if (commandName === 'leaderboard') {
      const data   = loadData();
      const sorted = Object.entries(data).sort(([, a], [, b]) => b.xp - a.xp).slice(0, 10);
      if (sorted.length === 0) { await interaction.editReply('No one has earned XP yet.'); return; }
      const medals = ['🥇', '🥈', '🥉'];
      const lines  = sorted.map(([, u], i) => {
        const role = roleForLevel(u.level);
        return `${medals[i] ?? `${i + 1}.`} **${u.username}** — Lvl ${u.level} • ${u.xp.toLocaleString()} XP ${role ? role.name : ''}`;
      });
      const embed = new EmbedBuilder()
        .setColor(0xff4500).setTitle('🏆 Leaderboard').setDescription(lines.join('\n'))
        .setFooter({ text: 'nadburn.xyz • burn it all' }).setTimestamp();
      await interaction.editReply({ embeds: [embed] });

    } else if (commandName === 'burn-stats') {
      const channel  = await client.channels.fetch(BURNS_CHANNEL);
      const messages = await channel.messages.fetch({ limit: 100 });
      const burnMsgs = messages.filter(m => m.webhookId && m.embeds.length > 0 && m.embeds[0].title?.includes('🔥'));
      const tokenCounts = {};
      burnMsgs.forEach(m => {
        const sym = m.embeds[0].fields?.find(f => f.name === 'Token')?.value?.trim();
        if (sym) tokenCounts[sym] = (tokenCounts[sym] || 0) + 1;
      });
      const topTokens = Object.entries(tokenCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([sym, n]) => `\`${sym}\` — ${n} burns`).join('\n') || 'No burns yet';
      const embed = new EmbedBuilder()
        .setColor(0xff4500).setTitle('📊 Nadburn Statistics').setURL('https://nadburn.xyz')
        .addFields(
          { name: 'Total Burns', value: `**${burnMsgs.size}**`, inline: true },
          { name: 'Top Tokens',  value: topTokens },
        )
        .setFooter({ text: 'nadburn.xyz • burn it all' }).setTimestamp();
      await interaction.editReply({ embeds: [embed] });

    } else if (commandName === 'latest-burns') {
      const channel  = await client.channels.fetch(BURNS_CHANNEL);
      const messages = await channel.messages.fetch({ limit: 100 });
      const recent   = messages.filter(m => m.webhookId && m.embeds.length > 0 && m.embeds[0].title?.includes('🔥')).first(5);
      if (!recent.length) { await interaction.editReply('No burns yet. Be the first at **nadburn.xyz**!'); return; }
      const embed = new EmbedBuilder()
        .setColor(0xff4500).setTitle('🔥 Latest Burns').setURL('https://nadburn.xyz')
        .setFooter({ text: 'nadburn.xyz • burn it all' }).setTimestamp();
      recent.forEach(m => {
        const e = m.embeds[0];
        embed.addFields({
          name:  `${e.fields?.find(f => f.name === 'Token')?.value} — ${e.fields?.find(f => f.name === 'Amount')?.value}`,
          value: [e.fields?.find(f => f.name === 'Mode')?.value, e.fields?.find(f => f.name === 'Tx Hash')?.value].filter(Boolean).join(' • ') || '—',
        });
      });
      await interaction.editReply({ embeds: [embed] });
    }
  } catch (err) {
    console.error(err);
    await interaction.editReply('Something went wrong. Try again in a moment.');
  }
});

client.login(TOKEN);
