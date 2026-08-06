'use strict';

const { SlashCommandBuilder, REST, Routes } = require('discord.js');
const { OWNER_ID, GUILD_ID } = require('../config');
const { isOwner } = require('../utils/helpers');
const { buildSlashCommandsJSON } = require('../utils/registerCommands');

const data = new SlashCommandBuilder()
  .setName('sync')
  .setDescription('Force re-sync slash commands (owner only)');

async function execute(interaction) {
  if (!isOwner(interaction.user)) {
    return interaction.reply({ content: '❌ Hanya owner yang bisa menjalankan ini.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const rest = new REST().setToken(process.env.TOKEN);
    const commands = buildSlashCommandsJSON();
    const result = await rest.put(
      Routes.applicationGuildCommands(interaction.client.application.id, GUILD_ID),
      { body: commands }
    );

    await interaction.followUp({
      content: `✅ Berhasil sync ${result.length} command.`,
      ephemeral: true,
    });
  } catch (err) {
    console.error('[Sync] Error:', err);
    await interaction.followUp({ content: `❌ Gagal sync: ${err.message}`, ephemeral: true });
  }
}

module.exports = { data, execute };
