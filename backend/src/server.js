const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
require("dotenv").config();

// Import middleware
const {
    corsMiddleware,
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

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

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

// CORS configuration
app.use(
    cors({
        origin: [
            "http://localhost:3000",
            "http://localhost:3001",
            "https://your-domain.com",
        ],
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
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

        await query(`
      CREATE TABLE IF NOT EXISTS email_categories (
        user_email VARCHAR(255) NOT NULL,
        email_uid VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL,
        confidence DECIMAL(3,2) DEFAULT 0.8,
        method VARCHAR(20) DEFAULT 'manual',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_email, email_uid)
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

        // Create indexes for better performance
        await query(`
      CREATE INDEX IF NOT EXISTS idx_email_categories_user_category 
      ON email_categories(user_email, category);
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

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
    console.log(`\n${signal} received. Starting graceful shutdown...`);

    server.close((err) => {
        if (err) {
            console.error("Error during server close:", err);
            process.exit(1);
        }

        console.log("Server closed successfully");
        process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
        console.error(
            "Could not close connections in time, forcefully shutting down"
        );
        process.exit(1);
    }, 10000);
};

// Start server
const startServer = async () => {
    try {
        // Initialize database
        await initializeDatabase();

        // Start the server
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

        // Handle graceful shutdown
        process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
        process.on("SIGINT", () => gracefulShutdown("SIGINT"));

        return server;
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
};

// Start the application
if (require.main === module) {
    startServer();
}

module.exports = app;
