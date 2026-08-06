'use strict';

const { EmbedBuilder } = require('discord.js');
const { formatAmount }  = require('../utils/paymentHelper');

const SEP = '━━━━━━━━━━━━━━━━';

/**
 * Aggregate raw ledger entries into { normalByRole, inrushByRole, grandTotal }.
 * Normal = urgent=false rows; Inrush = urgent=true rows.
 *
 * @param {object[]} entries  rows from payment_ledger
 * @returns {{ normalByRole: object, inrushByRole: object, grandTotal: number }}
 */
function aggregateEntries(entries) {
  const normalByRole = {};
  const inrushByRole = {};

  for (const e of entries) {
    const target = e.urgent ? inrushByRole : normalByRole;
    if (!target[e.role]) target[e.role] = { count: 0, total: 0 };
    target[e.role].count++;
    target[e.role].total += e.amount;
  }

  const grandTotal = entries.reduce((s, e) => s + e.amount, 0);
  return { normalByRole, inrushByRole, grandTotal };
}

/**
 * Render the role lines for one section (Normal or Inrush).
 * Only renders roles that actually appear in byRole.
 *
 * @param {object} byRole  e.g. { KTL: { count: 2, total: 10000 } }
 * @returns {string}
 */
function renderSection(byRole) {
  const ORDER = ['KTL', 'ETL', 'TS'];
  return ORDER
    .filter(r => byRole[r])
    .map(r => `**${r}**\n${byRole[r].count} Chapter\n${formatAmount(byRole[r].total)}`)
    .join('\n\n');
}

/**
 * Build the staff balance embed posted in STAFF_BALANCE_CHANNEL
 * and also used by /mybalance (with isOpen=false the status shows CLOSED).
 *
 * @param {object[]} entries  payment_ledger rows for this user + period
 * @param {string}   username
 * @param {string}   userId
 * @param {string}   period   e.g. "April 2026"
 * @param {boolean}  isOpen
 * @returns {EmbedBuilder}
 */
function buildStaffEmbed(entries, username, userId, period, isOpen = true) {
  const { normalByRole, inrushByRole, grandTotal } = aggregateEntries(entries);
  const hasNormal = Object.keys(normalByRole).length > 0;
  const hasInrush = Object.keys(inrushByRole).length > 0;

  const lines = [];
  lines.push(`<@${userId}>`);
  lines.push(`\nPeriode: **${period}**`);

  if (hasNormal) {
    lines.push(`\n${SEP}\n**Normal**\n`);
    lines.push(renderSection(normalByRole));
  }

  if (hasInrush) {
    lines.push(`\n${SEP}\n🔥 **Inrush**\n`);
    lines.push(renderSection(inrushByRole));
  }

  lines.push(`\n${SEP}\n**Total**\n${formatAmount(grandTotal)}`);
  lines.push(`\n**Status:** ${isOpen ? 'OPEN' : 'CLOSED'}`);

  return new EmbedBuilder()
    .setTitle('Payment')
    .setDescription(lines.join('\n'))
    .setColor(isOpen ? 0x2ecc71 : 0x95a5a6)
    .setTimestamp();
}

/**
 * Build the /mybalance embed (ephemeral, same visual as staff embed but
 * without the footer timestamp and without a status line).
 */
function buildMyBalanceEmbed(entries, username, userId, period) {
  const { normalByRole, inrushByRole, grandTotal } = aggregateEntries(entries);
  const hasNormal = Object.keys(normalByRole).length > 0;
  const hasInrush = Object.keys(inrushByRole).length > 0;

  const lines = [];
  lines.push(`**${username}**`);
  lines.push(`Periode: **${period}**`);

  if (hasNormal) {
    lines.push(`\n${SEP}\n**Normal**\n`);
    lines.push(renderSection(normalByRole));
  }

  if (hasInrush) {
    lines.push(`\n${SEP}\n🔥 **Inrush**\n`);
    lines.push(renderSection(inrushByRole));
  }

  if (!hasNormal && !hasInrush) {
    lines.push(`\n_Belum ada chapter yang diselesaikan pada periode ini._`);
  }

  lines.push(`\n${SEP}\n**Total**\n${formatAmount(grandTotal)}`);

  return new EmbedBuilder()
    .setTitle('💰 Balance Kamu')
    .setDescription(lines.join('\n'))
    .setColor(0x3498db);
}

/**
 * Build the payment dashboard embed for /payment and the persistent
 * channel message.
 *
 * @param {{ total_staff, total_chapters, total_amount }} stats
 * @param {string}  period
 * @param {boolean} isOpen
 * @returns {EmbedBuilder}
 */
function buildDashboardEmbed(stats, period, isOpen = true) {
  const lines = [];
  lines.push(`**Periode**\n${period}`);
  lines.push(`\n${SEP}`);
  lines.push(`**Total Staff**\n${stats.total_staff}`);
  lines.push(`**Total Chapter**\n${stats.total_chapters}`);
  lines.push(`**Total Payment**\n${formatAmount(stats.total_amount)}`);
  lines.push(`\n${SEP}`);
  lines.push(`**Status**\n${isOpen ? '🟢 OPEN' : '🔴 CLOSED'}`);

  return new EmbedBuilder()
    .setTitle('📊 Payment Dashboard')
    .setDescription(lines.join('\n'))
    .setColor(isOpen ? 0x2ecc71 : 0xe74c3c)
    .setTimestamp();
}

module.exports = { buildStaffEmbed, buildMyBalanceEmbed, buildDashboardEmbed };
