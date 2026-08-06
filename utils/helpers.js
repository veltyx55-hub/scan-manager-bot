'use strict';

const { ROLE_IDS, PAYRATES, URGENT_BONUS, OWNER_ID, GUILD_ID, CHANNEL_NAME_FALLBACK, AUCTION_CHANNELS } = require('../config');

/**
 * Try channel ID first; fall back to name list for test servers.
 * @param {import('discord.js').Guild} guild
 * @param {'TL'|'TS'} group
 * @returns {import('discord.js').TextChannel|null}
 */
function findAuctionChannel(guild, group) {
  const ch = guild.channels.cache.get(AUCTION_CHANNELS[group]);
  if (ch) return ch;

  for (const name of (CHANNEL_NAME_FALLBACK[group] || [])) {
    const found = guild.channels.cache.find(
      c => c.name.toLowerCase() === name.toLowerCase() && c.isTextBased()
    );
    if (found) return found;
  }
  return null;
}

/**
 * Effective pay rate for a role, considering urgency.
 * @param {string} role
 * @param {boolean} urgent
 * @returns {number}
 */
function effectiveRate(role, urgent) {
  const base = PAYRATES[role] || 0;
  if (!urgent) return base;
  const bonusKey = role === 'TS' ? 'TS' : 'TL';
  return base + URGENT_BONUS[bonusKey];
}

/**
 * Parse deadline string: '2h' → 2, '1d' → 24. Returns hours int or null.
 * @param {string} value
 * @returns {number|null}
 */
function parseDeadline(value) {
  const v = value.trim().toLowerCase();
  try {
    if (v.endsWith('h')) {
      const n = parseInt(v.slice(0, -1), 10);
      return isNaN(n) ? null : n;
    }
    if (v.endsWith('d')) {
      const n = parseInt(v.slice(0, -1), 10);
      return isNaN(n) ? null : n * 24;
    }
  } catch (_) {}
  return null;
}

/**
 * Parse rate string: '5k' → 5000, '10k' → 10000, '15000' → 15000. Returns int or null.
 * @param {string} value
 * @returns {number|null}
 */
function parseRate(value) {
  const v = value.trim().toLowerCase();
  try {
    if (v.endsWith('k')) {
      const n = parseFloat(v.slice(0, -1));
      return isNaN(n) ? null : Math.round(n * 1000);
    }
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  } catch (_) {}
  return null;
}

/**
 * Check if a GuildMember has the given role by name.
 * @param {import('discord.js').GuildMember} member
 * @param {string} roleName
 * @returns {boolean}
 */
function userHasRole(member, roleName) {
  const roleId = ROLE_IDS[roleName];
  if (!roleId) return false;
  return member.roles.cache.has(roleId);
}

/**
 * Check if a user is the bot owner.
 * @param {import('discord.js').User|import('discord.js').GuildMember} user
 * @returns {boolean}
 */
function isOwner(user) {
  if (!user || !OWNER_ID) return false;
  const id = user.id || user.user?.id;
  return String(id) === String(OWNER_ID);
}

/**
 * Check if interaction is from the home guild (or owner bypass).
 * Sends an ephemeral error if not.
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>}
 */
async function homeGuildCheck(interaction) {
  if (isOwner(interaction.user)) return true;
  if (interaction.guildId === GUILD_ID) return true;
  await interaction.reply({ content: '❌ Bot ini hanya aktif di server resmi.', ephemeral: true });
  return false;
}

/**
 * Count active (claimed) chapters for a user across the guild.
 * @param {import('pg').Pool} pool
 * @param {string} guildId
 * @param {string} userId
 * @returns {Promise<number>}
 */
async function countActive(pool, guildId, userId) {
  const res = await pool.query(
    `SELECT COUNT(*) FROM chapter_assignments ca
     JOIN auctions a ON a.id = ca.auction_id
     WHERE a.guild_id=$1 AND ca.assignee_id=$2 AND ca.status='claimed'`,
    [guildId, userId]
  );
  return parseInt(res.rows[0].count, 10);
}

module.exports = {
  findAuctionChannel,
  effectiveRate,
  parseDeadline,
  parseRate,
  userHasRole,
  isOwner,
  homeGuildCheck,
  countActive,
};
