'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { homeGuildCheck }      = require('../utils/helpers');
const { isAdmin, getActivePeriod, isPaymentLocked } = require('../utils/paymentHelper');
const { getPeriodStats, getDashboardMessageId, setDashboardMessageId } = require('./paymentLedger');
const { buildDashboardEmbed }  = require('./paymentEmbed');
const { GUILD_ID, STAFF_BALANCE_CHANNEL_ID } = require('../config');

const data = new SlashCommandBuilder()
  .setName('payment')
  .setDescription('Tampilkan / update dashboard payment periode aktif (admin, staff-balance channel)');

async function execute(interaction, pool) {
  if (!await homeGuildCheck(interaction)) return;

  // ── Must be run inside STAFF_BALANCE_CHANNEL ──────────────────────────────
  if (!STAFF_BALANCE_CHANNEL_ID || STAFF_BALANCE_CHANNEL_ID.startsWith('REPLACE')) {
    return interaction.reply({
      content: '❌ `STAFF_BALANCE_CHANNEL_ID` belum diatur di config. Hubungi developer.',
      ephemeral: true,
    });
  }

  if (String(interaction.channelId) !== String(STAFF_BALANCE_CHANNEL_ID)) {
    return interaction.reply({
      content: `❌ Command ini hanya bisa dipakai di <#${STAFF_BALANCE_CHANNEL_ID}>.`,
      ephemeral: true,
    });
  }

  // ── Admin only ─────────────────────────────────────────────────────────────
  if (!isAdmin(interaction.member, interaction.user.id)) {
    return interaction.reply({
      content: '❌ Hanya admin yang bisa menjalankan command ini.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const period = await getActivePeriod(pool);
  const locked = await isPaymentLocked(pool);
  const stats  = await getPeriodStats(pool, period);
  const embed  = buildDashboardEmbed(stats, period, !locked);

  // ── Post new or edit existing dashboard message ────────────────────────────
  const existingId = await getDashboardMessageId(pool, period);
  const channel    = interaction.channel;

  if (existingId) {
    try {
      const msg = await channel.messages.fetch(existingId);
      await msg.edit({ embeds: [embed] });
      await interaction.followUp({ content: '✅ Dashboard payment diperbarui.', ephemeral: true });
      return;
    } catch (_) {
      // Message deleted — fall through to re-post
    }
  }

  const msg = await channel.send({ embeds: [embed] });
  await setDashboardMessageId(pool, period, msg.id);
  await interaction.followUp({ content: '✅ Dashboard payment berhasil dikirim.', ephemeral: true });
}

module.exports = { data, execute };
