'use strict';

/**
 * lockScheduler.js
 *
 * Locks the payment system at 00:00 WIB on the 1st of each month.
 * Staff can no longer use /done after the lock until an admin runs /closeperiod,
 * which closes the old period, opens a new one, and unlocks payment.
 *
 * Lock state is stored in:
 *   bot_config  key = 'payment_locked'      value '1' = locked, '0' = unlocked
 *   bot_config  key = 'last_lock_wib_date'  value "YYYY-MM-DD" (WIB)
 *
 * Startup safety rules (run once before the first interval tick):
 *   1. If last_lock_wib_date is empty → first-ever run, seed today's date, no lock.
 *   2. If today is NOT the 1st of the month AND payment_locked = '1'
 *      → stale / incorrect lock, reset to '0' automatically.
 *      This handles: bot restarted after a previous bug left the lock stuck.
 */

const {
  isPaymentLocked,
  setPaymentLocked,
  getConfig,
  setConfig,
  todayWIB,
} = require('../utils/paymentHelper');

const INTERVAL_MS = 60_000; // check every minute

function startLockScheduler(pool) {
  // Run recovery synchronously before the first tick so /done is never wrongly
  // blocked during the period between bot start and the first interval fire.
  recoverLockState(pool)
    .then(() => {
      // Start the regular minute-by-minute check
      const run = () => checkAndLock(pool).catch(err =>
        console.error('[LockScheduler] Error:', err)
      );
      run();
      setInterval(run, INTERVAL_MS);
      console.log('✅ Lock scheduler started (checks every 1 min, locks on 1st of WIB month)');
    })
    .catch(err => console.error('[LockScheduler] Recovery error:', err));
}

/**
 * Startup auto-recovery.
 * Resets a stale lock that was incorrectly set (e.g. by a previous bot bug).
 * Rule: if today is NOT the 1st of the WIB month and the lock is ON → turn it OFF.
 */
async function recoverLockState(pool) {
  const today      = todayWIB();                                   // "YYYY-MM-DD"
  const dayOfMonth = parseInt(today.split('-')[2], 10);
  const locked     = await isPaymentLocked(pool);

  if (locked && dayOfMonth !== 1) {
    await setPaymentLocked(pool, false);
    console.log(
      `[LockScheduler] ⚠️  Stale lock detected (payment_locked was '1' but today is ${today}, not the 1st).` +
      ` Automatically reset to unlocked. Payment is now OPEN.`
    );
  } else {
    console.log(
      `[LockScheduler] Startup check — locked=${locked}, WIB date=${today}. ` +
      (locked ? 'Lock is valid (1st of month). Keeping locked.' : 'Payment is OPEN. No action needed.')
    );
  }
}

/**
 * Called every minute. Locks payment when the WIB calendar rolls over to the 1st.
 */
async function checkAndLock(pool) {
  const today        = todayWIB();
  const lastLockDate = (await getConfig(pool, 'last_lock_wib_date')) || '';

  // First ever run after recovery: seed the date, do NOT lock
  if (!lastLockDate) {
    await setConfig(pool, 'last_lock_wib_date', today);
    console.log(`[LockScheduler] First run — WIB date seeded to ${today}. No lock triggered.`);
    return;
  }

  // Already processed today — nothing to do
  if (lastLockDate === today) return;

  // Day changed — update stored date
  await setConfig(pool, 'last_lock_wib_date', today);

  // Only lock on the 1st of the WIB month
  const dayOfMonth = parseInt(today.split('-')[2], 10);
  if (dayOfMonth !== 1) return;

  // It's the 1st of a new WIB month → lock payment
  const alreadyLocked = await isPaymentLocked(pool);
  if (!alreadyLocked) {
    await setPaymentLocked(pool, true);
    console.log(`[LockScheduler] ⏰ Payment locked — new period started (WIB: ${today}). Admin must run /closeperiod.`);
  }
}

module.exports = { startLockScheduler };
