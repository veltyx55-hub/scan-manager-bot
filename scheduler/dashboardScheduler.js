'use strict';

/**
 * dashboardScheduler.js
 *
 * Refreshes the payment dashboard embed every 30 seconds.
 *
 * Why a scheduler instead of updating on every /done:
 *   - Many staff may finish chapters within seconds of each other.
 *   - The dashboard only shows aggregate totals, so mid-burst edits are wasted
 *     Discord API calls that risk triggering rate limits.
 *   - Staff balance embeds are still updated instantly in paymentService.js;
 *     only the dashboard (summary) is deferred.
 */

const { getActivePeriod, isPaymentLocked } = require('../utils/paymentHelper');
const { updateDashboardEmbedIfExists }     = require('../payment/paymentService');

const INTERVAL_MS = 30_000; // 30 seconds

/**
 * Start the dashboard refresh scheduler.
 *
 * @param {import('pg').Pool}           pool
 * @param {import('discord.js').Client} client
 */
function startDashboardScheduler(pool, client) {
  const run = () => tick(pool, client).catch(err =>
    console.error('[DashboardScheduler] Error:', err)
  );

  // Run once immediately so the dashboard is current right after bot start
  run();
  setInterval(run, INTERVAL_MS);
  console.log(`✅ Dashboard scheduler started (every ${INTERVAL_MS / 1000}s)`);
}

async function tick(pool, client) {
  const period = await getActivePeriod(pool);
  const locked = await isPaymentLocked(pool);

  // isOpen = !locked (closed period → show CLOSED badge, but still refresh if msg exists)
  await updateDashboardEmbedIfExists(pool, client, period, !locked);
}

module.exports = { startDashboardScheduler };
