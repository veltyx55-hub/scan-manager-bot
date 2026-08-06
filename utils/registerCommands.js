'use strict';

const { REST, Routes } = require('discord.js');
const { GUILD_ID } = require('../config');

const { data: auctionData }       = require('../commands/auction');
const { data: unclaimData }       = require('../commands/unclaim');
const { data: syncData }          = require('../commands/sync');
const { ktlDoneData, etlDoneData, tsDoneData } = require('../commands/done');
const { data: myBalanceData }     = require('../payment/myBalance');
const { data: paymentData }       = require('../payment/paymentDashboard');
const { data: closePeriodData }   = require('../payment/closePeriod');
const { data: addBalanceData }    = require('../payment/addBalance');

function buildSlashCommandsJSON() {
  return [
    auctionData,
    unclaimData,
    syncData,
    ktlDoneData,
    etlDoneData,
    tsDoneData,
    myBalanceData,
    paymentData,
    closePeriodData,
    addBalanceData,
  ].map(cmd => cmd.toJSON());
}

async function registerCommands(clientId) {
  const rest = new REST().setToken(process.env.TOKEN);
  const commands = buildSlashCommandsJSON();

  try {
    // Register as guild commands (instant update, no propagation delay)
    await rest.put(
      Routes.applicationGuildCommands(clientId, GUILD_ID),
      { body: commands }
    );
    console.log(`✅ Synced ${commands.length} commands to guild ${GUILD_ID}`);

    // Wipe stale global commands
    try {
      await rest.put(Routes.applicationCommands(clientId), { body: [] });
      console.log('✅ Cleared global commands');
    } catch (e) {
      console.warn('⚠️  Could not clear global commands:', e.message);
    }
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
    throw err;
  }
}

module.exports = { registerCommands, buildSlashCommandsJSON };
