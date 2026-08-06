'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { homeGuildCheck }      = require('../utils/helpers');
const {
  isAdmin,
  getActivePeriod,
  getNextPeriod,
  setPaymentLocked,
  setConfig,
  isPaymentLocked,
} = require('../utils/paymentHelper');
const {
  getUserEntries,
  getAllStaffMessages,
  getPeriodStats,
  getDashboardMessageId,
  setDashboardMessageId,
} = require('./paymentLedger');
const { buildStaffEmbed, buildDashboardEmbed } = require('./paymentEmbed');
const { updateDashboardEmbedIfExists }          = require('./paymentService');
const {
  GUILD_ID,
  STAFF_BALANCE_CHANNEL_ID,
  ANNOUNCEMENT_CHANNEL_ID,
  ALL_STAFF_ROLE_ID,
} = require('../config');

const data = new SlashCommandBuilder()
  .setName('closeperiod')
  .setDescription('Tutup periode aktif dan buka periode baru (admin only)')
  .addStringOption(o =>
    o.setName('periode_baru')
     .setDescription('Nama periode baru, misal: "Juni 2026". Kosongkan untuk otomatis.')
     .setRequired(false)
  );

async function execute(interaction, pool) {
  if (!await homeGuildCheck(interaction)) return;

  // ── Admin only ─────────────────────────────────────────────────────────────
  if (!isAdmin(interaction.member, interaction.user.id)) {
    return interaction.reply({
      content: '❌ Hanya admin yang bisa menjalankan command ini.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const client       = interaction.client;
  const currentPeriod = await getActivePeriod(pool);

  // ── Determine next period name ─────────────────────────────────────────────
  const customNext = interaction.options.getString('periode_baru')?.trim();
  const nextPeriod = customNext || getNextPeriod(currentPeriod);

  if (nextPeriod === currentPeriod) {
    return interaction.followUp({
      content: `❌ Periode baru ("${nextPeriod}") sama dengan periode aktif. Gunakan parameter \`periode_baru\`.`,
      ephemeral: true,
    });
  }

  // ── 1. Freeze all staff embeds of the current period (show CLOSED) ─────────
  await freezeStaffEmbeds(pool, client, currentPeriod);

  // ── 2. Freeze the dashboard embed of the current period ────────────────────
  await updateDashboardEmbedIfExists(pool, client, currentPeriod, false);

  // ── 3. Unlock payment + advance to new period ──────────────────────────────
  await setPaymentLocked(pool, false);
  await setConfig(pool, 'active_period', nextPeriod);

  // ── 4. Send announcement ───────────────────────────────────────────────────
  await sendAnnouncement(client, currentPeriod, nextPeriod);

  await interaction.followUp({
    content:
      `✅ **Periode "${currentPeriod}" telah ditutup.**\n` +
      `📅 Periode baru: **${nextPeriod}**\n` +
      `🔓 Payment kembali dibuka.`,
    ephemeral: true,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Edit every staff balance embed for the given period to show Status: CLOSED.
 */
async function freezeStaffEmbeds(pool, client, period) {
  if (!STAFF_BALANCE_CHANNEL_ID || STAFF_BALANCE_CHANNEL_ID.startsWith('REPLACE')) return;

  const guild   = client.guilds.cache.get(GUILD_ID);
  const channel = guild?.channels.cache.get(STAFF_BALANCE_CHANNEL_ID);
  if (!channel) return;

  const staffMsgs = await getAllStaffMessages(pool, period);

  for (const { user_id: userId, message_id: msgId } of staffMsgs) {
    if (!msgId) continue;
    try {
      const msg = await channel.messages.fetch(msgId);

      // Re-fetch entries to rebuild a correct CLOSED embed
      const entries  = await getUserEntries(pool, userId, period);
      // username: try to get from first entry, else fallback
      const username = entries[0]?.username ?? `<@${userId}>`;
      const embed    = buildStaffEmbed(entries, username, userId, period, false);

      await msg.edit({ embeds: [embed] });
    } catch (_) {
      // Message already deleted — skip
    }
  }
}

/**
 * Post the close-period announcement to ANNOUNCEMENT_CHANNEL_ID.
 */
async function sendAnnouncement(client, closedPeriod, newPeriod) {
  if (!ANNOUNCEMENT_CHANNEL_ID || ANNOUNCEMENT_CHANNEL_ID.startsWith('REPLACE')) return;

  const guild   = client.guilds.cache.get(GUILD_ID);
  const channel = guild?.channels.cache.get(ANNOUNCEMENT_CHANNEL_ID);
  if (!channel) return;

  const mention = ALL_STAFF_ROLE_ID && !ALL_STAFF_ROLE_ID.startsWith('REPLACE')
    ? `<@&${ALL_STAFF_ROLE_ID}>`
    : '@everyone';

  await channel.send(
    `📢 ${mention}\n\n` +
    `Periode **${closedPeriod}** telah ditutup.\n` +
    `Periode **${newPeriod}** sekarang telah dibuka.\n\n` +
    `Silakan kembali melaporkan chapter yang telah selesai.`
  );
}

module.exports = { data, execute };
