'use strict';

/**
 * addBalance.js — /addbalance command
 *
 * Adds manual payment balance for work outside the auction system
 * (Weekly, Manga, special projects, etc.).
 *
 * Two mutually exclusive modes:
 *   Chapter mode  — no `manga` option  → PAYRATES[role] (+ urgent bonus if urgent)
 *   Manga mode    — `manga` filled in  → pages × MANGA_PAGE_RATE[role]
 *                   urgent is NOT allowed in manga mode (they are mutually exclusive)
 *
 * `manga` accepts:  "25p"  |  "25h"  |  "25"   (all parsed to integer 25)
 *   p = page, h = halaman
 *
 * KTL is available only in Chapter mode; manga mode supports ETL and TS only.
 */

const { SlashCommandBuilder } = require('discord.js');
const { homeGuildCheck }      = require('../utils/helpers');
const {
  getActivePeriod,
  isPaymentLocked,
  calculateAmount,
  formatAmount,
} = require('../utils/paymentHelper');
const { MANGA_PAGE_RATE } = require('../config');
const { insertLedgerEntry, getUserEntries } = require('./paymentLedger');
const { upsertStaffBalanceEmbed }           = require('./paymentService');

// ── Parse manga input: "25p" | "25h" | "25" → 25, else null ─────────────────
function parseManga(raw) {
  if (!raw) return null;
  const match = raw.trim().match(/^(\d+)[ph]?$/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return n > 0 ? n : null;
}

const data = new SlashCommandBuilder()
  .setName('addbalance')
  .setDescription('Tambah balance manual untuk pekerjaan non-auction (Weekly, Manga, dll.)')
  .addStringOption(o =>
    o.setName('role')
     .setDescription('Role yang akan ditambahkan balancenya')
     .setRequired(true)
     .addChoices(
       { name: 'KTL', value: 'KTL' },
       { name: 'ETL', value: 'ETL' },
       { name: 'TS',  value: 'TS'  },
     )
  )
  .addBooleanOption(o =>
    o.setName('urgent')
     .setDescription('Urgent / Inrush? — hanya untuk Mode Chapter, tidak boleh digabung dengan manga')
     .setRequired(false)
  )
  .addStringOption(o =>
    o.setName('manga')
     .setDescription('Jumlah halaman manga, contoh: 25p atau 25h (kosongkan untuk Mode Chapter)')
     .setRequired(false)
  );

async function execute(interaction, pool) {
  if (!await homeGuildCheck(interaction)) return;

  // ── Lock check ────────────────────────────────────────────────────────────
  if (await isPaymentLocked(pool)) {
    return interaction.reply({
      content:
        '⏸️ Periode payment sebelumnya belum ditutup Admin.\n' +
        'Mohon tunggu hingga Admin menjalankan `/closeperiod`.',
      ephemeral: true,
    });
  }

  const role     = interaction.options.getString('role');           // 'KTL' | 'ETL' | 'TS'
  const urgent   = interaction.options.getBoolean('urgent') ?? false;
  const mangaRaw = interaction.options.getString('manga') ?? null;

  // ── Parse manga pages ─────────────────────────────────────────────────────
  const mangaPages = parseManga(mangaRaw);

  if (mangaRaw !== null && mangaPages === null) {
    return interaction.reply({
      content:
        '❌ Format `manga` tidak valid.\n' +
        'Gunakan angka diikuti `p` atau `h`, contoh: `25p`, `25h`, atau cukup `25`.',
      ephemeral: true,
    });
  }

  // ── Mode conflict: urgent + manga tidak boleh bersamaan ───────────────────
  if (urgent && mangaPages !== null) {
    return interaction.reply({
      content:
        '❌ **Mode Chapter (Urgent) dan Mode Manga tidak dapat digunakan bersamaan.**\n' +
        '• Untuk pekerjaan manga → isi `manga`, biarkan `urgent` kosong.\n' +
        '• Untuk chapter urgent → isi `urgent`, biarkan `manga` kosong.',
      ephemeral: true,
    });
  }

  // ── KTL tidak mendukung manga ─────────────────────────────────────────────
  if (role === 'KTL' && mangaPages !== null) {
    return interaction.reply({
      content:
        '❌ **KTL tidak mendukung Mode Manga.**\n' +
        'Gunakan `manga` hanya untuk role ETL atau TS.\n' +
        'Untuk KTL, kosongkan `manga` agar dihitung sebagai 1 chapter.',
      ephemeral: true,
    });
  }

  // ── Resolve caller ────────────────────────────────────────────────────────
  const userId   = String(interaction.user.id);
  const username = interaction.member?.displayName ?? interaction.user.username;

  // ── Amount calculation ────────────────────────────────────────────────────
  let amount;
  let descLine;

  if (mangaPages !== null) {
    // Manga mode: pages × MANGA_PAGE_RATE (no urgent bonus — modes are exclusive)
    const pageRate = MANGA_PAGE_RATE[role] ?? 0;
    amount   = mangaPages * pageRate;
    descLine = `📖 Manga — ${mangaPages} hal × ${formatAmount(pageRate)}`;
  } else {
    // Chapter mode: PAYRATES[role] + urgent bonus if urgent
    amount   = calculateAmount(role, urgent, null);
    descLine = `📄 1 Chapter${urgent ? ' (Urgent/Inrush)' : ''}`;
  }

  await interaction.deferReply({ ephemeral: true });

  // ── Get active period ─────────────────────────────────────────────────────
  const period = await getActivePeriod(pool);

  // ── Insert into payment_ledger ────────────────────────────────────────────
  // auction_id and chapter are null for manual entries.
  await insertLedgerEntry(pool, {
    userId,
    username,
    auctionId:  null,
    chapter:    null,
    role,
    amount,
    urgent,    // false for manga mode (mutually exclusive enforced above)
    customRate: null,
    period,
  });

  // ── Create / update staff balance embed ───────────────────────────────────
  const entries = await getUserEntries(pool, userId, period);
  try {
    await upsertStaffBalanceEmbed(pool, interaction.client, userId, username, period, entries, true);
  } catch (err) {
    console.error('[AddBalance] Staff embed error:', err);
    // Non-fatal — balance is already recorded in the ledger
  }

  // ── Ephemeral confirmation ────────────────────────────────────────────────
  await interaction.followUp({
    content:
      `✅ **Balance berhasil ditambahkan!**\n\n` +
      `🎭 Role   : **${role}**${urgent ? '  🔥 Urgent' : ''}\n` +
      `${descLine}\n` +
      `💰 Nominal: **${formatAmount(amount)}**\n\n` +
      `Silakan cek \`/mybalance\` untuk melihat saldo terbaru.`,
    ephemeral: true,
  });
}

module.exports = { data, execute };
