'use strict';

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { homeGuildCheck, findAuctionChannel, parseDeadline, parseRate } = require('../utils/helpers');
const { buildEmbed } = require('../utils/embeds');
const { ROLE_IDS, CHANNEL_NAME_FALLBACK } = require('../config');

const data = new SlashCommandBuilder()
  .setName('auction')
  .setDescription('Buat lelang chapter baru (jalankan di channel project)')
  .addStringOption(o => o.setName('ktl').setDescription('Chapter KTL, pisah koma (contoh: 50,51)').setRequired(false))
  .addStringOption(o => o.setName('etl').setDescription('Chapter ETL, pisah koma (contoh: 50,51)').setRequired(false))
  .addStringOption(o => o.setName('ts').setDescription('Chapter TS, pisah koma (contoh: 50,51)').setRequired(false))
  .addBooleanOption(o => o.setName('urgent').setDescription('Mode urgent: deadline pendek + bonus bayaran').setRequired(false))
  .addStringOption(o => o.setName('deadline').setDescription('Custom deadline, contoh: 2h / 1d (opsional)').setRequired(false))
  .addStringOption(o => o.setName('rate').setDescription('Custom bayaran semua role, contoh: 5k / 8000 (opsional)').setRequired(false));

async function execute(interaction, pool) {
  if (!await homeGuildCheck(interaction)) return;

  const ktlRaw = interaction.options.getString('ktl') || '';
  const etlRaw = interaction.options.getString('etl') || '';
  const tsRaw  = interaction.options.getString('ts')  || '';

  const chapters = {
    KTL: ktlRaw.split(',').map(s => s.trim()).filter(Boolean),
    ETL: etlRaw.split(',').map(s => s.trim()).filter(Boolean),
    TS:  tsRaw.split(',').map(s => s.trim()).filter(Boolean),
  };

  if (!Object.values(chapters).some(a => a.length > 0)) {
    return interaction.reply({ content: '❌ Masukkan minimal 1 chapter (ktl/etl/ts).', ephemeral: true });
  }

  // Reject mixing TL (KTL/ETL) and TS in one auction — they are separate systems
  const hasTL = chapters.KTL.length > 0 || chapters.ETL.length > 0;
  const hasTS = chapters.TS.length > 0;
  if (hasTL && hasTS) {
    return interaction.reply({
      content: '❌ Auction TL (KTL/ETL) dan TS tidak bisa digabung dalam satu auction. Buat dua auction terpisah.',
      ephemeral: true,
    });
  }

  // Auction type is authoritative from this point forward
  const auctionType = hasTS ? 'TS' : 'TL';

  // Parse optional params
  let customDlH = null;
  const deadlineStr = interaction.options.getString('deadline');
  if (deadlineStr) {
    customDlH = parseDeadline(deadlineStr);
    if (customDlH === null) {
      return interaction.reply({ content: '❌ Format deadline tidak valid. Gunakan contoh: `2h`, `1d`', ephemeral: true });
    }
  }

  let customRateVal = null;
  const rateStr = interaction.options.getString('rate');
  if (rateStr) {
    customRateVal = parseRate(rateStr);
    if (customRateVal === null) {
      return interaction.reply({ content: '❌ Format rate tidak valid. Gunakan contoh: `5k`, `8000`', ephemeral: true });
    }
  }

  // Auto-urgent if custom deadline is 1–3h
  const autoUrgent = customDlH !== null && customDlH >= 1 && customDlH <= 3;
  const urgentOpt = interaction.options.getBoolean('urgent') ?? false;
  const effectiveUrgent = urgentOpt || autoUrgent;

  // Route to the correct auction channel based on auction type
  const group   = auctionType; // 'TL' or 'TS', validated above — no mixing possible
  const channel = findAuctionChannel(interaction.guild, group);

  if (!channel) {
    const fallbackNames = CHANNEL_NAME_FALLBACK[group].join(' / ');
    return interaction.reply({
      content: `❌ Channel auction tidak ditemukan. Pastikan ada channel dengan nama: **${fallbackNames}**`,
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  // Insert auction (auction_type stored permanently so all future logic knows TL vs TS)
  const auctionRes = await pool.query(
    `INSERT INTO auctions (guild_id, project_channel_id, project_name, urgent, custom_deadline, custom_rate, auction_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      String(interaction.guildId),
      String(interaction.channelId),
      interaction.channel.name,
      effectiveUrgent,
      customDlH,
      customRateVal,
      auctionType,
    ]
  );
  const auctionId = auctionRes.rows[0].id;

  // Insert chapter assignments
  const rowsToInsert = [];
  for (const [role, chs] of Object.entries(chapters)) {
    for (const ch of chs) {
      rowsToInsert.push([auctionId, ch, role]);
    }
  }
  for (const [aid, ch, role] of rowsToInsert) {
    await pool.query(
      'INSERT INTO chapter_assignments (auction_id, chapter, role) VALUES ($1, $2, $3)',
      [aid, ch, role]
    );
  }

  const embed = await buildEmbed(pool, auctionId);

  // Build role mention string
  const mentions = [];
  if (group === 'TL') {
    if (chapters.KTL.length) mentions.push(`<@&${ROLE_IDS.KTL}>`);
    if (chapters.ETL.length) mentions.push(`<@&${ROLE_IDS.ETL}>`);
  } else {
    mentions.push(`<@&${ROLE_IDS.TS}>`);
  }

  // Only show buttons for roles that belong to this auction type and were actually included.
  // TL auction → KTL + ETL only; TS auction → TS only.
  const typeRoles    = auctionType === 'TS' ? ['TS'] : ['KTL', 'ETL'];
  const allowedRoles = typeRoles.filter(r => chapters[r].length > 0);
  const buttons = allowedRoles.map(role =>
    new ButtonBuilder()
      .setCustomId(`claim_${role}`)
      .setLabel(`Claim ${role}`)
      .setStyle(ButtonStyle.Primary)
  );
  const components = buttons.length > 0 ? [new ActionRowBuilder().addComponents(...buttons)] : [];

  const msg = await channel.send({
    content: mentions.join(' '),
    embeds: [embed],
    components,
  });

  // Save message reference
  await pool.query(
    'UPDATE auctions SET auction_message_id=$1, auction_channel_id=$2 WHERE id=$3',
    [String(msg.id), String(channel.id), auctionId]
  );

  await interaction.followUp({ content: '✅ Auction berhasil dibuat!', ephemeral: true });
}

module.exports = { data, execute };
