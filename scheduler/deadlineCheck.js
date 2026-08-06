'use strict';

const { ADMIN_ROLE_ID, REMINDER_STAGES } = require('../config');
const { refreshAuctionMessage } = require('../utils/refreshAuction');

/**
 * Start the 5-minute deadline checker loop.
 * @param {import('discord.js').Client} client
 * @param {import('pg').Pool} pool
 */
function startDeadlineCheck(client, pool) {
  // Run immediately, then every 5 minutes
  const run = () => checkDeadlines(client, pool).catch(err =>
    console.error('[DeadlineCheck] Error:', err)
  );
  run();
  setInterval(run, 5 * 60 * 1000);
  console.log('✅ Deadline checker started (every 5 min)');
}

async function checkDeadlines(client, pool) {
  const res = await pool.query(`
    SELECT ca.id, ca.assignee_id, ca.role, ca.chapter,
           ca.deadline_at, ca.reminder_stage,
           a.project_channel_id, a.guild_id, a.id AS auction_id,
           a.custom_deadline
    FROM chapter_assignments ca
    JOIN auctions a ON a.id = ca.auction_id
    WHERE ca.status='claimed' AND ca.deadline_at IS NOT NULL
  `);

  const now = new Date();

  for (const r of res.rows) {
    const guild = client.guilds.cache.get(r.guild_id);
    if (!guild) continue;

    const projectCh = guild.channels.cache.get(r.project_channel_id);
    const deadlineAt = new Date(r.deadline_at);
    const remainingS = (deadlineAt - now) / 1000;

    // ── EXPIRED ──────────────────────────────────────────────────────────
    if (remainingS <= 0) {
      if (projectCh) {
        let notice =
          `⚠️ **DEADLINE HABIS!**\n` +
          `<@${r.assignee_id}> tidak menyelesaikan ` +
          `**${r.role} #${r.chapter}** tepat waktu.\n` +
          `📁 Project: <#${r.project_channel_id}>\n` +
          `Chapter akan dilelang ulang.`;
        if (ADMIN_ROLE_ID) {
          notice += `\n🔔 <@&${ADMIN_ROLE_ID}> perlu reauction **${r.role} #${r.chapter}**`;
        }
        await projectCh.send(notice);
      }

      await pool.query(`
        UPDATE chapter_assignments
        SET status='available', assignee_id=NULL, assignee_name=NULL,
            claimed_at=NULL, deadline_at=NULL, reminder_stage=0
        WHERE id=$1
      `, [r.id]);

      await refreshAuctionMessage(client, pool, r.auction_id);
      continue;
    }

    // ── TIERED REMINDERS ─────────────────────────────────────────────────
    const remainingH = remainingS / 3600;
    const customDl = r.custom_deadline; // hours int or null
    const isShort = customDl !== null && customDl >= 1 && customDl <= 3;

    if (isShort) {
      // Urgent-only reminders (stages 91/92 — never conflict with normal 1-5)
      let urgentStages;
      if (customDl >= 3) {
        urgentStages = [
          [2, 91, '⏰ Sisa **2 jam** lagi!'],
          [1, 92, '🔴 Sisa **1 jam** lagi!'],
        ];
      } else {
        urgentStages = [[1, 91, '🔴 Sisa **1 jam** lagi!']];
      }

      let bestStage = 0;
      let bestLabel = '';
      for (const [hours, stageNum, label] of urgentStages) {
        if (remainingH <= hours && stageNum > r.reminder_stage && stageNum > bestStage) {
          bestStage = stageNum;
          bestLabel = label;
        }
      }

      if (bestStage > 0 && projectCh) {
        const ts = Math.floor(deadlineAt.getTime() / 1000);
        await projectCh.send(
          `⏰ **Reminder Deadline (Urgent)**\n` +
          `<@${r.assignee_id}> | **${r.role} #${r.chapter}**\n` +
          `📁 Project: <#${r.project_channel_id}>\n` +
          `${bestLabel}\n` +
          `Deadline: <t:${ts}:F> (<t:${ts}:R>)`
        );
        await pool.query(
          'UPDATE chapter_assignments SET reminder_stage=$1 WHERE id=$2',
          [bestStage, r.id]
        );
      }
    } else {
      // Normal tiered reminders
      let bestStage = 0;
      let bestLabel = '';
      for (const [hours, stageNum, label] of REMINDER_STAGES) {
        if (remainingH <= hours && stageNum > bestStage) {
          bestStage = stageNum;
          bestLabel = label;
        }
      }

      if (bestStage > r.reminder_stage && projectCh) {
        const ts = Math.floor(deadlineAt.getTime() / 1000);
        await projectCh.send(
          `⏰ **Reminder Deadline**\n` +
          `<@${r.assignee_id}> | **${r.role} #${r.chapter}**\n` +
          `📁 Project: <#${r.project_channel_id}>\n` +
          `${bestLabel}\n` +
          `Deadline: <t:${ts}:F> (<t:${ts}:R>)`
        );
        await pool.query(
          'UPDATE chapter_assignments SET reminder_stage=$1 WHERE id=$2',
          [bestStage, r.id]
        );
      }
    }
  }
}

module.exports = { startDeadlineCheck };
