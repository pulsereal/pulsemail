const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
require("dotenv").config();

const { validateEnvironment } = require("./config/environment");
const { verifyConnections } = require("./config/database");
const AutomationService = require("./services/AutomationService");

// Import middleware
const {
    errorHandler,
    requestLogger,
    securityHeaders,
    cspMiddleware,
    apiRateLimit,
} = require("./middleware/auth");

// Import routes
const authRoutes = require("./routes/auth");
const emailRoutes = require("./routes/emails");
const campaignRoutes = require("./routes/campaigns");
const automationRoutes = require("./routes/automation");
const adminRoutes = require("./routes/admin");
const provisioningRoutes = require("./routes/provisioning");
const mailboxSettingsRoutes = require("./routes/mailbox-settings");
const aiRoutes = require("./routes/ai");
const LLMSettingsService = require("./services/LLMSettingsService");
const ClassificationWorker = require("./services/ClassificationWorker");

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

/**
 * Behind nginx every request arrives from the proxy, so without this the rate
 * limiter buckets all users under one address and the first busy session locks
 * everyone out. Set TRUST_PROXY to the number of proxies in front of the app
 * (1 for a single nginx) rather than `true`, which would let a client forge
 * X-Forwarded-For and evade the limiter entirely.
 */
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy) {
    const hops = Number(trustProxy);
    app.set("trust proxy", Number.isFinite(hops) ? hops : trustProxy);
}

// Basic security middleware
app.use(
    helmet({
        contentSecurityPolicy: false, // We'll handle this with our custom middleware
        crossOriginEmbedderPolicy: false,
    })
);

// Custom security headers
app.use(securityHeaders);
app.use(cspMiddleware);

/**
 * The deployment in DEPLOYMENT.md serves the built frontend and proxies /api
 * from the same nginx host, so no cross-origin request happens at all. Set
 * CORS_ORIGINS (comma separated) only when the frontend lives elsewhere.
 */
const corsOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const developmentOrigins =
    process.env.NODE_ENV === "production"
        ? []
        : ["http://localhost:3000", "http://localhost:5173"];

const allowedOrigins = [...new Set([...corsOrigins, ...developmentOrigins])];

app.use(
    cors({
        origin: (origin, callback) => {
            // Same-origin and non-browser callers send no Origin header.
            if (!origin) return callback(null, true);
            callback(null, allowedOrigins.includes(origin));
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Mailbox"],
    })
);

// Request parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Request logging
app.use(requestLogger);

// Rate limiting for API endpoints
app.use("/api/", apiRateLimit);

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    });
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/emails", emailRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/automation", automationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin", provisioningRoutes);
app.use("/api/mailbox", mailboxSettingsRoutes);
app.use("/api/admin/ai", aiRoutes);

// API documentation endpoint
app.get("/api/docs", (req, res) => {
    res.json({
        name: "Pulsemail Custom Client API",
        version: "1.0.0",
        description:
            "Enhanced email client for Pulsemail with AI features, campaigns, and automation",
        endpoints: {
            auth: {
                "POST /api/auth/login": "User login with 2FA support",
                "POST /api/auth/refresh": "Refresh JWT token",
                "GET /api/auth/me": "Get current user info",
                "POST /api/auth/2fa/setup": "Setup 2FA",
                "POST /api/auth/2fa/verify": "Verify and enable 2FA",
                "GET /api/auth/app-passwords": "Get app passwords",
                "POST /api/auth/app-passwords": "Create app password",
            },
            emails: {
                "GET /api/emails": "Get emails with filtering and pagination",
                "GET /api/emails/:uid": "Get single email content",
                "POST /api/emails/send": "Send email with spam testing",
                "POST /api/emails/:uid/reply": "Generate AI reply",
                "PATCH /api/emails/:uid/mark": "Mark email as read/unread",
                "DELETE /api/emails/:uid": "Delete email",
                "POST /api/emails/test-spam": "Test content for spam",
            },
            campaigns: {
                "GET /api/campaigns": "Get email campaigns",
                "POST /api/campaigns": "Create new campaign",
                "POST /api/campaigns/:id/send": "Send campaign",
                "GET /api/campaigns/:id/analytics": "Get campaign analytics",
                "POST /api/campaigns/:id/test": "Send test campaign",
            },
            automation: {
                "GET /api/automation/rules": "Get automation rules",
                "POST /api/automation/rules": "Create automation rule",
                "POST /api/automation/follow-ups": "Schedule follow-up",
                "GET /api/automation/stats": "Get automation statistics",
            },
        },
    });
});

