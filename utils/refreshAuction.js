'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildEmbed } = require('./embeds');

/**
 * Re-fetch and edit the auction embed message with updated data.
 * @param {import('discord.js').Client} client
 * @param {import('pg').Pool} pool
 * @param {number} auctionId
 */
async function refreshAuctionMessage(client, pool, auctionId) {
  const auctionRes = await pool.query('SELECT * FROM auctions WHERE id=$1', [auctionId]);
  const auction = auctionRes.rows[0];

  if (!auction || !auction.auction_message_id) return;

  const guild = client.guilds.cache.get(auction.guild_id);
  if (!guild) return;

  const ch = guild.channels.cache.get(auction.auction_channel_id);
  if (!ch) return;

  let msg;
  try {
    msg = await ch.messages.fetch(auction.auction_message_id);
  } catch (_) {
    return; // message not found
  }

  const newEmbed = await buildEmbed(pool, auctionId);

  // Determine which roles actually exist in this auction,
  // then restrict to the roles allowed for this auction's type.
  // auction_type = 'TS' → only TS button; 'TL' (or NULL legacy) → only KTL + ETL.
  const roleRes = await pool.query(
    `SELECT DISTINCT role FROM chapter_assignments WHERE auction_id=$1`,
    [auctionId]
  );
  const typeAllowed = (auction.auction_type ?? 'TL') === 'TS'
    ? ['TS']
    : ['KTL', 'ETL'];
  const auctionRoles = roleRes.rows
    .map(r => r.role)
    .filter(r => typeAllowed.includes(r))
    .sort((a, b) => ['KTL', 'ETL', 'TS'].indexOf(a) - ['KTL', 'ETL', 'TS'].indexOf(b));

  // Build buttons with disabled state for empty roles
  const buttons = await Promise.all(
    auctionRoles.map(async role => {
      const availRes = await pool.query(
        `SELECT COUNT(*) FROM chapter_assignments WHERE auction_id=$1 AND role=$2 AND status='available'`,
        [auctionId, role]
      );
      const avail = parseInt(availRes.rows[0].count, 10);
      return new ButtonBuilder()
        .setCustomId(`claim_${role}`)
        .setLabel(`Claim ${role}`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(avail === 0);
    })
  );

  const components = buttons.length > 0 ? [new ActionRowBuilder().addComponents(...buttons)] : [];

  await msg.edit({ embeds: [newEmbed], components });
}

module.exports = { refreshAuctionMessage };
