require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const path = require("path");

const app = express();

// Security: Trust proxy (for rate limiting behind reverse proxy)
app.set("trust proxy", 1);

// Security: HTTP headers (X-Frame-Options, X-Content-Type-Options, etc.)
// CSP configured to allow inline scripts and external CDNs used by the app
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdnjs.cloudflare.com"],
            scriptSrcAttr: ["'unsafe-inline'"], // Allow inline onclick handlers
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            imgSrc: ["'self'", "data:", "blob:"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: []
        }
    }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Routes
const { router: authRouter } = require("./routes/auth");
const adminRouter = require("./routes/admin");
const counsellorRouter = require("./routes/counsellor");
const notificationsRouter = require("./routes/notifications");

// Cron Jobs
const { startCronJobs, runInitialChecks } = require("./services/cronJobs");

app.use("/api", authRouter);
app.use("/api", adminRouter);
app.use("/api", counsellorRouter); // includes /my-submissions and /submissions
app.use("/api", notificationsRouter); // notification endpoints

app.get("/", (_req, res) => res.redirect("/login.html"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on http://localhost:" + PORT);

  // Start background job scheduler
  startCronJobs();

  // Run initial notification checks (optional)
  runInitialChecks();
});
