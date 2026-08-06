'use strict';

/**
 * paymentService.js
 *
 * Called after a chapter is successfully marked done in commands/done.js.
 * Handles: amount calculation → ledger insert → staff embed create/edit (instant).
 *
 * Returns true on full success, false on any error (so done.js can send a confirmation).
 *
 * Dashboard updates are intentionally NOT done here. They are batched by
 * scheduler/dashboardScheduler.js (every 30 s) to avoid rate-limit spikes
 * when many staff finish chapters in quick succession.
 *
 * Never modifies the auction or chapter_assignments tables.
 */

const { GUILD_ID, STAFF_BALANCE_CHANNEL_ID } = require('../config');
const { getActivePeriod, calculateAmount }    = require('../utils/paymentHelper');
const {
  insertLedgerEntry,
  getUserEntries,
  getStaffMessageId,
  upsertStaffMessageId,
  getPeriodStats,
  getDashboardMessageId,
  setDashboardMessageId,
} = require('./paymentLedger');
const { buildStaffEmbed, buildDashboardEmbed } = require('./paymentEmbed');

/**
 * Record a completed chapter in the payment ledger and update Discord embeds.
 *
 * @returns {Promise<boolean>} true on full success, false if anything failed
 */
async function recordChapterDone(pool, client, { userId, username, auctionId, chapter, role }) {
  try {
    // ── 1. Fetch auction to get urgency + custom_rate ──────────────────────
    const auctionRes = await pool.query('SELECT * FROM auctions WHERE id=$1', [auctionId]);
    const auction = auctionRes.rows[0];
    if (!auction) {
      console.warn(`[PaymentService] Auction ${auctionId} not found — skipping ledger entry`);
      return false;
    }

    // Mirror the auto-urgent logic from the existing bot
    const customDl   = auction.custom_deadline ?? null;
    const autoUrgent = customDl !== null && customDl >= 1 && customDl <= 3;
    const urgent     = auction.urgent || autoUrgent;

    // ── 2. Calculate amount (frozen at time of completion) ─────────────────
    const amount = calculateAmount(role, urgent, auction.custom_rate ?? null);

    // ── 3. Get active period ───────────────────────────────────────────────
    const period = await getActivePeriod(pool);

    // ── 4. Insert ledger entry ─────────────────────────────────────────────
    await insertLedgerEntry(pool, {
      userId,
      username,
      auctionId,
      chapter,
      role,
      amount,
      urgent,
      customRate: auction.custom_rate ?? null,
      period,
    });

    // ── 5. Fetch all entries for this user in this period ──────────────────
    const entries = await getUserEntries(pool, userId, period);

    // ── 6. Create or update the staff embed in STAFF_BALANCE_CHANNEL ───────
    //       (instant — staff sees their own balance updated in real-time)
    await upsertStaffBalanceEmbed(pool, client, userId, username, period, entries, true);

    // Dashboard is NOT updated here — batched by dashboardScheduler.js every 30 s.

    return true;

  } catch (err) {
    // Never crash the done flow — but do log so the issue is visible
    console.error('[PaymentService] Error in recordChapterDone:', err);
    return false;
  }
}

/**
 * Create (first time) or edit the staff's balance embed in STAFF_BALANCE_CHANNEL.
 * Exported so closePeriod.js can call it to freeze embeds as CLOSED.
 *
 * Throws on failure so the try-catch in recordChapterDone can catch and return false.
 */
async function upsertStaffBalanceEmbed(pool, client, userId, username, period, entries, isOpen) {
  // ── Config guard ──────────────────────────────────────────────────────────
  if (!STAFF_BALANCE_CHANNEL_ID || STAFF_BALANCE_CHANNEL_ID.startsWith('REPLACE')) {
    console.warn('[PaymentService] STAFF_BALANCE_CHANNEL_ID not configured — staff embed skipped.');
    return;
  }

  // ── Guild lookup ──────────────────────────────────────────────────────────
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    console.warn(`[PaymentService] Guild ${GUILD_ID} not in cache — staff embed skipped.`);
    return;
  }

  // ── Channel lookup (cache first, then fetch) ──────────────────────────────
  let channel = guild.channels.cache.get(STAFF_BALANCE_CHANNEL_ID);
  if (!channel) {
    try {
      channel = await guild.channels.fetch(STAFF_BALANCE_CHANNEL_ID);
    } catch (err) {
      console.warn(`[PaymentService] Could not fetch channel ${STAFF_BALANCE_CHANNEL_ID}:`, err.message);
      return;
    }
  }

  const embed = buildStaffEmbed(entries, username, userId, period, isOpen);

  const existingMsgId = await getStaffMessageId(pool, userId, period);

  if (existingMsgId) {
    // Edit existing embed
    try {
      const msg = await channel.messages.fetch(existingMsgId);
      await msg.edit({ embeds: [embed] });
    } catch (_) {
      // Message was deleted — re-post and save new ID
      console.warn(`[PaymentService] Existing staff embed for user ${userId} not found — re-posting.`);
      const msg = await channel.send({ embeds: [embed] });
      await upsertStaffMessageId(pool, userId, period, msg.id);
    }
  } else {
    // First chapter for this user in this period — post new embed
    const msg = await channel.send({ embeds: [embed] });
    await upsertStaffMessageId(pool, userId, period, msg.id);
  }
}

/**
 * Update the dashboard embed for the period if it already exists.
 * Does nothing if the dashboard message has not been posted yet
 * (it is created by /payment command).
 */
async function updateDashboardEmbedIfExists(pool, client, period, isOpen) {
  if (!STAFF_BALANCE_CHANNEL_ID || STAFF_BALANCE_CHANNEL_ID.startsWith('REPLACE')) return;

  const msgId = await getDashboardMessageId(pool, period);
  if (!msgId) return;

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;

  let channel = guild.channels.cache.get(STAFF_BALANCE_CHANNEL_ID);
  if (!channel) {
    try {
      channel = await guild.channels.fetch(STAFF_BALANCE_CHANNEL_ID);
    } catch (_) {
      return;
    }
  }

  try {
    const msg   = await channel.messages.fetch(msgId);
    const stats = await getPeriodStats(pool, period);
    const embed = buildDashboardEmbed(stats, period, isOpen);
    await msg.edit({ embeds: [embed] });
  } catch (_) {
    // Dashboard message deleted — clear stored ID so /payment recreates it
    await setDashboardMessageId(pool, period, '');
  }
}

module.exports = { recordChapterDone, upsertStaffBalanceEmbed, updateDashboardEmbedIfExists };
