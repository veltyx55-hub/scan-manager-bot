'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { homeGuildCheck }      = require('../utils/helpers');
const { getActivePeriod }     = require('../utils/paymentHelper');
const { getUserEntries }      = require('./paymentLedger');
const { buildMyBalanceEmbed } = require('./paymentEmbed');

const data = new SlashCommandBuilder()
  .setName('mybalance')
  .setDescription('Lihat balance payment kamu di periode aktif');

async function execute(interaction, pool) {
  if (!await homeGuildCheck(interaction)) return;

  const userId   = String(interaction.user.id);
  const username = interaction.member?.displayName ?? interaction.user.username;
  const period   = await getActivePeriod(pool);
  const entries  = await getUserEntries(pool, userId, period);

  const embed = buildMyBalanceEmbed(entries, username, userId, period);

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = { data, execute };
