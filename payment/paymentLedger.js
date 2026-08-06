'use strict';

/**
 * paymentLedger.js — pure database layer for the payment system.
 * No Discord.js imports. No business logic. Only SQL.
 */

// ─── Ledger entries ───────────────────────────────────────────────────────────

/**
 * Insert one completed-chapter record into payment_ledger.
 */
async function insertLedgerEntry(pool, {
  userId, username, auctionId, chapter, role,
  amount, urgent, customRate, period,
}) {
  await pool.query(`
    INSERT INTO payment_ledger
      (user_id, username, auction_id, chapter, role, amount, urgent, custom_rate, period)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `, [userId, username, auctionId, chapter, role, amount, urgent, customRate ?? null, period]);
}

/**
 * Return all ledger rows for a user in a period, oldest first.
 */
async function getUserEntries(pool, userId, period) {
  const res = await pool.query(`
    SELECT * FROM payment_ledger
    WHERE user_id=$1 AND period=$2
    ORDER BY created_at ASC
  `, [userId, period]);
  return res.rows;
}

/**
 * Aggregate stats across the entire period (for the dashboard embed).
 */
async function getPeriodStats(pool, period) {
  const res = await pool.query(`
    SELECT
      COUNT(DISTINCT user_id)::int       AS total_staff,
      COUNT(*)::int                      AS total_chapters,
      COALESCE(SUM(amount), 0)::int      AS total_amount
    FROM payment_ledger
    WHERE period=$1
  `, [period]);
  return res.rows[0]; // { total_staff, total_chapters, total_amount }
}

/**
 * Return distinct (user_id, username) pairs that have entries in a period.
 */
async function getAllUsersInPeriod(pool, period) {
  const res = await pool.query(`
    SELECT DISTINCT user_id, username FROM payment_ledger WHERE period=$1
  `, [period]);
  return res.rows;
}

// ─── Staff message tracking ───────────────────────────────────────────────────

/**
 * Look up the Discord message_id of a staff member's balance embed
 * for the given period. Returns null if no embed has been posted yet.
 */
async function getStaffMessageId(pool, userId, period) {
  const res = await pool.query(`
    SELECT message_id FROM payment_staff_messages
    WHERE user_id=$1 AND period=$2
  `, [userId, period]);
  return res.rows[0]?.message_id ?? null;
}

/**
 * Insert or update the Discord message_id for a staff member's embed.
 */
async function upsertStaffMessageId(pool, userId, period, messageId) {
  await pool.query(`
    INSERT INTO payment_staff_messages (user_id, period, message_id)
    VALUES ($1,$2,$3)
    ON CONFLICT (user_id, period) DO UPDATE SET message_id = EXCLUDED.message_id
  `, [userId, period, messageId]);
}

/**
 * Return all (user_id, message_id) rows for a period (used during close-period).
 */
async function getAllStaffMessages(pool, period) {
  const res = await pool.query(`
    SELECT user_id, message_id FROM payment_staff_messages WHERE period=$1
  `, [period]);
  return res.rows;
}

// ─── Dashboard message tracking ───────────────────────────────────────────────

const dashKey = period => `dashboard_msg_${period.replace(/\s+/g, '_')}`;

async function getDashboardMessageId(pool, period) {
  const { getConfig } = require('../utils/paymentHelper');
  return getConfig(pool, dashKey(period));
}

async function setDashboardMessageId(pool, period, messageId) {
  const { setConfig } = require('../utils/paymentHelper');
  await setConfig(pool, dashKey(period), messageId);
}

module.exports = {
  insertLedgerEntry,
  getUserEntries,
  getPeriodStats,
  getAllUsersInPeriod,
  getStaffMessageId,
  upsertStaffMessageId,
  getAllStaffMessages,
  getDashboardMessageId,
  setDashboardMessageId,
};
