const express = require("express");
const db = require("../db");
const { requireAuth, authUser } = require("./auth");
const { overlapCondition } = require("../utils");
const notificationEngine = require("../services/notificationEngine");

const router = express.Router();

/**
 * Counsellor: get presets (organizers, event names, event types) for dropdowns
 */
router.get("/presets", requireAuth("counsellor"), (_req, res) => {
  try {
    const organizers = db.prepare("SELECT id, name FROM organizers WHERE is_active = 1 ORDER BY name ASC").all();
    const event_names = db.prepare("SELECT id, name FROM event_names WHERE is_active = 1 ORDER BY name ASC").all();
    const event_types = db.prepare("SELECT id, name FROM event_types WHERE is_active = 1 ORDER BY name ASC").all();
    res.json({ ok: true, organizers, event_names, event_types });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Counsellor: check counsellor availability for a date range
 */
router.get("/staff-availability", requireAuth("counsellor"), (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: "start and end dates required" });

    const counsellors = db.prepare(`
      SELECT id, username, full_name
      FROM counsellors
      WHERE is_active = 1
      ORDER BY lower(full_name) ASC
    `).all();

    const out = counsellors.map(c => {
      const sql = `
        SELECT s.id, s.start_date, s.end_date, s.city, s.country
        FROM submission_assignments sa
        JOIN submissions s ON s.id = sa.submission_id
        WHERE sa.counsellor_id = ?
          AND s.status = 'confirmed'
          AND ${overlapCondition("s.start_date", "s.end_date", "?", "?")}
      `;
      const conflicts = db.prepare(sql).all(c.id, start, end);
      return { ...c, available: conflicts.length === 0, conflicts };
    });

    res.json({ ok: true, rows: out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Counsellor: get suggested counsellor IDs for a country
 */
router.get("/country-suggestions/:country", requireAuth("counsellor"), (req, res) => {
  try {
    const country = req.params.country;
    const rows = db.prepare(`
      SELECT counsellor_id
      FROM country_counsellor_suggestions
      WHERE country = ?
    `).all(country);
    res.json({ ok: true, suggested_ids: rows.map(r => r.counsellor_id) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Counsellor: create submission (pending)
 */
router.post("/submissions", requireAuth("counsellor"), (req, res) => {
  try {
    const { start_date, end_date, organizer_id, event_name_id, event_type_id, city, country, proposed_staffing, remarks, suggested_ids } = req.body || {};

    // Validate required fields
    if (!start_date || !end_date || !organizer_id || !event_name_id || !event_type_id || !city || !country) {
      return res.status(400).json({ error: "All fields are required: dates, organizer, event name, event type, city, country." });
    }
    if (start_date > end_date) {
      return res.status(400).json({ error: "End date cannot be before Start date." });
    }

    // Get preset names for the organizer column (backward compatibility)
    const org = db.prepare("SELECT name FROM organizers WHERE id = ?").get(organizer_id);
    const evtName = db.prepare("SELECT name FROM event_names WHERE id = ?").get(event_name_id);
    const evtType = db.prepare("SELECT name FROM event_types WHERE id = ?").get(event_type_id);

    if (!org || !evtName || !evtType) {
      return res.status(400).json({ error: "Invalid organizer, event name, or event type selection." });
    }

    // Combine into organizer field for backward compatibility display
    const organizerDisplay = `${org.name} | ${evtName.name} | ${evtType.name}`;

    const info = db.prepare(`
      INSERT INTO submissions (
        start_date, end_date,
        organizer, organizer_id, event_name_id, event_type_id,
        city, country,
        proposed_staffing, remarks,
        status, event_status, submitted_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'ONGOING', ?, datetime('now'))
    `).run(
      start_date, end_date,
      organizerDisplay, organizer_id, event_name_id, event_type_id,
      city, country,
      proposed_staffing || null, remarks || null,
      req.user.username
    );

    // store suggested counsellors (optional)
    const submissionId = info.lastInsertRowid;
    try {
      db.prepare(`DELETE FROM submission_suggestions WHERE submission_id = ?`).run(submissionId);
      const ids = Array.isArray(suggested_ids) ? suggested_ids.map(Number).filter(Number.isFinite) : [];
      const ins = db.prepare(`INSERT OR IGNORE INTO submission_suggestions (submission_id, counsellor_id) VALUES (?, ?)`);
      ids.forEach(cid => ins.run(submissionId, cid));
    } catch (e) {
      // don't fail the submission if suggestions fail
    }

    // Log activity for anomaly detection
    notificationEngine.logActivity('submission_created', req.user.username, {
      submission_id: submissionId,
      city: city,
      country: country,
      start_date: start_date,
      end_date: end_date
    });

    // Check for duplicates (async, non-blocking)
    try {
      notificationEngine.detectDuplicates(submissionId);
    } catch (e) {
      // Don't fail submission if duplicate detection fails
      console.error("Duplicate detection error:", e.message);
    }

    res.json({ ok: true, id: submissionId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Counsellor: batch create multiple submissions at once
 */
router.post("/submissions/batch", requireAuth("counsellor"), (req, res) => {
  try {
    const { events } = req.body || {};
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: "No events provided. Send an array of events." });
    }

    const results = [];
    const errors = [];

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const { start_date, end_date, organizer_id, event_name_id, event_type_id, city, country, proposed_staffing, remarks } = event;

      // Validate required fields
      if (!start_date || !end_date || !organizer_id || !event_name_id || !event_type_id || !city || !country) {
        errors.push({ index: i, error: "Missing required fields" });
        continue;
      }
      if (start_date > end_date) {
        errors.push({ index: i, error: "End date cannot be before Start date" });
        continue;
      }

      // Get preset names
      const org = db.prepare("SELECT name FROM organizers WHERE id = ?").get(organizer_id);
      const evtName = db.prepare("SELECT name FROM event_names WHERE id = ?").get(event_name_id);
      const evtType = db.prepare("SELECT name FROM event_types WHERE id = ?").get(event_type_id);

      if (!org || !evtName || !evtType) {
        errors.push({ index: i, error: "Invalid preset selection" });
        continue;
      }

      const organizerDisplay = `${org.name} | ${evtName.name} | ${evtType.name}`;

      try {
        const info = db.prepare(`
          INSERT INTO submissions (
            start_date, end_date,
            organizer, organizer_id, event_name_id, event_type_id,
            city, country,
            proposed_staffing, remarks,
            status, event_status, submitted_by, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'ONGOING', ?, datetime('now'))
        `).run(
          start_date, end_date,
          organizerDisplay, organizer_id, event_name_id, event_type_id,
          city, country,
          proposed_staffing || null, remarks || null,
          req.user.username
        );
        const submissionId = info.lastInsertRowid;
        results.push({ index: i, id: submissionId, ok: true });

        // Log activity for each submission
        notificationEngine.logActivity('submission_created', req.user.username, {
          submission_id: submissionId,
          city: city,
          country: country,
          batch: true
        });

        // Check for duplicates
        try {
          notificationEngine.detectDuplicates(submissionId);
        } catch (e) { }
      } catch (e) {
        errors.push({ index: i, error: e.message });
      }
    }

    res.json({
      ok: errors.length === 0,
      submitted: results.length,
      failed: errors.length,
      results,
      errors
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Counsellor: update submission
 * Resets status to 'pending' if it was confirmed.
 * Allowed only if pending OR (confirmed AND start_date is in future > today).
 */
router.put("/submissions/:id", requireAuth("counsellor"), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID." });

    const { start_date, end_date, organizer, city, country, proposed_staffing, remarks, suggested_ids } = req.body || {};
    if (!start_date || !end_date || !organizer || !city || !country) {
      return res.status(400).json({ error: "START DATE, END DATE, ORGANIZER, CITY, and COUNTRY are required." });
    }
    if (start_date > end_date) {
      return res.status(400).json({ error: "End date cannot be before Start date." });
    }

    const sub = db.prepare("SELECT * FROM submissions WHERE id = ?").get(id);
    if (!sub) return res.status(404).json({ error: "Submission not found." });
    if (sub.submitted_by !== req.user.username) return res.status(403).json({ error: "Forbidden." });

    // Date validation for confirmed events
    if (sub.status === "confirmed") {
      const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
      if (today >= sub.start_date) {
        return res.status(400).json({ error: "Cannot edit a confirmed event on or after the start date." });
      }
    }

    // Update
    // Always reset status to 'pending' on edit (as requested)
    db.prepare(`
        UPDATE submissions SET
          start_date = ?, end_date = ?,
          organizer = ?, city = ?, country = ?,
          proposed_staffing = ?, remarks = ?,
          status = 'pending',
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
      start_date, end_date,
      organizer, city, country,
      proposed_staffing || null, remarks || null,
      id
    );

    // Update suggestions
    try {
      db.prepare(`DELETE FROM submission_suggestions WHERE submission_id = ?`).run(id);

      // Handle array or comma-separated string
      let ids = [];
      if (Array.isArray(suggested_ids)) ids = suggested_ids;
      else if (typeof suggested_ids === 'string') ids = suggested_ids.split(',');

      ids = ids.map(Number).filter(Number.isFinite);

      const ins = db.prepare(`INSERT OR IGNORE INTO submission_suggestions (submission_id, counsellor_id) VALUES (?, ?)`);
      ids.forEach(cid => ins.run(id, cid));
    } catch (e) { }

    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Counsellor: list my submissions + assigned staff
 */
router.get("/my-submissions", requireAuth("counsellor"), (req, res) => {
  try {
    const since = req.query.since;
    let sql = `
    SELECT
      s.id, s.start_date, s.end_date, s.organizer, s.city, s.country,
      s.proposed_staffing, s.remarks,
      s.status, s.confirmed_at,
      s.created_at, s.updated_at,
      (
        SELECT group_concat(c.full_name || ' (' || c.username || ')', '\n')
        FROM submission_assignments sa
        JOIN counsellors c ON c.id = sa.counsellor_id
        WHERE sa.submission_id = s.id
      ) AS final_staff_names,
      (
        SELECT group_concat(c.id, ',')
        FROM submission_assignments sa
        JOIN counsellors c ON c.id = sa.counsellor_id
        WHERE sa.submission_id = s.id
      ) AS assigned_counsellor_ids,
      (
        SELECT group_concat(c.full_name, ', ')
        FROM submission_suggestions ss
        JOIN counsellors c ON c.id = ss.counsellor_id
        WHERE ss.submission_id = s.id
      ) AS suggested_staff_names,
      (
        SELECT group_concat(c.id, ',')
        FROM submission_suggestions ss
        JOIN counsellors c ON c.id = ss.counsellor_id
        WHERE ss.submission_id = s.id
      ) AS suggested_counsellor_ids
    FROM submissions s
    WHERE s.submitted_by = ?
  `;
    const params = [req.user.username];
    if (since) { sql += " AND datetime(s.updated_at) > datetime(?)"; params.push(since); }
    sql += " ORDER BY date(s.start_date) ASC, s.id ASC";
    res.json({ ok: true, rows: db.prepare(sql).all(...params) });
  } catch (e) {
    res.status(500).json({ error: "Counsellor List Error: " + e.message });
  }
});

/**
 * Counsellor: list events I've been ASSIGNED to (by admin)
 * These are events where the counsellor is in submission_assignments but didn't submit the event
 */
router.get("/my-assignments", requireAuth("counsellor"), (req, res) => {
  try {
    // Get counsellor ID from username (since JWT only has username, not id)
    const counsellor = db.prepare("SELECT id FROM counsellors WHERE username = ?").get(req.user.username);
    if (!counsellor) {
      return res.status(404).json({ error: "Counsellor not found." });
    }

    const sql = `
    SELECT
      s.id, s.start_date, s.end_date, s.organizer, s.city, s.country,
      s.proposed_staffing, s.remarks,
      s.status, s.event_status, s.confirmed_at,
      s.submitted_by,
      s.created_at, s.updated_at,
      (
        SELECT group_concat(c.full_name || ' (' || c.username || ')', '\n')
        FROM submission_assignments sa2
        JOIN counsellors c ON c.id = sa2.counsellor_id
        WHERE sa2.submission_id = s.id
      ) AS final_staff_names,
      (
        SELECT group_concat(c.id, ',')
        FROM submission_assignments sa2
        JOIN counsellors c ON c.id = sa2.counsellor_id
        WHERE sa2.submission_id = s.id
      ) AS assigned_counsellor_ids
    FROM submissions s
    JOIN submission_assignments sa ON sa.submission_id = s.id
    JOIN counsellors submitter ON submitter.username = s.submitted_by
    WHERE sa.counsellor_id = ?
      AND s.status = 'confirmed'
      AND s.event_status = 'ONGOING'
      AND submitter.id != ?  -- Exclude events submitted by this counsellor
    ORDER BY date(s.start_date) ASC, s.id ASC
    `;
    res.json({ ok: true, rows: db.prepare(sql).all(counsellor.id, counsellor.id) });
  } catch (e) {
    res.status(500).json({ error: "Assignments List Error: " + e.message });
  }
});

/**
 * Counsellor (and Admin): availability list for a given date range (dates only).
 * Used for counsellors to SUGGEST staffing.
 */
router.get("/counsellors/availability-public", (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: "Not logged in." });
  if (user.role !== "admin" && user.role !== "counsellor") return res.status(403).json({ error: "Forbidden." });

  const { start, end, exclude_submission_id } = req.query;
  if (!start || !end) return res.status(400).json({ error: "start and end required" });
  const excludeId = exclude_submission_id ? Number(exclude_submission_id) : null;

  const counsellors = db.prepare(`
    SELECT id, username, full_name
    FROM counsellors
    WHERE is_active = 1
    ORDER BY lower(full_name) ASC
  `).all();

  const out = counsellors.map(c => {
    let sql = `
      SELECT s.id, s.start_date, s.end_date, s.city, s.country
      FROM submission_assignments sa
      JOIN submissions s ON s.id = sa.submission_id
      WHERE sa.counsellor_id = ?
        AND s.status = 'confirmed'
        AND ${overlapCondition("s.start_date", "s.end_date", "?", "?")}
    `;
    const params = [c.id, start, end];
    if (excludeId) { sql += " AND s.id <> ?"; params.push(excludeId); }
    const conflicts = db.prepare(sql).all(...params);
    return { id: c.id, username: c.username, full_name: c.full_name, available: conflicts.length === 0, conflicts };
  });

  res.json({ ok: true, rows: out });
});

/**
 * Counsellor: update remarks on own submission (allowed at any time regardless of status)
 */
router.put("/submissions/:id/remarks", requireAuth("counsellor"), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });

    const { remarks } = req.body || {};

    const sub = db.prepare("SELECT id, submitted_by FROM submissions WHERE id = ?").get(id);
    if (!sub) return res.status(404).json({ error: "Submission not found." });
    if (sub.submitted_by !== req.user.username) return res.status(403).json({ error: "Forbidden." });

    db.prepare("UPDATE submissions SET remarks = ?, updated_at = datetime('now') WHERE id = ?").run(remarks || "", id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete submission
router.delete("/submissions/:id", requireAuth(), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });

    const row = db.prepare("SELECT id, submitted_by FROM submissions WHERE id = ?").get(id);
    if (!row) return res.status(404).json({ error: "Submission not found." });

    // Admin can delete anything. Counsellor can only delete their own submission.
    if (req.user.role === "counsellor" && row.submitted_by !== req.user.username) {
      return res.status(403).json({ error: "Forbidden." });
    }

    // Clean up related data before deleting
    db.prepare("DELETE FROM submission_assignments WHERE submission_id = ?").run(id);
    db.prepare("DELETE FROM submission_suggestions WHERE submission_id = ?").run(id);
    db.prepare("DELETE FROM submissions WHERE id = ?").run(id);

    // Log activity for anomaly detection
    notificationEngine.logActivity('submission_deleted', req.user.username, {
      submission_id: id,
      deleted_by_role: req.user.role
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
