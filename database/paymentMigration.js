'use strict';

const MONTHS_ID = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember',
];

function getCurrentPeriodWIB() {
  const now   = new Date();
  const wib   = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return `${MONTHS_ID[wib.getUTCMonth()]} ${wib.getUTCFullYear()}`;
}

async function runPaymentMigration(pool) {
  const client = await pool.connect();
  try {
    // ── payment_ledger: permanent record of each completed chapter ────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_ledger (
        id          SERIAL PRIMARY KEY,
        user_id     TEXT NOT NULL,
        username    TEXT,
        auction_id  INTEGER,
        chapter     TEXT,
        role        TEXT,
        amount      INTEGER NOT NULL,
        urgent      BOOLEAN DEFAULT FALSE,
        custom_rate INTEGER,
        period      TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── bot_config: generic key-value for runtime state ───────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS bot_config (
        key   TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // ── payment_staff_messages: tracks which Discord message holds each
    //    staff member's balance embed for a given period ───────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_staff_messages (
        user_id    TEXT NOT NULL,
        period     TEXT NOT NULL,
        message_id TEXT,
        PRIMARY KEY (user_id, period)
      )
    `);

    // Seed defaults (ON CONFLICT DO NOTHING = safe for re-runs)
    const period = getCurrentPeriodWIB();
    await client.query(`
      INSERT INTO bot_config (key, value) VALUES ('active_period', $1)
      ON CONFLICT (key) DO NOTHING
    `, [period]);
    await client.query(`
      INSERT INTO bot_config (key, value) VALUES ('payment_locked', '0')
      ON CONFLICT (key) DO NOTHING
    `);
    await client.query(`
      INSERT INTO bot_config (key, value) VALUES ('last_lock_wib_date', '')
      ON CONFLICT (key) DO NOTHING
    `);

    console.log('✅ Payment migration complete');
  } finally {
    client.release();
  }
}

module.exports = { runPaymentMigration };
