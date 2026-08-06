'use strict';

const { Pool } = require('pg');
const { runPaymentMigration } = require('./paymentMigration');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

async function initDb() {
  const client = await getPool().connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS auctions (
        id                  SERIAL PRIMARY KEY,
        guild_id            TEXT,
        project_channel_id  TEXT,
        project_name        TEXT,
        auction_message_id  TEXT,
        auction_channel_id  TEXT,
        urgent              BOOLEAN DEFAULT FALSE,
        created_at          TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS chapter_assignments (
        id             SERIAL PRIMARY KEY,
        auction_id     INTEGER,
        chapter        TEXT,
        role           TEXT,
        assignee_id    TEXT,
        assignee_name  TEXT,
        status         TEXT DEFAULT 'available',
        claimed_at     TIMESTAMPTZ,
        deadline_at    TIMESTAMPTZ,
        done_at        TIMESTAMPTZ,
        reminder_stage INTEGER DEFAULT 0
      )
    `);

    // Safe migrations for existing tables
    await client.query(`
      ALTER TABLE chapter_assignments
      ADD COLUMN IF NOT EXISTS reminder_stage INTEGER DEFAULT 0
    `);
    await client.query(`
      ALTER TABLE auctions ADD COLUMN IF NOT EXISTS custom_deadline INTEGER
    `);
    await client.query(`
      ALTER TABLE auctions ADD COLUMN IF NOT EXISTS custom_rate INTEGER
    `);

    // auction_type distinguishes TL (KTL+ETL) from TS auctions.
    // DEFAULT 'TL' backfills existing rows safely in PostgreSQL 11+.
    await client.query(`
      ALTER TABLE auctions ADD COLUMN IF NOT EXISTS auction_type TEXT DEFAULT 'TL'
    `);

    console.log('✅ Database initialized');
  } finally {
    client.release();
  }

  // Run payment system migration (safe to re-run; uses IF NOT EXISTS + ON CONFLICT DO NOTHING)
  await runPaymentMigration(getPool());
}

module.exports = { getPool, initDb };
