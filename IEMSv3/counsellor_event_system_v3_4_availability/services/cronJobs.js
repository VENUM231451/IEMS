/**
 * Cron Jobs - Background job scheduler for notifications
 */

const cron = require('node-cron');
const notificationEngine = require('./notificationEngine');

/**
 * Start all scheduled background jobs
 */
function startCronJobs() {
  console.log("[CronJobs] Starting background job scheduler...");

  // Daily at 6:00 AM - Check event reminders
  cron.schedule('0 6 * * *', () => {
    console.log("[CronJobs] Running daily event reminder check...");
    try {
      notificationEngine.checkEventReminders();
    } catch (e) {
      console.error("[CronJobs] Event reminder check failed:", e.message);
    }
  }, {
    timezone: "UTC"
  });

  // Every 6 hours - Check for anomalies (0:00, 6:00, 12:00, 18:00)
  cron.schedule('0 */6 * * *', () => {
    console.log("[CronJobs] Running anomaly detection...");
    try {
      notificationEngine.detectAnomalies();
    } catch (e) {
      console.error("[CronJobs] Anomaly detection failed:", e.message);
    }
  }, {
    timezone: "UTC"
  });

  // Weekly on Monday at 7:00 AM - Generate weekly report
  cron.schedule('0 7 * * 1', () => {
    console.log("[CronJobs] Generating weekly report...");
    try {
      notificationEngine.generateWeeklyReport();
    } catch (e) {
      console.error("[CronJobs] Weekly report generation failed:", e.message);
    }
  }, {
    timezone: "UTC"
  });

  // Every 15 minutes - Check for counsellor overload
  cron.schedule('*/15 * * * *', () => {
    console.log("[CronJobs] Checking counsellor workload...");
    try {
      notificationEngine.checkCounsellorOverload();
    } catch (e) {
      console.error("[CronJobs] Counsellor overload check failed:", e.message);
    }
  }, {
    timezone: "UTC"
  });

  // Every hour - Clean up expired notifications
  cron.schedule('0 * * * *', () => {
    console.log("[CronJobs] Cleaning up expired notifications...");
    try {
      cleanupExpiredNotifications();
    } catch (e) {
      console.error("[CronJobs] Notification cleanup failed:", e.message);
    }
  }, {
    timezone: "UTC"
  });

  console.log("[CronJobs] Background jobs scheduled:");
  console.log("  - Event reminders: Daily at 6:00 AM UTC");
  console.log("  - Anomaly detection: Every 6 hours");
  console.log("  - Weekly report: Monday at 7:00 AM UTC");
  console.log("  - Counsellor overload: Every 15 minutes");
  console.log("  - Notification cleanup: Every hour");
}

/**
 * Clean up expired notifications
 */
function cleanupExpiredNotifications() {
  const db = require('../db');

  try {
    const result = db.prepare(`
      DELETE FROM notifications
      WHERE expires_at IS NOT NULL
        AND datetime(expires_at) < datetime('now')
    `).run();

    if (result.changes > 0) {
      console.log(`[CronJobs] Cleaned up ${result.changes} expired notifications`);
    }
  } catch (e) {
    console.error("[CronJobs] Cleanup error:", e.message);
  }
}

/**
 * Run initial checks on startup (optional, useful for testing)
 */
function runInitialChecks() {
  console.log("[CronJobs] Running initial notification checks...");

  // Run with slight delay to ensure DB is ready
  setTimeout(() => {
    try {
      notificationEngine.checkEventReminders();
      notificationEngine.checkCounsellorOverload();
    } catch (e) {
      console.error("[CronJobs] Initial check error:", e.message);
    }
  }, 2000);
}

module.exports = {
  startCronJobs,
  runInitialChecks,
  cleanupExpiredNotifications
};
