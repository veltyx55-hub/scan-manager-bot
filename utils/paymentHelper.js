'use strict';

const { PAYRATES, URGENT_BONUS, ADMIN_ROLE_ID, OWNER_ID } = require('../config');

const MONTHS_ID = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember',
];

// ─── Bot config (key-value DB) ────────────────────────────────────────────────

async function getConfig(pool, key) {
  const res = await pool.query('SELECT value FROM bot_config WHERE key=$1', [key]);
  return res.rows[0]?.value ?? null;
}

async function setConfig(pool, key, value) {
  await pool.query(`
    INSERT INTO bot_config (key, value) VALUES ($1, $2)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `, [key, String(value)]);
}

// ─── Period helpers ───────────────────────────────────────────────────────────

function getCurrentPeriodWIB() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return `${MONTHS_ID[wib.getUTCMonth()]} ${wib.getUTCFullYear()}`;
}

async function getActivePeriod(pool) {
  return (await getConfig(pool, 'active_period')) || getCurrentPeriodWIB();
}

/**
 * Advance one calendar month: "April 2026" → "Mei 2026".
 * Falls back to current WIB month if the string can't be parsed.
 */
function getNextPeriod(currentPeriod) {
  const parts    = (currentPeriod || '').trim().split(' ');
  const monthIdx = MONTHS_ID.findIndex(m => m.toLowerCase() === (parts[0] || '').toLowerCase());
  const year     = parseInt(parts[1], 10);
  if (monthIdx === -1 || isNaN(year)) return getCurrentPeriodWIB();
  const nextIdx  = (monthIdx + 1) % 12;
  const nextYear = monthIdx === 11 ? year + 1 : year;
  return `${MONTHS_ID[nextIdx]} ${nextYear}`;
}

// ─── Lock helpers ─────────────────────────────────────────────────────────────

async function isPaymentLocked(pool) {
  return (await getConfig(pool, 'payment_locked')) === '1';
}

async function setPaymentLocked(pool, locked) {
  await setConfig(pool, 'payment_locked', locked ? '1' : '0');
}

// ─── Amount calculation ───────────────────────────────────────────────────────

/**
 * Calculate the payment amount for one completed chapter.
 * Priority: custom_rate (from auction) → urgent rate → normal rate.
 * This mirrors the effectiveRate() logic in utils/helpers.js exactly.
 *
 * @param {string}      role              'KTL' | 'ETL' | 'TS'
 * @param {boolean}     urgent            was the auction urgent / auto-urgent?
 * @param {number|null} auctionCustomRate auction.custom_rate value (or null)
 * @returns {number}
 */
function calculateAmount(role, urgent, auctionCustomRate) {
  if (auctionCustomRate != null) return auctionCustomRate;
  const base = PAYRATES[role] || 0;
  if (!urgent) return base;
  const bonusKey = role === 'TS' ? 'TS' : 'TL';
  return base + URGENT_BONUS[bonusKey];
}

// ─── Display helpers ──────────────────────────────────────────────────────────

/**
 * Format an integer amount for display.
 * 5000 → "5k" | 5500 → "5.5k" | 425000 → "425k" | 800 → "800"
 */
function formatAmount(amount) {
  if (!amount) return '0';
  if (amount >= 1000) {
    const k = amount / 1000;
    return Number.isInteger(k) ? `${k}k` : `${parseFloat(k.toFixed(1))}k`;
  }
  return String(amount);
}

// ─── Permission helpers ───────────────────────────────────────────────────────

/**
 * True if user is the bot owner OR has ADMIN_ROLE_ID.
 */
function isAdmin(member, userId) {
  if (OWNER_ID && String(userId) === String(OWNER_ID)) return true;
  return member?.roles?.cache?.has(ADMIN_ROLE_ID) ?? false;
}

// ─── WIB date string ──────────────────────────────────────────────────────────

/** Returns current WIB calendar date as "YYYY-MM-DD" (UTC+7). */
function todayWIB() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

module.exports = {
  getConfig,
  setConfig,
  getActivePeriod,
  getCurrentPeriodWIB,
  getNextPeriod,
  isPaymentLocked,
  setPaymentLocked,
  calculateAmount,
  formatAmount,
  isAdmin,
  todayWIB,
};
