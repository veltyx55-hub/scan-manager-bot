'use strict';

const { EmbedBuilder } = require('discord.js');
const { effectiveRate } = require('./helpers');
const { DEADLINE_HOURS: DL_HOURS } = require('../config');

/**
 * Build the auction embed for a given auction_id.
 * @param {import('pg').Pool} pool
 * @param {number} auctionId
 * @returns {Promise<EmbedBuilder>}
 */
async function buildEmbed(pool, auctionId) {
  const auctionRes = await pool.query('SELECT * FROM auctions WHERE id=$1', [auctionId]);
  const rowsRes = await pool.query(
    `SELECT * FROM chapter_assignments WHERE auction_id=$1 ORDER BY LPAD(chapter, 10, '0')`,
    [auctionId]
  );

  const auction = auctionRes.rows[0];
  const rows = rowsRes.rows;

  if (!auction) {
    return new EmbedBuilder().setTitle('❌ Auction not found').setColor(0xff0000);
  }

  const customDl = auction.custom_deadline ?? null;
  const customRate = auction.custom_rate ?? null;

  // Auto-urgent: custom deadline 1–3h counts as urgent
  const autoUrgent = customDl !== null && customDl >= 1 && customDl <= 3;
  const urgent = auction.urgent || autoUrgent;

  let mode;
  if (autoUrgent && !auction.urgent) {
    mode = '🔥 URGENT (custom)';
  } else if (urgent) {
    mode = '🔴 URGENT';
  } else {
    mode = '🟢 Normal';
  }

  const projectName = auction.project_name || 'unknown';
  const projChId = auction.project_channel_id;
  const chMention = projChId ? `<#${projChId}>` : '';

  const embed = new EmbedBuilder()
    .setTitle(`📋 #${projectName}`)
    .setDescription(chMention || null)
    .setColor(urgent ? 0xff0000 : 0x0000ff);

  embed.addFields({ name: 'Mode', value: mode, inline: true });

  // Payrates field
  const rolesPresent = ['KTL', 'ETL', 'TS'].filter(r => rows.some(x => x.role === r));
  if (rolesPresent.length > 0) {
    let rateLines;
    if (customRate !== null) {
      rateLines = rolesPresent.map(r => `**${r}**: ${customRate / 1000}k`).join('\n');
    } else {
      rateLines = rolesPresent.map(r => `**${r}**: ${effectiveRate(r, urgent) / 1000}k`).join('\n');
    }
    embed.addFields({ name: '💰 Bayaran', value: rateLines, inline: true });
  }

  // Deadline display
  let dlDisplay;
  if (customDl !== null) {
    dlDisplay = `${customDl} jam (custom)`;
  } else if (urgent) {
    dlDisplay = `${DL_HOURS.urgent} jam`;
  } else {
    dlDisplay = `${DL_HOURS.normal} jam`;
  }
  embed.addFields({ name: '⏰ Deadline', value: dlDisplay, inline: true });

  for (const role of ['KTL', 'ETL', 'TS']) {
    const rrows = rows.filter(r => r.role === role);
    if (!rrows.length) continue;

    const text = rrows.map(r => {
      if (r.status === 'available') return `⏳ Ch ${r.chapter}`;
      if (r.status === 'claimed')  return `🔒 Ch ${r.chapter} - <@${r.assignee_id}>`;
      return `✅ Ch ${r.chapter} - <@${r.assignee_id}>`;
    }).join('\n');

    embed.addFields({ name: role, value: text, inline: true });
  }

  return embed;
}

module.exports = { buildEmbed };
