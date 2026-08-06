'use strict';

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
} = require('discord.js');
const { homeGuildCheck }      = require('../utils/helpers');
const { refreshAuctionMessage } = require('../utils/refreshAuction');
const { ADMIN_ROLE_ID, UPLOADER_ROLE_ID, TL_ROLES } = require('../config');
const { isPaymentLocked }     = require('../utils/paymentHelper');
const { recordChapterDone }   = require('../payment/paymentService');

// ─── Execute mark-done after chapter selection ─────────────────────────
async function executeMarkDone(interaction, pool, role, chapter, row) {
  const userId = String(interaction.user.id);

  // Safety: re-check ownership
  if (row.assignee_id !== userId) {
    return interaction.followUp({ content: '❌ Chapter ini bukan milikmu.', ephemeral: true });
  }

  const updateRes = await pool.query(
    `UPDATE chapter_assignments
     SET status='done', done_at=NOW()
     WHERE id=$1 AND status='claimed'
     RETURNING id`,
    [row.id]
  );

  if (!updateRes.rows.length) {
    return interaction.followUp({
      content: `❌ **${role} #${chapter}** sudah selesai atau tidak lagi aktif.`,
      ephemeral: true,
    });
  }

  // Public confirmation
  await interaction.channel.send(
    `✅ **${role} #${chapter}** selesai! Dikerjakan oleh ${interaction.user.toString()}.`
  );

  await refreshAuctionMessage(interaction.client, pool, row.auction_id);

  // ── Payment ledger: await so we can confirm to the user ──────────────────
  const username = interaction.member?.displayName ?? interaction.user.username;
  const paymentOk = await recordChapterDone(pool, interaction.client, {
    userId:    userId,
    username:  username,
    auctionId: row.auction_id,
    chapter:   chapter,
    role:      role,
  });

  // Ephemeral payment confirmation (only visible to the staff member)
  if (paymentOk) {
    await interaction.followUp({
      content:
        `✅ Chapter selesai.\n\n` +
        `💰 **Saldo berhasil ditambahkan ke Balance.**\n` +
        `Silakan cek \`/mybalance\` untuk melihat saldo kamu.`,
      ephemeral: true,
    });
  } else {
    await interaction.followUp({
      content:
        `⚠️ Chapter berhasil ditandai selesai, tetapi pencatatan payment gagal.\n` +
        `Mohon hubungi admin untuk cek log bot.`,
      ephemeral: true,
    });
  }

  const adminPing    = ADMIN_ROLE_ID    ? `<@&${ADMIN_ROLE_ID}>\n`    : '';
  const uploaderPing = UPLOADER_ROLE_ID ? `<@&${UPLOADER_ROLE_ID}>\n` : '';

  // ── TS LOGIC ──────────────────────────────────────────────────────────
  if (role === 'TS') {
    // Per-chapter: ping uploader
    await interaction.channel.send(
      `${uploaderPing}📢 TS **#${chapter}** sudah selesai!\nSilakan upload.`
    );

    // Final: if ALL TS in this auction are done → ping admin once
    const allTsRes = await pool.query(
      `SELECT status FROM chapter_assignments WHERE auction_id=$1 AND role='TS'`,
      [row.auction_id]
    );
    if (allTsRes.rows.length > 0 && allTsRes.rows.every(r => r.status === 'done')) {
      await interaction.channel.send(
        `${adminPing}📢 Project ini sudah selesai di TS~\nTidak ada TS yang tersisa lagi.`
      );
    }
  }

  // ── TL LOGIC ──────────────────────────────────────────────────────────
  if (TL_ROLES.includes(role)) {
    const allTlRes = await pool.query(
      `SELECT status FROM chapter_assignments
       WHERE auction_id=$1 AND role=ANY($2::text[])`,
      [row.auction_id, TL_ROLES]
    );
    if (allTlRes.rows.length > 0 && allTlRes.rows.every(r => r.status === 'done')) {
      await interaction.channel.send(
        `${adminPing}📢 SEMUA TL SELESAI!\n👉 Silakan lanjutkan membuat Lelang TS.`
      );
    }
  }
}

// ─── Show chapter picker (shared entry point) ──────────────────────────
async function showChapterPicker(interaction, pool, role) {
  if (!await homeGuildCheck(interaction)) return;

  // ── Payment lock check ──────────────────────────────────────────────────
  if (await isPaymentLocked(pool)) {
    return interaction.reply({
      content:
        '⏸️ Periode payment sebelumnya belum ditutup Admin.\n' +
        'Mohon tunggu hingga Admin menjalankan `/closeperiod`.',
      ephemeral: true,
    });
  }

  const channelId = String(interaction.channelId);
  const userId    = String(interaction.user.id);

  const activeRes = await pool.query(
    `SELECT ca.id, ca.chapter, ca.assignee_id, ca.assignee_name, ca.auction_id,
            a.project_channel_id, a.auction_channel_id, a.guild_id
     FROM chapter_assignments ca
     JOIN auctions a ON a.id = ca.auction_id
     WHERE a.project_channel_id=$1
       AND ca.assignee_id=$2
       AND ca.role=$3
       AND ca.status='claimed'
     ORDER BY LPAD(ca.chapter, 10, '0')`,
    [channelId, userId, role]
  );

  const activeRows = activeRes.rows;

  if (!activeRows.length) {
    return interaction.reply({
      content: `❌ Kamu tidak punya **${role}** chapter aktif di channel ini.`,
      ephemeral: true,
    });
  }

  const options = activeRows.map(r => ({
    label: `#${r.chapter}`,
    value: r.chapter,
    description: `${role} • sedang dikerjakan`,
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(`done_select_${role}`)
    .setPlaceholder(`Pilih chapter ${role} yang selesai (bisa lebih dari 1)…`)
    .setMinValues(1)
    .setMaxValues(options.length)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(select);
  const chapterList = activeRows.map(r => `\`#${r.chapter}\``).join('  ');

  const reply = await interaction.reply({
    content: `📋 Pilih chapter **${role}** yang selesai:\n${chapterList}`,
    components: [row],
    ephemeral: true,
    fetchReply: true,
  });

  const rowsMap = {};
  for (const r of activeRows) rowsMap[r.chapter] = r;

  try {
    const collected = await reply.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      time: 60_000,
    });

    const selected = collected.values;
    const chapterList2 = selected.map(c => `#${c}`).join(', ');

    await collected.update({
      content: `⏳ Memproses **${role}** chapter: ${chapterList2}…`,
      components: [],
    });

    for (const chapter of selected) {
      const rowData = rowsMap[chapter];
      if (!rowData) {
        await collected.followUp({ content: `❌ Chapter #${chapter} tidak ditemukan, coba lagi.`, ephemeral: true });
        continue;
      }
      await executeMarkDone(collected, pool, role, chapter, rowData);
    }
  } catch (_) {
    // Timeout — disable the select
    await interaction.editReply({ components: [] }).catch(() => {});
  }
}

// ─── Command definitions ───────────────────────────────────────────────
const ktlDoneData = new SlashCommandBuilder()
  .setName('ktldone')
  .setDescription('Tandai KTL chapter selesai');

const etlDoneData = new SlashCommandBuilder()
  .setName('etldone')
  .setDescription('Tandai ETL chapter selesai');

const tsDoneData = new SlashCommandBuilder()
  .setName('tsdone')
  .setDescription('Tandai TS chapter selesai');

module.exports = {
  ktlDoneData,
  etlDoneData,
  tsDoneData,
  showChapterPicker,
};
