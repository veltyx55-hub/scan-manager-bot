'use strict';

module.exports = {
  // ================= IDs =================
  GUILD_ID: '1424245362117447753',
  OWNER_ID: '1352261320677916732',

  AUCTION_CHANNELS: {
    TL: '1510325217896042536', // KTL + ETL
    TS: '1510325258224271421', // TS only
  },

  ROLE_IDS: {
    KTL: '1424283808269860884',
    ETL: '1424325518832177193',
    TS:  '1424324905108770899',
  },

  // ================= PAYRATES =================
  PAYRATES: {
    KTL: 5000,
    ETL: 3000,
    TS:  5000,
  },

  URGENT_BONUS: {
    TL: 2000, // applies to KTL + ETL
    TS: 2000, // applies to TS
  },

  // Per-page rate for Manga entries via /addbalance
  MANGA_PAGE_RATE: {
    ETL: 200,
    TS:  200,
  },

  DEADLINE_HOURS: { normal: 48, urgent: 3 },

  // Per-role urgent deadlines
  URGENT_DEADLINES: {
    KTL: 2,
    ETL: 2,
    TS:  3,
  },

  MAX_ACTIVE: 2,
  TL_ROLES: ['KTL', 'ETL'],

  ADMIN_ROLE_ID:    '1424282282142732348',  // Role to ping for TS alerts
  UPLOADER_ROLE_ID: '1436698468470231080',  // Role to ping when TS ready upload

  // Reminder stages: [hours_remaining, stage_number, label]
  REMINDER_STAGES: [
    [24, 1, '⏰ Deadline dalam **24 jam**'],
    [12, 2, '⏰ Deadline dalam **12 jam**'],
    [ 6, 3, '🟠 Deadline dalam **6 jam**'],
    [ 3, 4, '🟠 Deadline dalam **3 jam**'],
    [ 1, 5, '🔴 SEGERA! Deadline dalam **1 jam**'],
  ],

  // Fallback channel names when ID lookup fails
  CHANNEL_NAME_FALLBACK: {
    TL: ['lelang-tl', 'auction-tl', 'tl-auction'],
    TS: ['lelang-ts', 'auction-ts', 'ts-auction'],
  },

  // ================= PAYMENT SYSTEM =================
  // Replace these with your actual Discord channel/role IDs before use.

  // Channel where staff balance embeds and the payment dashboard are posted.
  STAFF_BALANCE_CHANNEL_ID: '1534605042160635986',
  
  // Channel where the close-period announcement is sent.
  ANNOUNCEMENT_CHANNEL_ID: '1424247230688399481',
  
  // Role to mention in the close-period announcement (@AllStaff or equivalent).
  ALL_STAFF_ROLE_ID: '1436694074093604904',
};
