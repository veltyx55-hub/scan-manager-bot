'use strict';

const { GUILD_ID, URGENT_DEADLINES, DEADLINE_HOURS } = require('../config');
const { userHasRole, isOwner, countActive } = require('../utils/helpers');
const { refreshAuctionMessage } = require('../utils/refreshAuction');
const { MAX_ACTIVE } = require('../config');

/**
 * Handle a claim_<ROLE> button interaction.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {import('pg').Pool} pool
 * @param {string} role  'KTL' | 'ETL' | 'TS'
 */
async function handleClaimButton(interaction, pool, role) {
  const member = interaction.member;

  // Guild lock
  if (interaction.guildId !== GUILD_ID && !isOwner(interaction.user)) {
    return interaction.reply({ content: '❌ Bot ini hanya aktif di server resmi.', ephemeral: true });
  }

  // Role check
  if (!userHasRole(member, role)) {
    return interaction.reply({
      content: `❌ Kamu tidak punya role **${role}** untuk klaim ini.`,
      ephemeral: true,
    });
  }

  // Look up auction by message ID
  const auctionRes = await pool.query(
    'SELECT * FROM auctions WHERE auction_message_id=$1',
    [String(interaction.message.id)]
  );
  const auction = auctionRes.rows[0];

  if (!auction) {
    return interaction.reply({ content: '❌ Auction tidak ditemukan.', ephemeral: true });
  }

  // Max active check
  const active = await countActive(pool, String(interaction.guildId), String(interaction.user.id));
  if (active >= MAX_ACTIVE) {
    return interaction.reply({
      content: `❌ Kamu sudah punya **${MAX_ACTIVE}** chapter aktif. Selesaikan dulu sebelum klaim lagi.`,
      ephemeral: true,
    });
  }

  // Next available chapter (ascending)
  const chRes = await pool.query(
    `SELECT * FROM chapter_assignments
     WHERE auction_id=$1 AND role=$2 AND status='available'
     ORDER BY LPAD(chapter, 10, '0') LIMIT 1`,
    [auction.id, role]
  );
  const ch = chRes.rows[0];

  if (!ch) {
    return interaction.reply({
      content: `❌ Tidak ada chapter **${role}** yang tersedia.`,
      ephemeral: true,
    });
  }

  // Deadline priority: custom_deadline > urgent per-role > normal
  const customDl   = auction.custom_deadline ?? null;
  const autoUrgent = customDl !== null && customDl >= 1 && customDl <= 3;
  const effectiveUrgent = auction.urgent || autoUrgent;

  let deadlineHours;
  if (customDl !== null) {
    deadlineHours = customDl;
  } else if (effectiveUrgent) {
    deadlineHours = URGENT_DEADLINES[role] ?? DEADLINE_HOURS.urgent;
  } else {
    deadlineHours = DEADLINE_HOURS.normal;
  }

  const deadline = new Date(Date.now() + deadlineHours * 60 * 60 * 1000);

  await pool.query(
    `UPDATE chapter_assignments
     SET status='claimed', assignee_id=$1, assignee_name=$2,
         claimed_at=NOW(), deadline_at=$3
     WHERE id=$4`,
    [String(interaction.user.id), interaction.member?.displayName ?? interaction.user.username, deadline, ch.id]
  );

  await interaction.deferReply({ ephemeral: true });
  await refreshAuctionMessage(interaction.client, pool, auction.id);

  // Ping in project channel
  const projectCh = interaction.guild?.channels.cache.get(auction.project_channel_id);
  if (projectCh) {
    const ts = Math.floor(deadline.getTime() / 1000);
    await projectCh.send(
      `🎉 ${interaction.user.toString()} mengambil **${role} Ch ${ch.chapter}**!\n` +
      `⏰ Deadline: <t:${ts}:F> (<t:${ts}:R>)`
    );
  }

  // followUp the deferred reply
  await interaction.followUp({ content: `✅ Berhasil klaim **${role} Ch ${ch.chapter}**!`, ephemeral: true });
}

module.exports = { handleClaimButton };
