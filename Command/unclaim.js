'use strict';

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
  InteractionType,
} = require('discord.js');
const { homeGuildCheck } = require('../utils/helpers');
const { refreshAuctionMessage } = require('../utils/refreshAuction');
const { ADMIN_ROLE_ID } = require('../config');

const data = new SlashCommandBuilder()
  .setName('unclaim')
  .setDescription('Lepaskan chapter yang sedang kamu kerjakan');

async function execute(interaction, pool) {
  if (!await homeGuildCheck(interaction)) return;

  const userId    = String(interaction.user.id);
  const channelId = String(interaction.channelId);

  const rowsRes = await pool.query(
    `SELECT ca.id, ca.chapter, ca.role, ca.assignee_id, ca.auction_id,
            a.project_channel_id, a.guild_id
     FROM chapter_assignments ca
     JOIN auctions a ON a.id = ca.auction_id
     WHERE a.project_channel_id=$1
       AND ca.assignee_id=$2
       AND ca.status='claimed'
     ORDER BY LPAD(ca.chapter, 10, '0')`,
    [channelId, userId]
  );

  const rows = rowsRes.rows;

  if (!rows.length) {
    return interaction.reply({
      content: '❌ Kamu tidak punya chapter yang sedang di-claim di channel ini.',
      ephemeral: true,
    });
  }

  const options = rows.map(r => ({
    label: `${r.role} #${r.chapter}`,
    value: String(r.id),
    description: 'sedang di-claim oleh kamu',
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId('unclaim_select')
    .setPlaceholder('Pilih chapter yang ingin di-unclaim…')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  const actionRow   = new ActionRowBuilder().addComponents(select);
  const chapterList = rows.map(r => `\`${r.role} #${r.chapter}\``).join('  ');

  const reply = await interaction.reply({
    content: `📋 Pilih chapter yang ingin di-unclaim:\n${chapterList}`,
    components: [actionRow],
    ephemeral: true,
    fetchReply: true,
  });

  const rowsMap = {};
  for (const r of rows) rowsMap[String(r.id)] = r;

  try {
    // Step 1: Wait for the dropdown selection
    const selectInteraction = await reply.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      time: 60_000,
    });

    const selectedId = selectInteraction.values[0];
    const rowData    = rowsMap[selectedId];

    if (!rowData) {
      return selectInteraction.update({
        content: '❌ Chapter tidak ditemukan, coba lagi.',
        components: [],
      });
    }

    // Step 2: Show modal for reason
    const modal = new ModalBuilder()
      .setCustomId(`unclaim_modal_${rowData.id}`)
      .setTitle('Alasan Unclaim');

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Alasan unclaim')
      .setPlaceholder('Contoh: Tidak bisa menyelesaikan, ada keperluan mendadak...')
      .setRequired(true)
      .setMaxLength(200)
      .setStyle(TextInputStyle.Paragraph);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

    await selectInteraction.showModal(modal);

    // Step 3: Wait for modal submission
    const modalInteraction = await selectInteraction.awaitModalSubmit({
      time: 5 * 60_000, // 5 minutes to fill in reason
      filter: i => i.customId === `unclaim_modal_${rowData.id}`,
    });

    const reason = modalInteraction.fields.getTextInputValue('reason');

    // Safety: ensure chapter still belongs to this user
    if (rowData.assignee_id !== userId) {
      return modalInteraction.reply({ content: '❌ Chapter ini bukan milikmu.', ephemeral: true });
    }

    // DB update
    const updateRes = await pool.query(
      `UPDATE chapter_assignments
       SET status='available', assignee_id=NULL, assignee_name=NULL,
           claimed_at=NULL, deadline_at=NULL
       WHERE id=$1 AND status='claimed' AND assignee_id=$2
       RETURNING id`,
      [rowData.id, userId]
    );

    if (!updateRes.rows.length) {
      return modalInteraction.reply({
        content: '❌ Gagal unclaim. Chapter sudah tidak di-claim atau bukan milikmu.',
        ephemeral: true,
      });
    }

    await modalInteraction.reply({
      content: `✅ Berhasil unclaim **${rowData.role} #${rowData.chapter}**`,
      ephemeral: true,
    });

    await refreshAuctionMessage(interaction.client, pool, rowData.auction_id);

    const projectCh = interaction.guild?.channels.cache.get(rowData.project_channel_id);
    if (projectCh) {
      const adminPing = ADMIN_ROLE_ID ? `<@&${ADMIN_ROLE_ID}>\n` : '';
      await projectCh.send(
        `${adminPing}` +
        `⚠️ **Chapter dilepas (UNCLAIM)**\n` +
        `📌 **${rowData.role} #${rowData.chapter}**\n` +
        `👤 ${interaction.user.toString()}\n` +
        `📝 Alasan: ${reason}`
      );
    }
  } catch (_) {
    // Timeout — clean up components
    await interaction.editReply({ components: [] }).catch(() => {});
  }
}

module.exports = { data, execute };
