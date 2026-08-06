'use strict';

require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  InteractionType,
  ComponentType,
} = require('discord.js');

const { getPool, initDb }         = require('./database/db');
const { registerCommands }        = require('./utils/registerCommands');
const { startDeadlineCheck }      = require('./scheduler/deadlineCheck');
const { startLockScheduler }      = require('./scheduler/lockScheduler');
const { startDashboardScheduler } = require('./scheduler/dashboardScheduler');
const { handleClaimButton }       = require('./components/claimButton');
const { execute: runAuction }     = require('./commands/auction');
const { execute: runUnclaim }     = require('./commands/unclaim');
const { execute: runSync }        = require('./commands/sync');
const { showChapterPicker }       = require('./commands/done');
const { execute: runMyBalance }   = require('./payment/myBalance');
const { execute: runPayment }     = require('./payment/paymentDashboard');
const { execute: runClosePeriod } = require('./payment/closePeriod');
const { execute: runAddBalance }  = require('./payment/addBalance');

// ─── Validate env ────────────────────────────────────────────────────────────
if (!process.env.TOKEN) {
  console.error('❌ Missing TOKEN in .env');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL in .env');
  process.exit(1);
}

// ─── Client setup ────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// ─── Ready ───────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`=== BOT.JS LOADED ===`);
  console.log(`Bot online: ${client.user.tag}`);

  const pool = getPool();

  // Init DB tables
  await initDb();

  // Register slash commands
  await registerCommands(client.application.id);

  // Start deadline checker
  startDeadlineCheck(client, pool);

  // Start payment lock scheduler (locks at 00:00 WIB each day)
  startLockScheduler(pool);

  // Start dashboard refresh scheduler (batches dashboard edits every 30 s)
  startDashboardScheduler(pool, client);

  console.log('✅ Bot ready');
});

// ─── Interaction handler ──────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  const pool = getPool();

  try {
    // ── Slash Commands ──────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case 'auction':     return await runAuction(interaction, pool);
        case 'unclaim':     return await runUnclaim(interaction, pool);
        case 'sync':        return await runSync(interaction, pool);
        case 'ktldone':     return await showChapterPicker(interaction, pool, 'KTL');
        case 'etldone':     return await showChapterPicker(interaction, pool, 'ETL');
        case 'tsdone':      return await showChapterPicker(interaction, pool, 'TS');
        case 'mybalance':   return await runMyBalance(interaction, pool);
        case 'payment':     return await runPayment(interaction, pool);
        case 'closeperiod': return await runClosePeriod(interaction, pool);
        case 'addbalance':  return await runAddBalance(interaction, pool);
        default:
          console.warn(`Unknown command: ${interaction.commandName}`);
      }
      return;
    }

    // ── Buttons ─────────────────────────────────────────────────────────────
    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id === 'claim_KTL') return await handleClaimButton(interaction, pool, 'KTL');
      if (id === 'claim_ETL') return await handleClaimButton(interaction, pool, 'ETL');
      if (id === 'claim_TS')  return await handleClaimButton(interaction, pool, 'TS');
      return;
    }

  } catch (err) {
    console.error(`[InteractionCreate] Error handling interaction "${interaction.customId ?? interaction.commandName}":`, err);

    const msg = { content: '❌ Terjadi kesalahan internal. Coba lagi nanti.', ephemeral: true };
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(msg);
      } else {
        await interaction.reply(msg);
      }
    } catch (_) {}
  }
});

// ─── Error handling ───────────────────────────────────────────────────────────
client.on('error', err => console.error('[Client Error]', err));
process.on('unhandledRejection', err => console.error('[UnhandledRejection]', err));
process.on('uncaughtException',  err => { console.error('[UncaughtException]', err); process.exit(1); });

// ─── Start ────────────────────────────────────────────────────────────────────
client.login(process.env.TOKEN);
