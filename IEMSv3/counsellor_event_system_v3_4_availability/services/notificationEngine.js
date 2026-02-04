/**
 * Notification Engine - Core notification generation and detection logic
 */

const db = require("../db");

// =============================================
// UTILITY FUNCTIONS
// =============================================

/**
 * Get a notification setting value
 */
function getSetting(key) {
  const row = db.prepare(`SELECT setting_value FROM notification_settings WHERE setting_key = ?`).get(key);
  return row ? row.setting_value : null;
}

/**
 * Check if a setting is enabled (boolean check)
 */
function isSettingEnabled(key) {
  const value = getSetting(key);
  return value === 'true' || value === '1';
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/**
 * Check if two date ranges overlap
 */
function datesOverlap(start1, end1, start2, end2) {
  return !(end1 < start2 || start1 > end2);
}

/**
 * Calculate days between today and a date
 */
function daysUntil(dateStr) {
  const now = new Date();
  // Normalize both to UTC midnight to track pure calendar days
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const target = new Date(dateStr); // Parsed as UTC midnight by default for YYYY-MM-DD
  const diffTime = target - today;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// =============================================
// CORE NOTIFICATION FUNCTIONS
// =============================================

/**
 * Create a new notification
 */
function createNotification(type, priority, title, message, metadata = null, targetRole = 'admin', targetUser = null, relatedSubmissionId = null) {
  try {
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    // For weekly reports, always create fresh - delete ALL old ones first
    if (type === 'weekly_report') {
      const deleteResult = db.prepare(`
        DELETE FROM notifications WHERE type = 'weekly_report'
      `).run();
      console.log(`[NotificationEngine] Deleted ${deleteResult.changes} old weekly report(s)`);
    } else {
      // Check for existing similar notification to avoid duplicates (for other types)
      const existing = db.prepare(`
        SELECT id FROM notifications
        WHERE type = ? AND title = ? AND status = 'unread'
        AND (related_submission_id = ? OR (related_submission_id IS NULL AND ? IS NULL))
        AND datetime(created_at) > datetime('now', '-1 hour')
      `).get(type, title, relatedSubmissionId, relatedSubmissionId);

      if (existing) {
        return existing.id; // Don't create duplicate
      }
    }

    const result = db.prepare(`
      INSERT INTO notifications (type, priority, title, message, metadata, target_role, target_user, related_submission_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(type, priority, title, message, metadataJson, targetRole, targetUser, relatedSubmissionId);

    console.log(`[NotificationEngine] Created notification ID ${result.lastInsertRowid} of type ${type}`);
    return result.lastInsertRowid;
  } catch (e) {
    console.error("Error creating notification:", e.message);
    return null;
  }
}

/**
 * Log an activity for anomaly detection
 */
function logActivity(action, username, details = null, ipAddress = null) {
  try {
    const detailsJson = details ? JSON.stringify(details) : null;
    db.prepare(`
      INSERT INTO activity_log (action, username, details, ip_address)
      VALUES (?, ?, ?, ?)
    `).run(action, username, detailsJson, ipAddress);
  } catch (e) {
    console.error("Error logging activity:", e.message);
  }
}

// =============================================
// EVENT REMINDERS
// =============================================

/**
 * Calculate reminder priority based on days until event
 */
function calculateReminderPriority(daysUntilEvent) {
  if (daysUntilEvent <= 1) return 'critical';
  if (daysUntilEvent <= 3) return 'high';
  if (daysUntilEvent <= 7) return 'high';
  if (daysUntilEvent <= 14) return 'medium';
  if (daysUntilEvent <= 30) return 'low';
  return null;
}

/**
 * Check for events approaching without confirmed staffing
 * Called by cron job daily
 */
function checkEventReminders() {
  if (!isSettingEnabled('event_reminder_enabled')) {
    console.log("[NotificationEngine] Event reminders disabled");
    return 0;
  }

  console.log("[NotificationEngine] Checking event reminders...");

  try {
    const reminderDays = JSON.parse(getSetting('event_reminder_days') || '[30, 14, 7, 3, 1]');

    // Get upcoming events that are pending or have no assignments
    const events = db.prepare(`
      SELECT s.id, s.start_date, s.end_date, s.city, s.country, s.organizer, s.status,
        (SELECT COUNT(*) FROM submission_assignments sa WHERE sa.submission_id = s.id) as assignment_count
      FROM submissions s
      WHERE s.event_status NOT IN ('COMPLETED', 'CANCELLED')
        AND date(s.start_date) >= date('now')
        AND date(s.start_date) <= date('now', '+30 days')
    `).all();

    let remindersCreated = 0;

    for (const event of events) {
      const days = daysUntil(event.start_date);

      // Check if this is a reminder day
      const isReminderDay = reminderDays.some(d => days <= d && days > (d === 1 ? 0 : d - 1));

      if (!isReminderDay) continue;

      // Determine what needs attention
      const issues = [];
      if (event.status === 'pending') {
        issues.push('not confirmed');
      }
      if (event.assignment_count === 0) {
        issues.push('no staff assigned');
      }

      if (issues.length === 0) continue; // Event is good

      const priority = calculateReminderPriority(days);
      if (!priority) continue;

      const title = `Event in ${days} day${days !== 1 ? 's' : ''} needs attention`;
      const message = `"${event.organizer}" in ${event.city}, ${event.country} (${event.start_date} to ${event.end_date}) is ${issues.join(' and ')}.`;

      createNotification(
        'event_reminder',
        priority,
        title,
        message,
        { submission_id: event.id, days_until: days, issues },
        'admin',
        null,
        event.id
      );
      remindersCreated++;
    }

    console.log(`[NotificationEngine] Created ${remindersCreated} event reminders`);
    return remindersCreated;
  } catch (e) {
    console.error("[NotificationEngine] Error checking event reminders:", e.message);
    return 0;
  }
}

// =============================================
// DUPLICATE DETECTION
// =============================================

/**
 * Calculate similarity between two submissions
 */
function calculateSimilarity(sub1, sub2) {
  let score = 0;
  const factors = [];

  // Same organizer (weight: 0.35)
  if (sub1.organizer_id && sub2.organizer_id && sub1.organizer_id === sub2.organizer_id) {
    score += 0.35;
    factors.push('Same organizer');
  } else if (sub1.organizer && sub2.organizer && sub1.organizer.toLowerCase() === sub2.organizer.toLowerCase()) {
    score += 0.30;
    factors.push('Similar organizer name');
  }

  // Overlapping dates (weight: 0.25)
  if (datesOverlap(sub1.start_date, sub1.end_date, sub2.start_date, sub2.end_date)) {
    score += 0.25;
    factors.push('Overlapping dates');
  }

  // Same country (weight: 0.15)
  if (sub1.country && sub2.country && sub1.country.toLowerCase() === sub2.country.toLowerCase()) {
    score += 0.15;
    factors.push('Same country');
  }

  // Similar city - Levenshtein distance (weight: 0.15)
  if (sub1.city && sub2.city) {
    const city1 = sub1.city.toLowerCase();
    const city2 = sub2.city.toLowerCase();
    const distance = levenshteinDistance(city1, city2);
    const maxLen = Math.max(city1.length, city2.length);
    const citySimilarity = maxLen > 0 ? 1 - (distance / maxLen) : 0;

    if (citySimilarity >= 0.8) {
      score += 0.15;
      factors.push('Similar city');
    }
  }

  // Same event name (weight: 0.10)
  if (sub1.event_name_id && sub2.event_name_id && sub1.event_name_id === sub2.event_name_id) {
    score += 0.10;
    factors.push('Same event name');
  }

  return { score: Math.round(score * 100) / 100, factors };
}

/**
 * Detect duplicates for a new submission
 * Called when a new submission is created
 */
function detectDuplicates(newSubmissionId) {
  if (!isSettingEnabled('duplicate_detection_enabled')) {
    return [];
  }

  console.log(`[NotificationEngine] Checking duplicates for submission ${newSubmissionId}...`);

  try {
    const threshold = parseFloat(getSetting('duplicate_threshold') || '0.7');

    // Get the new submission
    const newSub = db.prepare(`
      SELECT id, start_date, end_date, organizer, organizer_id, city, country, event_name_id, submitted_by
      FROM submissions WHERE id = ?
    `).get(newSubmissionId);

    if (!newSub) return [];

    // Get potential matches (same country or overlapping dates, excluding self)
    const candidates = db.prepare(`
      SELECT id, start_date, end_date, organizer, organizer_id, city, country, event_name_id, submitted_by
      FROM submissions
      WHERE id != ?
        AND event_status NOT IN ('CANCELLED')
        AND (
          country = ?
          OR (date(start_date) <= date(?) AND date(end_date) >= date(?))
        )
      ORDER BY created_at DESC
      LIMIT 50
    `).all(newSubmissionId, newSub.country, newSub.end_date, newSub.start_date);

    const duplicates = [];

    for (const candidate of candidates) {
      // Check if already dismissed
      const dismissed = db.prepare(`
        SELECT 1 FROM duplicate_dismissals
        WHERE (submission_id_1 = ? AND submission_id_2 = ?)
           OR (submission_id_1 = ? AND submission_id_2 = ?)
      `).get(newSubmissionId, candidate.id, candidate.id, newSubmissionId);

      if (dismissed) continue;

      const { score, factors } = calculateSimilarity(newSub, candidate);

      if (score >= threshold) {
        duplicates.push({
          existingSubmissionId: candidate.id,
          score,
          factors
        });

        // Create notification
        const title = `Possible duplicate event detected`;
        const message = `New submission for "${newSub.organizer}" in ${newSub.city} (${newSub.start_date}) is ${Math.round(score * 100)}% similar to existing event #${candidate.id}.`;

        createNotification(
          'duplicate_detected',
          score >= 0.9 ? 'high' : 'medium',
          title,
          message,
          {
            new_submission_id: newSubmissionId,
            existing_submission_id: candidate.id,
            score,
            factors
          },
          'admin',
          null,
          newSubmissionId
        );
      }
    }

    console.log(`[NotificationEngine] Found ${duplicates.length} potential duplicates`);
    return duplicates;
  } catch (e) {
    console.error("[NotificationEngine] Error detecting duplicates:", e.message);
    return [];
  }
}

// =============================================
// STAFFING WARNINGS
// =============================================

/**
 * Check for overloaded counsellors
 */
function checkCounsellorOverload() {
  if (!isSettingEnabled('staffing_warning_enabled')) {
    return 0;
  }

  console.log("[NotificationEngine] Checking counsellor overload...");

  try {
    const threshold = parseInt(getSetting('counsellor_overload_threshold') || '5');

    // Get counsellors with concurrent event counts in next 30 days
    const overloaded = db.prepare(`
      SELECT c.id, c.full_name, c.username, COUNT(DISTINCT sa.submission_id) as event_count,
        GROUP_CONCAT(s.city || ' (' || s.start_date || ')', ', ') as events
      FROM counsellors c
      JOIN submission_assignments sa ON sa.counsellor_id = c.id
      JOIN submissions s ON s.id = sa.submission_id
      WHERE c.is_active = 1
        AND s.status = 'confirmed'
        AND s.event_status NOT IN ('COMPLETED', 'CANCELLED')
        AND date(s.start_date) >= date('now')
        AND date(s.start_date) <= date('now', '+30 days')
      GROUP BY c.id
      HAVING event_count >= ?
    `).all(threshold);

    for (const counsellor of overloaded) {
      const title = `Counsellor workload alert`;
      const message = `${counsellor.full_name} has ${counsellor.event_count} events in the next 30 days. Events: ${counsellor.events}`;

      createNotification(
        'staffing_warning',
        counsellor.event_count >= threshold + 2 ? 'high' : 'medium',
        title,
        message,
        { counsellor_id: counsellor.id, event_count: counsellor.event_count },
        'admin'
      );
    }

    console.log(`[NotificationEngine] Found ${overloaded.length} overloaded counsellors`);
    return overloaded.length;
  } catch (e) {
    console.error("[NotificationEngine] Error checking counsellor overload:", e.message);
    return 0;
  }
}

// =============================================
// WEEKLY REPORT
// =============================================

/**
 * Generate weekly intelligence report
 * @param {boolean} force - If true, bypass the enabled check (for manual triggers)
 */
function generateWeeklyReport(force = false) {
  if (!force && !isSettingEnabled('weekly_report_enabled')) {
    console.log("[NotificationEngine] Weekly report disabled");
    return false;
  }

  console.log("[NotificationEngine] Generating weekly report...");

  try {
    // TOTAL events in next 30 days
    const totalUpcoming = db.prepare(`
      SELECT COUNT(*) as count FROM submissions
      WHERE status IN ('pending', 'confirmed')
        AND event_status NOT IN ('COMPLETED', 'CANCELLED')
        AND date(start_date) >= date('now')
        AND date(start_date) <= date('now', '+30 days')
    `).get();

    // Events without staffing in next 30 days
    const unstaffedEvents = db.prepare(`
      SELECT COUNT(*) as count FROM submissions s
      WHERE s.status IN ('pending', 'confirmed')
        AND s.event_status NOT IN ('COMPLETED', 'CANCELLED')
        AND date(s.start_date) >= date('now')
        AND date(s.start_date) <= date('now', '+30 days')
        AND NOT EXISTS (SELECT 1 FROM submission_assignments sa WHERE sa.submission_id = s.id)
    `).get();

    // Pending events older than 7 days
    const agingPending = db.prepare(`
      SELECT COUNT(*) as count FROM submissions
      WHERE status = 'pending'
        AND datetime(created_at) < datetime('now', '-7 days')
        AND event_status NOT IN ('CANCELLED')
    `).get();

    // Events next week
    const nextWeekEvents = db.prepare(`
      SELECT COUNT(*) as count FROM submissions
      WHERE status = 'confirmed'
        AND event_status NOT IN ('COMPLETED', 'CANCELLED')
        AND date(start_date) >= date('now')
        AND date(start_date) <= date('now', '+7 days')
    `).get();

    // Active counsellors
    const activeCounsellors = db.prepare(`
      SELECT COUNT(*) as count FROM counsellors WHERE is_active = 1
    `).get();

    // Build report message with bullet points
    const reportItems = [];

    // Total upcoming events first
    reportItems.push(`📊 ${totalUpcoming.count} total event(s) in next 30 days`);

    // Critical items
    if (unstaffedEvents.count > 0) {
      reportItems.push(`\u26A0 ${unstaffedEvents.count} event(s) need staffing`);
    }
    if (agingPending.count > 0) {
      reportItems.push(`\u23F0 ${agingPending.count} event(s) pending over 7 days`);
    }

    // Status items
    reportItems.push(`\u{1F4C5} ${nextWeekEvents.count} event(s) next week`);
    reportItems.push(`\u{1F465} ${activeCounsellors.count} active counsellor(s)`);

    const priority = unstaffedEvents.count > 5 || agingPending.count > 10 ? 'high' : 'medium';
    const title = `Weekly Intelligence Report`;
    const message = reportItems.join(' | ');

    createNotification(
      'weekly_report',
      priority,
      title,
      message,
      {
        total_upcoming: totalUpcoming.count,
        unstaffed_events: unstaffedEvents.count,
        aging_pending: agingPending.count,
        next_week_events: nextWeekEvents.count,
        active_counsellors: activeCounsellors.count
      },
      'admin'
    );

    console.log("[NotificationEngine] Weekly report generated");
    return true;
  } catch (e) {
    console.error("[NotificationEngine] Error generating weekly report:", e.message);
    return false;
  }
}

// =============================================
// ANOMALY DETECTION
// =============================================

/**
 * Detect anomalies in system activity
 */
function detectAnomalies() {
  if (!isSettingEnabled('anomaly_detection_enabled')) {
    return 0;
  }

  console.log("[NotificationEngine] Checking for anomalies...");

  try {
    let anomaliesFound = 0;

    // Rule 1: Bulk deletions (5+ in 10 minutes by same user)
    const bulkDeletions = db.prepare(`
      SELECT username, COUNT(*) as delete_count
      FROM activity_log
      WHERE action = 'submission_deleted'
        AND datetime(created_at) > datetime('now', '-10 minutes')
      GROUP BY username
      HAVING delete_count >= 5
    `).all();

    for (const deletion of bulkDeletions) {
      createNotification(
        'anomaly',
        'critical',
        'Unusual activity detected',
        `User "${deletion.username}" deleted ${deletion.delete_count} submissions in the last 10 minutes.`,
        { username: deletion.username, action: 'bulk_deletion', count: deletion.delete_count },
        'admin'
      );
      anomaliesFound++;
    }

    // Rule 2: Volume spike (3x normal hourly volume)
    const hourlyAvg = db.prepare(`
      SELECT AVG(hourly_count) as avg_count FROM (
        SELECT COUNT(*) as hourly_count
        FROM activity_log
        WHERE action = 'submission_created'
          AND datetime(created_at) > datetime('now', '-7 days')
        GROUP BY strftime('%Y-%m-%d %H', created_at)
      )
    `).get();

    const currentHourCount = db.prepare(`
      SELECT COUNT(*) as count FROM activity_log
      WHERE action = 'submission_created'
        AND datetime(created_at) > datetime('now', '-1 hour')
    `).get();

    const avgCount = hourlyAvg.avg_count || 2; // Default to 2 if no history
    if (currentHourCount.count >= avgCount * 3 && currentHourCount.count >= 5) {
      createNotification(
        'anomaly',
        'medium',
        'Unusual submission volume',
        `${currentHourCount.count} submissions in the last hour (normal average: ${Math.round(avgCount)}).`,
        { current_count: currentHourCount.count, average: avgCount },
        'admin'
      );
      anomaliesFound++;
    }

    // Rule 3: Data entry errors (end date before start date)
    const dateErrors = db.prepare(`
      SELECT id, organizer, city, start_date, end_date, submitted_by
      FROM submissions
      WHERE date(end_date) < date(start_date)
        AND datetime(created_at) > datetime('now', '-24 hours')
    `).all();

    for (const error of dateErrors) {
      createNotification(
        'anomaly',
        'high',
        'Data entry error detected',
        `Event #${error.id} "${error.organizer}" in ${error.city} has end date (${error.end_date}) before start date (${error.start_date}).`,
        { submission_id: error.id, submitted_by: error.submitted_by },
        'admin',
        null,
        error.id
      );
      anomaliesFound++;
    }

    console.log("[NotificationEngine] Anomaly check complete");
    return anomaliesFound;
  } catch (e) {
    console.error("[NotificationEngine] Error detecting anomalies:", e.message);
    return 0;
  }
}

// =============================================
// EXPORTS
// =============================================

module.exports = {
  // Core functions
  createNotification,
  logActivity,
  getSetting,
  isSettingEnabled,

  // Detection functions
  checkEventReminders,
  detectDuplicates,
  calculateSimilarity,
  checkCounsellorOverload,
  generateWeeklyReport,
  detectAnomalies,

  // Utility functions
  datesOverlap,
  daysUntil,
  levenshteinDistance
};