// Root endpoint
app.get("/", (req, res) => {
    res.json({
        message: "Pulsemail Custom Client API",
        version: "1.0.0",
        documentation: "/api/docs",
        health: "/health",
    });
});

// 404 handler for unknown routes
app.use("*", (req, res) => {
    res.status(404).json({
        error: "Route not found",
        path: req.originalUrl,
        method: req.method,
    });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Database initialization and table creation
const initializeDatabase = async () => {
    const { query } = require("./config/database");

    try {
        // Create tables if they don't exist
        await query(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        email VARCHAR(255) PRIMARY KEY,
        preferences JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

        await query(`
      CREATE TABLE IF NOT EXISTS user_2fa (
        email VARCHAR(255) PRIMARY KEY,
        totp_secret VARCHAR(255) NOT NULL,
        enabled BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

        await query(`
      CREATE TABLE IF NOT EXISTS app_passwords (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        last_used TIMESTAMP
      );
    `);

        await query(`
      CREATE TABLE IF NOT EXISTS sent_emails (
        id SERIAL PRIMARY KEY,
        from_email VARCHAR(255) NOT NULL,
        to_email TEXT NOT NULL,
        subject TEXT,
        content TEXT,
        message_id VARCHAR(255),
        sent_at TIMESTAMP DEFAULT NOW()
      );
    `);

        // A single row holding the LLM endpoint the administrator configured.
        // The API key is stored encrypted; see config/secrets.js.
        await query(`
      CREATE TABLE IF NOT EXISTS llm_settings (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
        api_key_encrypted TEXT,
        model VARCHAR(128) NOT NULL DEFAULT 'gpt-4o-mini',
        classify_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        summaries_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        replies_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        importance_threshold SMALLINT NOT NULL DEFAULT 70,
        snippet_chars INTEGER NOT NULL DEFAULT 500,
        batch_size SMALLINT NOT NULL DEFAULT 10,
        daily_limit INTEGER NOT NULL DEFAULT 2000,
        lookback_days SMALLINT NOT NULL DEFAULT 7,
        custom_instructions TEXT,
        updated_at TIMESTAMP DEFAULT NOW(),
        updated_by VARCHAR(255)
      );
    `);

        // Keyed on Message-ID so a classification survives the message being
        // moved between folders and survives a UIDVALIDITY reset. The folder,
        // uid and uidvalidity columns are the locator used to pull a priority
        // listing back out of IMAP, and are refreshed whenever we see the
        // message again.
        await query(`
      CREATE TABLE IF NOT EXISTS email_classifications (
        user_email VARCHAR(255) NOT NULL,
        message_key VARCHAR(512) NOT NULL,
        folder VARCHAR(255) NOT NULL,
        uid BIGINT NOT NULL,
        uidvalidity BIGINT NOT NULL DEFAULT 0,
        category VARCHAR(32) NOT NULL DEFAULT 'other',
        importance SMALLINT NOT NULL DEFAULT 0,
        reason TEXT,
        model VARCHAR(128),
        method VARCHAR(16) NOT NULL DEFAULT 'llm',
        pinned BOOLEAN NOT NULL DEFAULT FALSE,
        message_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_email, message_key)
      );
    `);

        await query(`
      CREATE TABLE IF NOT EXISTS llm_usage (
        day DATE NOT NULL,
        feature VARCHAR(32) NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0,
        messages INTEGER NOT NULL DEFAULT 0,
        prompt_tokens BIGINT NOT NULL DEFAULT 0,
        completion_tokens BIGINT NOT NULL DEFAULT 0,
        errors INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, feature)
      );
    `);

        await query(`
      CREATE TABLE IF NOT EXISTS email_campaigns (
        id SERIAL PRIMARY KEY,
        user_email VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        subject TEXT NOT NULL,
        content TEXT NOT NULL,
        recipients JSONB NOT NULL,
        scheduled_at TIMESTAMP,
        template_id INTEGER,
        status VARCHAR(20) DEFAULT 'draft',
        sent_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

        await query(`
      CREATE TABLE IF NOT EXISTS campaign_recipients (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER NOT NULL,
        email VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        sent_at TIMESTAMP,
        opened_at TIMESTAMP,
        clicked_at TIMESTAMP,
        status VARCHAR(20) DEFAULT 'pending',
        message_id VARCHAR(255),
        error_message TEXT
      );
    `);

        await query(`
      CREATE TABLE IF NOT EXISTS campaign_templates (
        id SERIAL PRIMARY KEY,
        user_email VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        thumbnail TEXT,
        is_global BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

        await query(`
      CREATE TABLE IF NOT EXISTS automation_rules (
        id SERIAL PRIMARY KEY,
        user_email VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        trigger_type VARCHAR(50) NOT NULL,
        trigger_conditions JSONB NOT NULL,
        actions JSONB NOT NULL,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

        await query(`
      CREATE TABLE IF NOT EXISTS automation_logs (
        id SERIAL PRIMARY KEY,
        user_email VARCHAR(255) NOT NULL,
        rule_id INTEGER,
        action VARCHAR(50) NOT NULL,
        data JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

        await query(`
      CREATE TABLE IF NOT EXISTS scheduled_followups (
        id SERIAL PRIMARY KEY,
        user_email VARCHAR(255) NOT NULL,
        recipient_email VARCHAR(255) NOT NULL,
        subject TEXT NOT NULL,
        content TEXT,
        scheduled_at TIMESTAMP NOT NULL,
        follow_up_type VARCHAR(50) DEFAULT 'general',
        original_email_data JSONB,
        use_llm BOOLEAN DEFAULT FALSE,
        purpose VARCHAR(255),
        status VARCHAR(20) DEFAULT 'pending',
        active BOOLEAN DEFAULT TRUE,
        sent_at TIMESTAMP,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

        await query(`
      CREATE TABLE IF NOT EXISTS automation_tasks (
        id SERIAL PRIMARY KEY,
        user_email VARCHAR(255) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        email_reference JSONB,
        due_date TIMESTAMP,
        priority VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(20) DEFAULT 'pending',
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

        await query(`
      CREATE TABLE IF NOT EXISTS user_reply_preferences (
        email VARCHAR(255) PRIMARY KEY,
        preferences JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

        await query(`
      CREATE TABLE IF NOT EXISTS llm_reply_log (
        id SERIAL PRIMARY KEY,
        sender_email VARCHAR(255) NOT NULL,
        recipient_email VARCHAR(255) NOT NULL,
        original_content TEXT NOT NULL,
        generated_reply TEXT NOT NULL,
        context JSONB,
        feedback_rating INTEGER,
        feedback_text TEXT,
        feedback_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

        await query(`
      CREATE TABLE IF NOT EXISTS email_labels (
        id SERIAL PRIMARY KEY,
        user_email VARCHAR(255) NOT NULL,
        email_uid VARCHAR(255) NOT NULL,
        label VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_email, email_uid, label)
      );
    `);

        await query(`
      CREATE TABLE IF NOT EXISTS user_notifications (
        id SERIAL PRIMARY KEY,
        user_email VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        data JSONB,
        read_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

        // Audit trail for admins opening a mailbox that is not their own
        await query(`
      CREATE TABLE IF NOT EXISTS admin_mailbox_switches (
        id SERIAL PRIMARY KEY,
        admin_email VARCHAR(255) NOT NULL,
        target_email VARCHAR(255) NOT NULL,
        switched_at TIMESTAMP NOT NULL DEFAULT NOW(),
        ip_address VARCHAR(64) NOT NULL DEFAULT ''
      );
    `);

        // Per-user signatures and send-as identities
        await query(`
      CREATE TABLE IF NOT EXISTS user_identities (
        id SERIAL PRIMARY KEY,
        user_email VARCHAR(255) NOT NULL,
        from_address VARCHAR(255) NOT NULL,
        display_name VARCHAR(255) NOT NULL DEFAULT '',
        signature TEXT NOT NULL DEFAULT '',
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_email, from_address)
      );
    `);

        /**
         * Structured source of truth for the generated Dovecot Sieve script.
         * The script itself lives on the mail server; these rows are what the
         * UI edits and what the script is regenerated from.
         */
        await query(`
      CREATE TABLE IF NOT EXISTS mail_filters (
        id SERIAL PRIMARY KEY,
        user_email VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL DEFAULT '',
        priority INTEGER NOT NULL DEFAULT 0,
        match_type VARCHAR(10) NOT NULL DEFAULT 'all',
        conditions JSONB NOT NULL DEFAULT '[]',
        actions JSONB NOT NULL DEFAULT '[]',
        stop_processing BOOLEAN NOT NULL DEFAULT TRUE,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

        await query(`
      CREATE TABLE IF NOT EXISTS vacation_settings (
        user_email VARCHAR(255) PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        subject VARCHAR(255) NOT NULL DEFAULT 'Out of office',
        body TEXT NOT NULL DEFAULT '',
        start_date DATE,
        end_date DATE,
        interval_days INTEGER NOT NULL DEFAULT 7,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

        // Create indexes for better performance
        await query(`
      CREATE INDEX IF NOT EXISTS idx_classifications_locator
      ON email_classifications(user_email, folder, uidvalidity, uid);
    `);

        // Serves the priority listing: most important first within a folder.
        await query(`
      CREATE INDEX IF NOT EXISTS idx_classifications_priority
      ON email_classifications(user_email, folder, importance DESC, message_date DESC);
    `);

        await query(`
      CREATE INDEX IF NOT EXISTS idx_mail_filters_user_priority 
      ON mail_filters(user_email, priority);
    `);

        await query(`
      CREATE INDEX IF NOT EXISTS idx_admin_switches_admin_date 
      ON admin_mailbox_switches(admin_email, switched_at DESC);
    `);

        await query(`
      CREATE INDEX IF NOT EXISTS idx_user_identities_user 
      ON user_identities(user_email);
    `);

        await query(`
      CREATE INDEX IF NOT EXISTS idx_campaigns_user_status 
      ON email_campaigns(user_email, status);
    `);

        await query(`
      CREATE INDEX IF NOT EXISTS idx_automation_rules_user_active 
      ON automation_rules(user_email, active);
    `);

        await query(`
      CREATE INDEX IF NOT EXISTS idx_followups_scheduled 
      ON scheduled_followups(scheduled_at, status, active);
    `);

        await query(`
      CREATE INDEX IF NOT EXISTS idx_sent_emails_from_date 
      ON sent_emails(from_email, sent_at);
    `);

        console.log("Database tables initialized successfully");
    } catch (error) {
        console.error("Database initialization error:", error);
        throw error;
    }
};

const gracefulShutdown = (server, signal) => {
    console.log(`\n${signal} received. Starting graceful shutdown...`);

    server.close((error) => {
        if (error) {
            console.error("Error during server close:", error);
            process.exit(1);
        }

        console.log("Server closed successfully");
        process.exit(0);
    });

    // systemd sends SIGKILL eventually; beat it to the punch with a clear log.
    setTimeout(() => {
        console.error(
            "Could not close connections in time, forcefully shutting down"
        );
        process.exit(1);
    }, 10000).unref();
};

// Start server
const startServer = async () => {
    try {
        validateEnvironment();

        // Surface an unreachable database now rather than on the first login
        await verifyConnections();

        await initializeDatabase();

        // Cron jobs and rule loading need the tables created above
        await AutomationService.shared().init();

        // Seed the settings row, then schedule the classifier only if an
        // administrator has actually turned it on.
        await LLMSettingsService.shared().ensureRow();
        if ((await LLMSettingsService.shared().get()).classify_enabled) {
            ClassificationWorker.shared().start();
        }

        const server = app.listen(PORT, () => {
            console.log(
                `🚀 Pulsemail Custom Client API Server running on port ${PORT}`
            );
            console.log(
                `📚 API Documentation: http://localhost:${PORT}/api/docs`
            );
            console.log(`💚 Health Check: http://localhost:${PORT}/health`);
            console.log(
                `🌍 Environment: ${process.env.NODE_ENV || "development"}`
            );
        });

        process.on("SIGTERM", () => gracefulShutdown(server, "SIGTERM"));
        process.on("SIGINT", () => gracefulShutdown(server, "SIGINT"));

        return server;
    } catch (error) {
        console.error("Failed to start server:", error.message);
        process.exit(1);
    }
};

// Start the application
if (require.main === module) {
    startServer();
}

module.exports = app;
module.exports.initializeDatabase = initializeDatabase;
