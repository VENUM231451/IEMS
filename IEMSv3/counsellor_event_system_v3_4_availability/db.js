const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const dbPath = path.join(__dirname, "events.db");
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Initialize Schema
try {
  const schemaPath = path.join(__dirname, "schema.sql");
  if (fs.existsSync(schemaPath)) {
    db.exec(fs.readFileSync(schemaPath, "utf8"));
  }
} catch (e) {
  console.error("Error applying schema:", e.message);
}

// Migrations / Ensure Columns
function ensureColumns() {
  try {
    const cols = db.prepare("PRAGMA table_info(submissions)").all().map(r => r.name);

    if (cols.includes("final_staffing")) {
      db.prepare("ALTER TABLE submissions DROP COLUMN final_staffing").run();
    }
    if (!cols.includes("confirmed_at")) {
      db.prepare("ALTER TABLE submissions ADD COLUMN confirmed_at TEXT").run();
    }
    if (!cols.includes("sent_by_counsellor_id")) {
      db.prepare("ALTER TABLE submissions ADD COLUMN sent_by_counsellor_id INTEGER").run();
    }
    if (!cols.includes("payment_status")) {
      db.prepare("ALTER TABLE submissions ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'UNPAID'").run();
    }
    if (!cols.includes("event_status")) {
      db.prepare("ALTER TABLE submissions ADD COLUMN event_status TEXT NOT NULL DEFAULT 'ONGOING'").run();
    }
    // New preset columns
    if (!cols.includes("organizer_id")) {
      db.prepare("ALTER TABLE submissions ADD COLUMN organizer_id INTEGER").run();
    }
    if (!cols.includes("event_name_id")) {
      db.prepare("ALTER TABLE submissions ADD COLUMN event_name_id INTEGER").run();
    }
    if (!cols.includes("event_type_id")) {
      db.prepare("ALTER TABLE submissions ADD COLUMN event_type_id INTEGER").run();
    }

    // Create country_counsellor_suggestions table if not exists
    db.prepare(`
      CREATE TABLE IF NOT EXISTS country_counsellor_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        country TEXT NOT NULL,
        counsellor_id INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(country, counsellor_id),
        FOREIGN KEY (counsellor_id) REFERENCES counsellors(id) ON DELETE CASCADE
      )
    `).run();

    // =============================================
    // NOTIFICATION SYSTEM MIGRATIONS
    // =============================================

    // Create notifications table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'medium',
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata TEXT,
        target_role TEXT NOT NULL DEFAULT 'admin',
        target_user TEXT,
        status TEXT NOT NULL DEFAULT 'unread',
        related_submission_id INTEGER,
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        read_at TEXT,
        FOREIGN KEY(related_submission_id) REFERENCES submissions(id) ON DELETE CASCADE
      )
    `).run();

    // Create notification_settings table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS notification_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        setting_key TEXT NOT NULL UNIQUE,
        setting_value TEXT NOT NULL,
        description TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // Insert default notification settings
    const defaultSettings = [
      ['event_reminder_enabled', 'true', 'Enable event proximity reminders'],
      ['event_reminder_days', '[30, 14, 7, 3, 1]', 'Days before event to send reminders'],
      ['duplicate_detection_enabled', 'true', 'Enable duplicate/similar event detection'],
      ['duplicate_threshold', '0.7', 'Similarity threshold for duplicate detection (0-1)'],
      ['staffing_warning_enabled', 'true', 'Enable proactive staffing warnings'],
      ['counsellor_overload_threshold', '5', 'Max concurrent events before overload warning'],
      ['anomaly_detection_enabled', 'true', 'Enable anomaly detection'],
      ['weekly_report_enabled', 'true', 'Enable weekly intelligence reports'],
      ['weekly_report_day', '1', 'Day of week for weekly report (0=Sun, 1=Mon)']
    ];
    const insertSetting = db.prepare(`INSERT OR IGNORE INTO notification_settings (setting_key, setting_value, description) VALUES (?, ?, ?)`);
    for (const [key, value, desc] of defaultSettings) {
      insertSetting.run(key, value, desc);
    }

    // Create duplicate_dismissals table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS duplicate_dismissals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submission_id_1 INTEGER NOT NULL,
        submission_id_2 INTEGER NOT NULL,
        dismissed_by TEXT NOT NULL,
        dismissed_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(submission_id_1, submission_id_2)
      )
    `).run();

    // Create activity_log table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        username TEXT NOT NULL,
        details TEXT,
        ip_address TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // Create indexes for notification tables
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_role, target_user)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_activity_log_username ON activity_log(username)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action)`).run();

  } catch (e) {
    console.error("Migration error:", e.message);
  }
}

ensureColumns();

module.exports = db;
