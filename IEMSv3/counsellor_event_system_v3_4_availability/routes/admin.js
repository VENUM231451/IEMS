const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { requireAuth } = require("./auth");
const { overlapCondition } = require("../utils");
const notificationEngine = require("../services/notificationEngine");

const router = express.Router();

// Helper
function toCSV(rows) {
    if (!rows.length) return "";
    const headers = Object.keys(rows[0]);
    const esc = (v) => `"${(v ?? "").toString().replace(/"/g, '""')}"`;
    return [headers.map(esc).join(","), ...rows.map(r => headers.map(h => esc(r[h])).join(","))].join("\n");
}

// Routes

/**
 * Admin: list all submissions + assigned names
 */
router.get("/events", requireAuth("admin"), (req, res) => {
    const { q, status, organizer, city, country, month, counsellor_id } = req.query;


    let sql = `
    SELECT
      s.id, s.start_date, s.end_date, s.organizer, s.city, s.country,
      s.organizer_id, s.event_name_id, s.event_type_id,
      s.proposed_staffing, s.remarks,
      s.status, s.confirmed_at,
      s.submitted_by, s.sent_by_counsellor_id, s.payment_status, s.event_status, s.created_at, s.updated_at,

      (SELECT name FROM organizers WHERE id = s.organizer_id) AS org_name,
      (SELECT name FROM event_names WHERE id = s.event_name_id) AS evt_name,
      (SELECT name FROM event_types WHERE id = s.event_type_id) AS evt_type,

      (
        SELECT c.full_name || ' (' || c.username || ')'
        FROM counsellors c
        WHERE c.id = s.sent_by_counsellor_id
      ) AS sent_by_name,

      (
        SELECT group_concat(c.full_name || ' (' || c.username || ')', '\n')
        FROM submission_assignments sa
        JOIN counsellors c ON c.id = sa.counsellor_id
        WHERE sa.submission_id = s.id
      ) AS final_staff_names,

      (
        SELECT group_concat(sa.counsellor_id)
        FROM submission_assignments sa
        WHERE sa.submission_id = s.id
      ) AS final_assignments
    FROM submissions s
    WHERE 1=1
  `;
    const params = [];

    // Filters
    if (status && (status === "pending" || status === "confirmed" || status === "not_applicable")) {
        sql += " AND s.status = ?";
        params.push(status);
    }

    if (organizer && organizer.trim()) {
        sql += " AND lower(s.organizer) LIKE lower(?)";
        params.push(`%${organizer.trim()}%`);
    }

    if (city && city.trim()) {
        sql += " AND lower(s.city) LIKE lower(?)";
        params.push(`%${city.trim()}%`);
    }

    if (country && country.trim()) {
        sql += " AND lower(s.country) LIKE lower(?)"; // Case-insensitive match
        params.push(`%${country.trim()}%`);
    }

    if (month) {
        // month is 'MM', e.g. '01', '12'
        // SQLite strftime('%m', date_col) returns '01'..'12'
        sql += " AND (strftime('%m', s.start_date) = ? OR strftime('%m', s.end_date) = ?)";
        params.push(month, month);
    }

    if (counsellor_id) {
        const cid = Number(counsellor_id);
        if (Number.isFinite(cid)) {
            // Strict Assigned Logic:
            // Match matches ONLY if the counsellor is officially assigned to the event
            // (Typically implies the event is confirmed)
            sql += " AND s.id IN (SELECT submission_id FROM submission_assignments WHERE counsellor_id = ?)";
            params.push(cid);
        }
    }

    // Keep legacy generic 'q' search if still used, or just let it coexist
    if (q) {
        sql += " AND (s.organizer LIKE ? OR s.city LIKE ? OR s.country LIKE ? OR s.remarks LIKE ?)";
        const like = `%${q}%`;
        params.push(like, like, like, like);
    }

    sql += " ORDER BY date(s.start_date) ASC, s.id ASC";
    res.json({ ok: true, rows: db.prepare(sql).all(...params) });
});

/**
 * Admin: counsellor CRUD
 */
