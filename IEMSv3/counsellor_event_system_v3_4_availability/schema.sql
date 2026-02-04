PRAGMA foreign_keys = ON;

-- Counsellor accounts managed by admin
CREATE TABLE IF NOT EXISTS counsellors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Admin-managed presets for event submissions
CREATE TABLE IF NOT EXISTS organizers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_names (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Country to Counsellor Suggestions mapping
CREATE TABLE IF NOT EXISTS country_counsellor_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country TEXT NOT NULL,
  counsellor_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(country, counsellor_id),
  FOREIGN KEY (counsellor_id) REFERENCES counsellors(id) ON DELETE CASCADE
);

-- Event submissions entered by counsellors
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  start_date TEXT NOT NULL,          -- YYYY-MM-DD
  end_date   TEXT NOT NULL,          -- YYYY-MM-DD

  organizer TEXT NOT NULL,
  city      TEXT NOT NULL,
  country   TEXT NOT NULL,

  proposed_staffing TEXT,            -- free text entered by counsellor
  remarks           TEXT,

  -- Admin-only metadata
  sent_by_counsellor_id INTEGER,     -- FK to counsellors(id), set by admin
  payment_status TEXT NOT NULL DEFAULT 'UNPAID',   -- PAID | UNPAID | FREE

  status TEXT NOT NULL DEFAULT 'pending',          -- pending | confirmed
  final_staffing TEXT,               -- admin decision notes (optional)
  submitted_by TEXT NOT NULL,         -- counsellor username who created the submission

  confirmed_at TEXT,                 -- datetime when admin confirmed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY(sent_by_counsellor_id) REFERENCES counsellors(id)
);

-- Final assignments (admin selected staffing)
CREATE TABLE IF NOT EXISTS submission_assignments (
  submission_id INTEGER NOT NULL,
  counsellor_id INTEGER NOT NULL,
  PRIMARY KEY (submission_id, counsellor_id),
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (counsellor_id) REFERENCES counsellors(id) ON DELETE CASCADE
);

-- Suggestions saved from the submitting counsellor UI (optional)
CREATE TABLE IF NOT EXISTS submission_suggestions (
  submission_id INTEGER NOT NULL,
  counsellor_id INTEGER NOT NULL,
  PRIMARY KEY (submission_id, counsellor_id),
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (counsellor_id) REFERENCES counsellors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_submissions_dates ON submissions(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_submitted_by ON submissions(submitted_by);
CREATE INDEX IF NOT EXISTS idx_assignments_counsellor ON submission_assignments(counsellor_id);

-- =============================================
-- NOTIFICATION SYSTEM TABLES
-- =============================================

-- Notifications for users (admin and counsellors)
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                    -- event_reminder, duplicate_detected, staffing_warning, anomaly, weekly_report
  priority TEXT NOT NULL DEFAULT 'medium', -- low, medium, high, critical
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT,                         -- JSON with extra data (submission_id, related_ids, etc.)
  target_role TEXT NOT NULL DEFAULT 'admin', -- admin, counsellor, or 'all'
  target_user TEXT,                      -- specific username if applicable (NULL = all users with target_role)
  status TEXT NOT NULL DEFAULT 'unread', -- unread, read, dismissed, actioned
  related_submission_id INTEGER,         -- FK to submissions if applicable
  expires_at TEXT,                       -- auto-dismiss after this datetime
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT,
  FOREIGN KEY(related_submission_id) REFERENCES submissions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_role, target_user);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

-- Notification settings (admin-configurable)
CREATE TABLE IF NOT EXISTS notification_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT NOT NULL,           -- JSON or simple value
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Insert default notification settings
INSERT OR IGNORE INTO notification_settings (setting_key, setting_value, description) VALUES
  ('event_reminder_enabled', 'true', 'Enable event proximity reminders'),
  ('event_reminder_days', '[30, 14, 7, 3, 1]', 'Days before event to send reminders'),
  ('duplicate_detection_enabled', 'true', 'Enable duplicate/similar event detection'),
  ('duplicate_threshold', '0.7', 'Similarity threshold for duplicate detection (0-1)'),
  ('staffing_warning_enabled', 'true', 'Enable proactive staffing warnings'),
  ('counsellor_overload_threshold', '5', 'Max concurrent events before overload warning'),
  ('anomaly_detection_enabled', 'true', 'Enable anomaly detection'),
  ('weekly_report_enabled', 'true', 'Enable weekly intelligence reports'),
  ('weekly_report_day', '1', 'Day of week for weekly report (0=Sun, 1=Mon)');

-- Duplicate detection dismissals (track dismissed duplicate warnings)
CREATE TABLE IF NOT EXISTS duplicate_dismissals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id_1 INTEGER NOT NULL,
  submission_id_2 INTEGER NOT NULL,
  dismissed_by TEXT NOT NULL,
  dismissed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(submission_id_1, submission_id_2)
);

-- Activity log for anomaly detection
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,                  -- submission_created, submission_deleted, submission_updated, login, etc.
  username TEXT NOT NULL,
  details TEXT,                          -- JSON with context
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_username ON activity_log(username);
CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action);
