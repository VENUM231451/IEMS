/**
 * Notification Routes - API endpoints for notification management
 */

const express = require("express");
const db = require("../db");
const { requireAuth } = require("./auth");
const notificationEngine = require("../services/notificationEngine");

const router = express.Router();

// =============================================
// NOTIFICATION ENDPOINTS
// =============================================

/**
 * GET /api/notifications
 * List notifications for current user
 * Query params: status, type, limit, offset
 */
router.get("/notifications", requireAuth(), (req, res) => {
  try {
    const { status, type, limit = 20, offset = 0 } = req.query;
    const user = req.user;

    let sql = `
      SELECT * FROM notifications
      WHERE (target_role = ? OR target_role = 'all' OR target_user = ?)
    `;
    const params = [user.role, user.username];

    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }

    if (type) {
      sql += ` AND type = ?`;
      params.push(type);
    }

    // Exclude expired notifications
    sql += ` AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`;

    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const notifications = db.prepare(sql).all(...params);

    // Parse metadata JSON
    const parsed = notifications.map(n => ({
      ...n,
      metadata: n.metadata ? JSON.parse(n.metadata) : null
    }));

    res.json({ ok: true, notifications: parsed });
  } catch (e) {
    console.error("Error fetching notifications:", e.message);
    res.status(500).json({ error: "Failed to fetch notifications." });
  }
});

/**
 * GET /api/notifications/unread-count
 * Get count of unread notifications for badge display
 */
router.get("/notifications/unread-count", requireAuth(), (req, res) => {
  try {
    const user = req.user;

    const result = db.prepare(`
      SELECT COUNT(*) as count FROM notifications
      WHERE (target_role = ? OR target_role = 'all' OR target_user = ?)
        AND status = 'unread'
        AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
    `).get(user.role, user.username);

    // Get latest notification for toast display
    const latest = db.prepare(`
      SELECT id, type, priority, title, message, created_at FROM notifications
      WHERE (target_role = ? OR target_role = 'all' OR target_user = ?)
        AND status = 'unread'
        AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
      ORDER BY created_at DESC
      LIMIT 1
    `).get(user.role, user.username);

    res.json({
      ok: true,
      count: result.count,
      latestNotification: latest || null
    });
  } catch (e) {
    console.error("Error fetching unread count:", e.message);
    res.status(500).json({ error: "Failed to fetch unread count." });
  }
});

/**
 * PUT /api/notifications/:id/read
 * Mark a notification as read
 */
router.put("/notifications/:id/read", requireAuth(), (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // Verify notification belongs to user
    const notification = db.prepare(`
      SELECT id FROM notifications
      WHERE id = ? AND (target_role = ? OR target_role = 'all' OR target_user = ?)
    `).get(id, user.role, user.username);

    if (!notification) {
      return res.status(404).json({ error: "Notification not found." });
    }

    db.prepare(`
      UPDATE notifications SET status = 'read', read_at = datetime('now')
      WHERE id = ?
    `).run(id);

    res.json({ ok: true });
  } catch (e) {
    console.error("Error marking notification read:", e.message);
    res.status(500).json({ error: "Failed to update notification." });
  }
});

/**
 * PUT /api/notifications/:id/dismiss
 * Dismiss a notification
 */
router.put("/notifications/:id/dismiss", requireAuth(), (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const notification = db.prepare(`
      SELECT id FROM notifications
      WHERE id = ? AND (target_role = ? OR target_role = 'all' OR target_user = ?)
    `).get(id, user.role, user.username);

    if (!notification) {
      return res.status(404).json({ error: "Notification not found." });
    }

    db.prepare(`
      UPDATE notifications SET status = 'dismissed', read_at = datetime('now')
      WHERE id = ?
    `).run(id);

    res.json({ ok: true });
  } catch (e) {
    console.error("Error dismissing notification:", e.message);
    res.status(500).json({ error: "Failed to dismiss notification." });
  }
});

/**
 * DELETE /api/notifications/:id
 * Delete a notification
 */
router.delete("/notifications/:id", requireAuth(), (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const notification = db.prepare(`
      SELECT id FROM notifications
      WHERE id = ? AND (target_role = ? OR target_role = 'all' OR target_user = ?)
    `).get(id, user.role, user.username);

    if (!notification) {
      return res.status(404).json({ error: "Notification not found." });
    }

    db.prepare(`DELETE FROM notifications WHERE id = ?`).run(id);

    res.json({ ok: true });
  } catch (e) {
    console.error("Error deleting notification:", e.message);
    res.status(500).json({ error: "Failed to delete notification." });
  }
});

/**
 * POST /api/notifications/mark-all-read
 * Mark all notifications as read for current user
 */
router.post("/notifications/mark-all-read", requireAuth(), (req, res) => {
  try {
    const user = req.user;

    db.prepare(`
      UPDATE notifications SET status = 'read', read_at = datetime('now')
      WHERE (target_role = ? OR target_role = 'all' OR target_user = ?)
        AND status = 'unread'
    `).run(user.role, user.username);

    res.json({ ok: true });
  } catch (e) {
    console.error("Error marking all read:", e.message);
    res.status(500).json({ error: "Failed to mark all as read." });
  }
});

/**
 * DELETE /api/notifications/clear-read
 * Delete all read notifications for current user
 */
router.delete("/notifications/clear-read", requireAuth(), (req, res) => {
  try {
    const user = req.user;

    const result = db.prepare(`
      DELETE FROM notifications
      WHERE (target_role = ? OR target_role = 'all' OR target_user = ?)
        AND status IN ('read', 'dismissed')
    `).run(user.role, user.username);

    res.json({ ok: true, deleted: result.changes });
  } catch (e) {
    console.error("Error clearing read notifications:", e.message);
    res.status(500).json({ error: "Failed to clear notifications." });
  }
});