router.get("/counsellors/all", requireAuth("admin"), (req, res) => {
    try {
        const rows = db.prepare("SELECT id, username, full_name, is_active FROM counsellors ORDER BY full_name COLLATE NOCASE").all();
        res.json({ rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get("/counsellors", requireAuth("admin"), (_req, res) => {
    const rows = db.prepare(`
    SELECT id, username, full_name, is_active, created_at, updated_at
    FROM counsellors
    ORDER BY is_active DESC, lower(full_name) ASC
  `).all();
    res.json({ ok: true, rows });
});

router.post("/counsellors", requireAuth("admin"), (req, res) => {
    try {
        const { username, password, full_name, is_active } = req.body || {};
        if (!username || !password || !full_name) return res.status(400).json({ error: "username, password, full_name are required." });
        const hash = bcrypt.hashSync(password, 10);
        const info = db.prepare(`
      INSERT INTO counsellors (username, password_hash, full_name, is_active, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(username.trim(), hash, full_name.trim(), is_active ? 1 : 0);
        res.json({ ok: true, id: info.lastInsertRowid });
    } catch (e) {
        if ((e.message || "").includes("UNIQUE")) return res.status(400).json({ error: "Username already exists." });
        res.status(500).json({ error: e.message });
    }
});

router.put("/counsellors/:id", requireAuth("admin"), (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });
        const { password, full_name, is_active } = req.body || {};

        const existing = db.prepare(`SELECT id FROM counsellors WHERE id = ?`).get(id);
        if (!existing) return res.status(404).json({ error: "Not found." });

        const updates = [];
        const params = [];
        if (typeof full_name === "string" && full_name.trim()) { updates.push("full_name = ?"); params.push(full_name.trim()); }
        if (typeof is_active === "number") { updates.push("is_active = ?"); params.push(is_active ? 1 : 0); }
        if (typeof password === "string" && password.trim()) {
            updates.push("password_hash = ?");
            params.push(bcrypt.hashSync(password, 10));
        }
        updates.push("updated_at = datetime('now')");
        const sql = `UPDATE counsellors SET ${updates.join(", ")} WHERE id = ?`;
        params.push(id);
        db.prepare(sql).run(...params);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.delete("/counsellors/:id", requireAuth("admin"), (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });

        const info = db.prepare("SELECT username FROM counsellors WHERE id = ?").get(id);
        if (!info) return res.status(404).json({ error: "Not found" });
        if (info.username === "admin") return res.status(403).json({ error: "Cannot delete admin." });

        // 1. Remove assignments AND suggestions
        db.prepare("DELETE FROM submission_assignments WHERE counsellor_id = ?").run(id);
        db.prepare("DELETE FROM submission_suggestions WHERE counsellor_id = ?").run(id);

        // 2. Unlink Sent By (set to null)
        db.prepare("UPDATE submissions SET sent_by_counsellor_id = NULL WHERE sent_by_counsellor_id = ?").run(id);

        // 3. Delete user
        db.prepare("DELETE FROM counsellors WHERE id = ?").run(id);

        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Helper: Get all dates in range as YYYY-MM-DD strings
function getDatesInRange(startStr, endStr) {
    const dates = [];
    const cur = new Date(startStr);
    const end = new Date(endStr);
    while (cur <= end) {
        dates.push(cur.toISOString().split('T')[0]);
        cur.setDate(cur.getDate() + 1);
    }
    return dates;
}

// Helper: Format a list of date strings back into ranges
function formatDateRanges(dateStrings) {
    if (!dateStrings.length) return "";
    const sorted = [...new Set(dateStrings)].sort();
    const ranges = [];
    let start = sorted[0];
    let prev = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
        const curr = sorted[i];
        const prevDate = new Date(prev);
        prevDate.setDate(prevDate.getDate() + 1);
        const expected = prevDate.toISOString().split('T')[0];

        if (curr !== expected) {
            ranges.push(start === prev ? start : `${start} -> ${prev}`);
            start = curr;
        }
        prev = curr;
    }
    ranges.push(start === prev ? start : `${start} -> ${prev}`);
    return ranges.join(", ");
}

/**
 * Admin: availability for a date range (dates only)
 */
router.get("/counsellors/availability", requireAuth("admin"), (req, res) => {
    const { start, end, exclude_submission_id } = req.query;
    if (!start || !end) return res.status(400).json({ error: "start and end required" });
    const excludeId = exclude_submission_id ? Number(exclude_submission_id) : null;

    const counsellors = db.prepare(`
    SELECT id, username, full_name
    FROM counsellors
    WHERE is_active = 1
    ORDER BY lower(full_name) ASC
  `).all();

    // 1. Calculate all requested days
    const requestedDates = getDatesInRange(start, end);
    const totalRequested = requestedDates.length;
    const requestedSet = new Set(requestedDates);

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

        // 2. Calculate busy dates
        const busySet = new Set();
        for (const conf of conflicts) {
            const confDates = getDatesInRange(conf.start_date, conf.end_date);
            for (const d of confDates) {
                if (requestedSet.has(d)) {
                    busySet.add(d);
                }
            }
        }

        // 3. Determine status
        const busyCount = busySet.size;
        let status = "available";
        let available_ranges = "";

        if (busyCount === 0) {
            status = "available";
        } else if (busyCount >= totalRequested) {
            status = "busy";
        } else {
            status = "partially_available";
            // Calculate available dates
            const availableDates = requestedDates.filter(d => !busySet.has(d));
            available_ranges = formatDateRanges(availableDates);
        }

        return {
            ...c,
            available: status === "available", // Keep legacy for compatibility if needed, or use status
            status,
            available_ranges,
            conflicts
        };
    });

    res.json({ ok: true, rows: out });
});

/**
 * Admin: finalize staffing (assign counsellors)
 */
router.put("/submissions/:id/finalize", requireAuth("admin"), (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });

        const { counsellor_ids } = req.body || {};
        if (!Array.isArray(counsellor_ids) || counsellor_ids.length === 0) {
            return res.status(400).json({ error: "At least 1 counsellor must be selected." });
        }

        const sub = db.prepare(`SELECT id, start_date, end_date, event_status FROM submissions WHERE id = ?`).get(id);
        if (!sub) return res.status(404).json({ error: "Submission not found." });

        if ((sub.event_status || "ONGOING") === "COMPLETED" || (sub.event_status || "ONGOING") === "CANCELLED") {
            return res.status(400).json({ error: "Cannot change staffing for a completed or cancelled event." });
        }

        const selected = db.prepare(`
      SELECT id, username, full_name
      FROM counsellors
      WHERE is_active = 1 AND id IN (${counsellor_ids.map(() => "?").join(",")})
    `).all(...counsellor_ids);

        if (selected.length !== counsellor_ids.length) {
            return res.status(400).json({ error: "One or more selected counsellors are not active / not found." });
        }

        // Validate availability - REMOVED to allow manual override by Admin
        // The Admin UI already shows "Busy" (Red) or "Partially Available" (Orange) indicators.
        // If the admin selects them, we trust their decision.

        const tx = db.transaction(() => {
            db.prepare(`DELETE FROM submission_assignments WHERE submission_id = ?`).run(id);
            const ins = db.prepare(`INSERT INTO submission_assignments (submission_id, counsellor_id) VALUES (?, ?)`);
            for (const c of selected) ins.run(id, c.id);

            db.prepare(`
        UPDATE submissions
        SET status = 'confirmed',
            confirmed_at = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(id);
        });

        tx();

        // Log activity
        notificationEngine.logActivity('staffing_finalized', req.user.username, {
            submission_id: id,
            counsellor_ids: counsellor_ids,
            counsellor_names: selected.map(c => c.full_name)
        });

        // Check counsellor overload after assignment
        try {
            notificationEngine.checkCounsellorOverload();
        } catch (e) { }

        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.put("/submissions/:id/meta", requireAuth("admin"), (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });

        const allowedPay = ["PAID", "UNPAID", "FREE"];
        const allowedStatus = ["ONGOING", "COMPLETED", "CANCELLED", "POSTPONED"];

        const sent_by_counsellor_id = req.body && req.body.sent_by_counsellor_id !== undefined ? req.body.sent_by_counsellor_id : undefined;
        const payment_status = req.body && req.body.payment_status !== undefined ? req.body.payment_status : undefined;
        const event_status = req.body && req.body.event_status !== undefined ? req.body.event_status : undefined;
        const remarks = req.body && req.body.remarks !== undefined ? req.body.remarks : undefined;

        const row = db.prepare("SELECT sent_by_counsellor_id, payment_status, event_status, remarks FROM submissions WHERE id=?").get(id);
        if (!row) return res.status(404).json({ error: "Submission not found." });

        let newSent = row.sent_by_counsellor_id;
        if (sent_by_counsellor_id !== undefined) {
            if (sent_by_counsellor_id === null || sent_by_counsellor_id === "") newSent = null;
            else {
                const n = Number(sent_by_counsellor_id);
                if (!Number.isFinite(n)) return res.status(400).json({ error: "Invalid counsellor id." });
                newSent = n;
            }
        }

        let newPay = row.payment_status || "UNPAID";
        if (payment_status !== undefined) {
            const v = String(payment_status).toUpperCase();
            if (!allowedPay.includes(v)) return res.status(400).json({ error: "Invalid payment status." });
            newPay = v;
        }

        let newStatus = row.event_status || "ONGOING";
        if (event_status !== undefined) {
            const v = String(event_status).toUpperCase();
            if (!allowedStatus.includes(v)) return res.status(400).json({ error: "Invalid event status." });
            newStatus = v;
        }

        let newRemarks = row.remarks || "";
        if (remarks !== undefined) {
            newRemarks = String(remarks);
        }

        // If event is cancelled or postponed, set status to not_applicable and remove assignments
        let submissionStatusUpdate = "";
        if (newStatus === "CANCELLED" || newStatus === "POSTPONED") {
            // Remove all staffing assignments to free up counsellors
            db.prepare("DELETE FROM submission_assignments WHERE submission_id = ?").run(id);
            submissionStatusUpdate = ", status = 'not_applicable'";
        }

        db.prepare(`UPDATE submissions SET sent_by_counsellor_id=?, payment_status=?, event_status=?, remarks=?${submissionStatusUpdate}, updated_at=datetime('now') WHERE id=?`).run(newSent, newPay, newStatus, newRemarks, id);

        // Log activity for significant changes
        if (event_status !== undefined && event_status !== row.event_status) {
            notificationEngine.logActivity('event_status_changed', req.user.username, {
                submission_id: id,
                old_status: row.event_status,
                new_status: newStatus
            });
        }

        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Admin: reschedule a postponed event (update dates)
 */
router.put("/submissions/:id/reschedule", requireAuth("admin"), (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });

        const { start_date, end_date } = req.body || {};
        if (!start_date || !end_date) {
            return res.status(400).json({ error: "start_date and end_date are required." });
        }

        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(start_date) || !dateRegex.test(end_date)) {
            return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
        }

        if (start_date > end_date) {
            return res.status(400).json({ error: "End date must be after start date." });
        }

        const row = db.prepare("SELECT id, event_status FROM submissions WHERE id = ?").get(id);
        if (!row) return res.status(404).json({ error: "Submission not found." });

        // Update the dates and reset event status to ONGOING
        db.prepare(`
            UPDATE submissions 
            SET start_date = ?, end_date = ?, event_status = 'ONGOING', status = 'pending', updated_at = datetime('now')
            WHERE id = ?
        `).run(start_date, end_date, id);

        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Admin: CSV export
 */
router.get("/report.csv", requireAuth("admin"), (_req, res) => {
    const rows = db.prepare(`
    SELECT
      s.id,
      s.start_date,
      s.end_date,
      s.organizer,
      s.city,
      s.country,
      s.proposed_staffing,
      s.remarks,
      s.status,
      s.confirmed_at,
      s.submitted_by, s.sent_by_counsellor_id, s.payment_status,
      (SELECT c.full_name || ' (' || c.username || ')' FROM counsellors c WHERE c.id = s.sent_by_counsellor_id) AS sent_by_name,
      (
        SELECT group_concat(c.full_name || ' (' || c.username || ')', '\n')
        FROM submission_assignments sa
        JOIN counsellors c ON c.id = sa.counsellor_id
        WHERE sa.submission_id = s.id
      ) AS assigned_counsellors,
      s.created_at,
      s.updated_at
    FROM submissions s
    ORDER BY date(s.start_date) ASC, s.id ASC
  `).all();
    const csv = toCSV(rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=report.csv");
    res.send(csv);
});

/**
 * Admin: Get distinct locations for filters
 */
router.get("/filters/locations", requireAuth("admin"), (_req, res) => {
    try {
        const cities = db.prepare("SELECT DISTINCT city FROM submissions WHERE city IS NOT NULL AND city != '' ORDER BY city ASC").all().map(r => r.city);
        const countries = db.prepare("SELECT DISTINCT country FROM submissions WHERE country IS NOT NULL AND country != '' ORDER BY country ASC").all().map(r => r.country);
        const organizers = db.prepare("SELECT DISTINCT organizer FROM submissions WHERE organizer IS NOT NULL AND organizer != '' ORDER BY organizer ASC").all().map(r => r.organizer);
        res.json({ ok: true, cities, countries, organizers });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// PRESET MANAGEMENT (Organizers, Event Names, Event Types)
// ==========================================

/**
 * Organizers CRUD
 */
router.get("/organizers", requireAuth("admin"), (_req, res) => {
    try {
        const rows = db.prepare("SELECT id, name, is_active, created_at FROM organizers ORDER BY is_active DESC, name ASC").all();
        res.json({ ok: true, rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post("/organizers", requireAuth("admin"), (req, res) => {
    try {
        const { name } = req.body || {};
        if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
        const info = db.prepare("INSERT INTO organizers (name) VALUES (?)").run(name.trim());
        res.json({ ok: true, id: info.lastInsertRowid });
    } catch (e) {
        if ((e.message || "").includes("UNIQUE")) return res.status(400).json({ error: "Organizer already exists." });
        res.status(500).json({ error: e.message });
    }
});

router.put("/organizers/:id", requireAuth("admin"), (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });
        const { name, is_active } = req.body || {};
        const updates = [];
        const params = [];
        if (name && name.trim()) { updates.push("name = ?"); params.push(name.trim()); }
        if (typeof is_active === "number") { updates.push("is_active = ?"); params.push(is_active ? 1 : 0); }
        if (!updates.length) return res.status(400).json({ error: "No updates provided." });
        params.push(id);
        db.prepare(`UPDATE organizers SET ${updates.join(", ")} WHERE id = ?`).run(...params);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.delete("/organizers/:id", requireAuth("admin"), (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });
        db.prepare("DELETE FROM organizers WHERE id = ?").run(id);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Event Names CRUD
 */
router.get("/event-names", requireAuth("admin"), (_req, res) => {
    try {
        const rows = db.prepare("SELECT id, name, is_active, created_at FROM event_names ORDER BY is_active DESC, name ASC").all();
        res.json({ ok: true, rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post("/event-names", requireAuth("admin"), (req, res) => {
    try {
        const { name } = req.body || {};
        if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
        const info = db.prepare("INSERT INTO event_names (name) VALUES (?)").run(name.trim());
        res.json({ ok: true, id: info.lastInsertRowid });
    } catch (e) {
        if ((e.message || "").includes("UNIQUE")) return res.status(400).json({ error: "Event name already exists." });
        res.status(500).json({ error: e.message });
    }
});

router.put("/event-names/:id", requireAuth("admin"), (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });
        const { name, is_active } = req.body || {};
        const updates = [];
        const params = [];
        if (name && name.trim()) { updates.push("name = ?"); params.push(name.trim()); }
        if (typeof is_active === "number") { updates.push("is_active = ?"); params.push(is_active ? 1 : 0); }
        if (!updates.length) return res.status(400).json({ error: "No updates provided." });
        params.push(id);
        db.prepare(`UPDATE event_names SET ${updates.join(", ")} WHERE id = ?`).run(...params);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.delete("/event-names/:id", requireAuth("admin"), (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });
        db.prepare("DELETE FROM event_names WHERE id = ?").run(id);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Event Types CRUD
 */
router.get("/event-types", requireAuth("admin"), (_req, res) => {
    try {
        const rows = db.prepare("SELECT id, name, is_active, created_at FROM event_types ORDER BY is_active DESC, name ASC").all();
        res.json({ ok: true, rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post("/event-types", requireAuth("admin"), (req, res) => {
    try {
        const { name } = req.body || {};
        if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
        const info = db.prepare("INSERT INTO event_types (name) VALUES (?)").run(name.trim());
        res.json({ ok: true, id: info.lastInsertRowid });
    } catch (e) {
        if ((e.message || "").includes("UNIQUE")) return res.status(400).json({ error: "Event type already exists." });
        res.status(500).json({ error: e.message });
    }
});

router.put("/event-types/:id", requireAuth("admin"), (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });
        const { name, is_active } = req.body || {};
        const updates = [];
        const params = [];
        if (name && name.trim()) { updates.push("name = ?"); params.push(name.trim()); }
        if (typeof is_active === "number") { updates.push("is_active = ?"); params.push(is_active ? 1 : 0); }
        if (!updates.length) return res.status(400).json({ error: "No updates provided." });
        params.push(id);
        db.prepare(`UPDATE event_types SET ${updates.join(", ")} WHERE id = ?`).run(...params);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.delete("/event-types/:id", requireAuth("admin"), (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });
        db.prepare("DELETE FROM event_types WHERE id = ?").run(id);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// COUNTRY-COUNSELLOR SUGGESTIONS
// ==========================================

/**
 * Get all country-counsellor suggestions (grouped by country)
 */
router.get("/country-suggestions", requireAuth("admin"), (_req, res) => {
    try {
        const rows = db.prepare(`
            SELECT ccs.id, ccs.country, ccs.counsellor_id, c.full_name, c.username
            FROM country_counsellor_suggestions ccs
            JOIN counsellors c ON c.id = ccs.counsellor_id
            ORDER BY ccs.country ASC, c.full_name ASC
        `).all();
        res.json({ ok: true, rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Get suggestions for a specific country
 */
router.get("/country-suggestions/:country", requireAuth("admin"), (req, res) => {
    try {
        const country = req.params.country;
        const rows = db.prepare(`
            SELECT ccs.id, ccs.counsellor_id, c.full_name, c.username
            FROM country_counsellor_suggestions ccs
            JOIN counsellors c ON c.id = ccs.counsellor_id
            WHERE ccs.country = ?
            ORDER BY c.full_name ASC
        `).all(country);
        res.json({ ok: true, rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Add a counsellor suggestion for a country
 */
router.post("/country-suggestions", requireAuth("admin"), (req, res) => {
    try {
        const { country, counsellor_id } = req.body || {};
        if (!country || !counsellor_id) {
            return res.status(400).json({ error: "Country and counsellor_id are required." });
        }
        const info = db.prepare(`
            INSERT INTO country_counsellor_suggestions (country, counsellor_id)
            VALUES (?, ?)
        `).run(country, counsellor_id);
        res.json({ ok: true, id: info.lastInsertRowid });
    } catch (e) {
        if ((e.message || "").includes("UNIQUE")) {
            return res.status(400).json({ error: "This counsellor is already suggested for this country." });
        }
        res.status(500).json({ error: e.message });
    }
});

/**
 * Remove a country-counsellor suggestion
 */
router.delete("/country-suggestions/:id", requireAuth("admin"), (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id." });
        db.prepare("DELETE FROM country_counsellor_suggestions WHERE id = ?").run(id);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;

