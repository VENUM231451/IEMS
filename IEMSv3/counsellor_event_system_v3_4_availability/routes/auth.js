const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const db = require("../db");

const router = express.Router();

// Security: Validate JWT secret in production
const JWT_SECRET = process.env.JWT_SECRET || "dev-jwt-secret-change-me";
if (process.env.NODE_ENV === "production" && JWT_SECRET === "dev-jwt-secret-change-me") {
    console.error("FATAL: JWT_SECRET must be set in production!");
    process.exit(1);
}
const JWT_EXPIRES_IN = "7d";

// Security: Rate limiting for login endpoint (brute force protection)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: { error: "Too many login attempts. Please try again in 15 minutes." },
    standardHeaders: true,
    legacyHeaders: false
});

// Default Admin from Env
const ADMIN = {
    username: process.env.ADMIN_USERNAME || "admin",
    password: process.env.ADMIN_PASSWORD || "admin123",
    role: "admin"
};

function authUser(req) {
    const hdr = req.headers.authorization || "";
    const m = hdr.match(/^Bearer\s+(.+)$/i);
    if (!m) return null;
    try { return jwt.verify(m[1], JWT_SECRET); } catch { return null; }
}

function requireAuth(role) {
    return (req, res, next) => {
        const user = authUser(req);
        if (!user) return res.status(401).json({ error: "Not logged in." });
        if (role && user.role !== role) return res.status(403).json({ error: "Forbidden." });
        req.user = user;
        next();
    };
}

// Routes
router.post("/login", loginLimiter, (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Username and password required." });

    // Admin
    if (username === ADMIN.username && password === ADMIN.password) {
        const payload = { username: ADMIN.username, role: "admin" };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        return res.json({ ok: true, user: payload, token });
    }

    // Counsellor from DB
    const row = db.prepare("SELECT id, username, password_hash, full_name, is_active FROM counsellors WHERE username = ?").get(username);
    if (!row || !row.is_active) return res.status(401).json({ error: "Invalid username or password." });

    const ok = bcrypt.compareSync(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid username or password." });

    const payload = { username: row.username, role: "counsellor" };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ ok: true, user: payload, token });
});

router.get("/me", (req, res) => {
    const user = authUser(req);
    res.json({ user: user ? { username: user.username, role: user.role } : null });
});

module.exports = { router, requireAuth, authUser };