// =============================================
// NOTIFICATION SETTINGS (Admin Only)
// =============================================

/**
 * GET /api/notifications/settings
 * Get all notification settings (admin only)
 */
router.get("/notifications/settings", requireAuth("admin"), (req, res) => {
  try {
    const settings = db.prepare(`SELECT * FROM notification_settings`).all();

    // Convert to object format
    const settingsObj = {};
    for (const setting of settings) {
      settingsObj[setting.setting_key] = {
        value: setting.setting_value,
        description: setting.description
      };
    }

    res.json({ ok: true, settings: settingsObj });
  } catch (e) {
    console.error("Error fetching settings:", e.message);
    res.status(500).json({ error: "Failed to fetch settings." });
  }
});

/**
 * PUT /api/notifications/settings
 * Update notification settings (admin only)
 */
router.put("/notifications/settings", requireAuth("admin"), (req, res) => {
  try {
    const { settings } = req.body;

    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: "Settings object required." });
    }

    const updateStmt = db.prepare(`
      UPDATE notification_settings
      SET setting_value = ?, updated_at = datetime('now')
      WHERE setting_key = ?
    `);

    const tx = db.transaction(() => {
      for (const [key, value] of Object.entries(settings)) {
        updateStmt.run(String(value), key);
      }
    });

    tx();

    res.json({ ok: true });
  } catch (e) {
    console.error("Error updating settings:", e.message);
    res.status(500).json({ error: "Failed to update settings." });
  }
});

// =============================================
// DUPLICATE MANAGEMENT
// =============================================

/**
 * POST /api/duplicates/:id/dismiss
 * Dismiss a duplicate warning
 */
router.post("/duplicates/:id/dismiss", requireAuth("admin"), (req, res) => {
  try {
    const notificationId = req.params.id;
    const user = req.user;

    // Get notification metadata
    const notification = db.prepare(`
      SELECT metadata FROM notifications WHERE id = ? AND type = 'duplicate_detected'
    `).get(notificationId);

    if (!notification) {
      return res.status(404).json({ error: "Duplicate notification not found." });
    }

    const metadata = JSON.parse(notification.metadata);
    const { new_submission_id, existing_submission_id } = metadata;

    // Record dismissal
    db.prepare(`
      INSERT OR IGNORE INTO duplicate_dismissals (submission_id_1, submission_id_2, dismissed_by)
      VALUES (?, ?, ?)
    `).run(new_submission_id, existing_submission_id, user.username);

    // Mark notification as dismissed
    db.prepare(`
      UPDATE notifications SET status = 'dismissed', read_at = datetime('now')
      WHERE id = ?
    `).run(notificationId);

    res.json({ ok: true });
  } catch (e) {
    console.error("Error dismissing duplicate:", e.message);
    res.status(500).json({ error: "Failed to dismiss duplicate." });
  }
});

/**
 * POST /api/duplicates/:id/merge
 * Merge duplicate submissions (keep existing, delete new)
 */
router.post("/duplicates/:id/merge", requireAuth("admin"), (req, res) => {
  try {
    const notificationId = req.params.id;
    const { keepSubmissionId } = req.body; // Which one to keep

    const notification = db.prepare(`
      SELECT metadata FROM notifications WHERE id = ? AND type = 'duplicate_detected'
    `).get(notificationId);

    if (!notification) {
      return res.status(404).json({ error: "Duplicate notification not found." });
    }

    const metadata = JSON.parse(notification.metadata);
    const { new_submission_id, existing_submission_id } = metadata;

    // Determine which to delete
    const deleteId = keepSubmissionId === existing_submission_id ? new_submission_id : existing_submission_id;

    // Delete the submission (cascading will handle assignments/suggestions)
    db.prepare(`DELETE FROM submissions WHERE id = ?`).run(deleteId);

    // Mark notification as actioned
    db.prepare(`
      UPDATE notifications SET status = 'actioned', read_at = datetime('now')
      WHERE id = ?
    `).run(notificationId);

    // Log activity
    notificationEngine.logActivity('submission_merged', req.user.username, {
      kept: keepSubmissionId,
      deleted: deleteId
    });

    res.json({ ok: true, deletedId: deleteId });
  } catch (e) {
    console.error("Error merging duplicates:", e.message);
    res.status(500).json({ error: "Failed to merge submissions." });
  }
});

// =============================================
// MANUAL TRIGGERS (Admin Only - for testing)
// =============================================

/**
 * POST /api/notifications/trigger/:type
 * Manually trigger a notification check (admin only)
 */
router.post("/notifications/trigger/:type", requireAuth("admin"), (req, res) => {
  try {
    const { type } = req.params;

    let message = `Triggered ${type} check.`;

    switch (type) {
      case 'reminders':
        const countRem = notificationEngine.checkEventReminders();
        message = `Check complete. Created ${countRem} new reminder(s).`;
        break;
      case 'overload':
        const countOver = notificationEngine.checkCounsellorOverload();
        message = `Check complete. Found ${countOver} overloaded counsellor(s).`;
        break;
      case 'anomalies':
        const countAnom = notificationEngine.detectAnomalies();
        message = `Check complete. Detected ${countAnom} anomalie(s).`;
        break;
      case 'weekly-report':
        const reportSuccess = notificationEngine.generateWeeklyReport(true); // force=true bypasses setting check
        message = reportSuccess ? "Weekly report generated successfully." : "Weekly report disabled or failed.";
        break;
      default:
        return res.status(400).json({ error: "Unknown trigger type." });
    }

    res.json({ ok: true, message });
  } catch (e) {
    console.error("Error triggering check:", e.message);
    res.status(500).json({ error: "Failed to trigger check." });
  }
});

module.exports = router;
