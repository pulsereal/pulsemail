const jwt = require("jsonwebtoken");
const User = require("../models/User");
const speakeasy = require("speakeasy");

// JWT Authentication middleware
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({ error: "Access token required" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findByEmail(decoded.email);

        if (!user) {
            return res.status(401).json({ error: "Invalid token" });
        }

        req.user = {
            email: decoded.email,
            id: decoded.email,
            name: user.name,
            isAdmin: decoded.isAdmin || false,
            adminType: decoded.adminType || null,
            isAdminSwitch: decoded.isAdminSwitch || false,
            originalAdmin: decoded.originalAdmin || null,
        };

        next();
    } catch (error) {
        return res.status(403).json({ error: "Invalid or expired token" });
    }
};

const clientIp = (req) =>
    req.ip ||
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.connection?.remoteAddress ||
    "0.0.0.0";

/**
 * Resolves which mailbox the request operates on.
 *
 * Regular users are always pinned to their own address. An admin may target
 * another mailbox via the X-Mailbox header, subject to the same domain scoping
 * used by User.switchToMailbox, and every cross-mailbox access is audited.
 */
const resolveMailboxScope = async (req, res, next) => {
    try {
        const own = req.user.email;
        const requested = (req.get("X-Mailbox") || "").trim();

        if (!requested || requested.toLowerCase() === own.toLowerCase()) {
            req.mailbox = own;
            req.isImpersonating = false;
            return next();
        }

        const adminInfo = await User.isAdmin(own);
        if (!adminInfo.isAdmin) {
            return res.status(403).json({
                error: "Access denied: admin privileges required to access another mailbox",
            });
        }

        const targetDomain = requested.split("@")[1];
        if (
            adminInfo.adminType !== "global" &&
            !adminInfo.domains.includes(targetDomain)
        ) {
            return res.status(403).json({
                error: `Access denied: no permission for domain ${targetDomain}`,
            });
        }

        const target = await User.findByEmail(requested);
        if (!target) {
            return res.status(404).json({ error: "Target mailbox not found" });
        }

        req.mailbox = requested;
        req.isImpersonating = true;
        req.adminInfo = adminInfo;

        await User.logMailboxAccess(own, requested, clientIp(req));

        next();
    } catch (error) {
        console.error("Mailbox scope error:", error);
        res.status(500).json({ error: "Failed to resolve mailbox scope" });
    }
};

/**
 * Gate a route on admin privileges, re-deriving them from domain_admins rather
 * than trusting the token alone.
 */
const requireAdmin = async (req, res, next) => {
    try {
        const adminInfo = await User.isAdmin(req.user.email);

        if (!adminInfo.isAdmin) {
            return res.status(403).json({ error: "Admin access required" });
        }

        req.adminInfo = adminInfo;
        next();
    } catch (error) {
        console.error("Admin check error:", error);
        res.status(500).json({ error: "Admin verification failed" });
    }
};

/**
 * Creating or removing domains is a global-admin action in iRedMail; domain
 * admins may only manage objects inside domains they are assigned.
 */
const requireGlobalAdmin = async (req, res, next) => {
    try {
        const adminInfo = await User.isAdmin(req.user.email);

        if (!adminInfo.isAdmin || adminInfo.adminType !== "global") {
            return res
                .status(403)
                .json({ error: "Global admin access required" });
        }

        req.adminInfo = adminInfo;
        next();
    } catch (error) {
        console.error("Global admin check error:", error);
        res.status(500).json({ error: "Admin verification failed" });
    }
};

const canManageDomain = (adminInfo, domain) =>
    Boolean(adminInfo?.isAdmin) &&
    (adminInfo.adminType === "global" || adminInfo.domains.includes(domain));

/**
 * Guard a provisioning route on the domain embedded in the request, taken from
 * an explicit `domain` or the domain part of whichever address the route
 * operates on.
 */
const requireDomainAccess = (req, res, next) => {
    const address =
        req.params.email ||
        req.params.address ||
        req.body?.email ||
        req.body?.address ||
        "";

    const target =
        req.params.domain || address.split("@")[1] || req.body?.domain;

    if (!target) {
        return res.status(400).json({ error: "Target domain is required" });
    }

    if (!canManageDomain(req.adminInfo, target)) {
        return res
            .status(403)
            .json({ error: `Access denied for domain ${target}` });
    }

    req.targetDomain = target;
    next();
};

// 2FA verification middleware
const verify2FA = async (req, res, next) => {
    try {
        const { email } = req.user;
        const { twoFactorCode } = req.body;

        // Check if user has 2FA enabled
        const secret = await User.get2FASecret(email);

        if (!secret) {
            // 2FA not enabled, proceed
            return next();
        }

        if (!twoFactorCode) {
            return res.status(400).json({
                error: "2FA code required",
                requires2FA: true,
            });
        }

        // Verify 2FA code
        const verified = speakeasy.totp.verify({
            secret: secret,
            encoding: "base32",
            token: twoFactorCode,
            window: 2, // Allow 30 second window
        });

        if (!verified) {
            return res.status(401).json({ error: "Invalid 2FA code" });
        }

        next();
    } catch (error) {
        return res.status(500).json({ error: "Error verifying 2FA" });
    }
};

// App password authentication middleware
const authenticateAppPassword = async (req, res, next) => {
    const authHeader = req.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Basic ")) {
        return res.status(401).json({ error: "Basic authentication required" });
    }

    try {
        const base64Credentials = authHeader.split(" ")[1];
        const credentials = Buffer.from(base64Credentials, "base64").toString(
            "ascii"
        );
        const [email, password] = credentials.split(":");

        // Try regular authentication first
        const user = await User.authenticate(email, password);

        if (user) {
            req.user = user;
            return next();
        }

        // Try app password authentication
        const appPasswords = await User.getAppPasswords(email);
        let validAppPassword = false;

        for (const appPassword of appPasswords) {
            const bcrypt = require("bcryptjs");
            const isValid = await bcrypt.compare(
                password,
                appPassword.password
            );

            if (isValid) {
                validAppPassword = true;
                req.user = await User.findByEmail(email);
                req.appPassword = appPassword;
                break;
            }
        }

        if (!validAppPassword) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        next();
    } catch (error) {
        return res.status(500).json({ error: "Authentication error" });
    }
};

// Rate limiting middleware
const rateLimit = require("express-rate-limit");

const intFromEnv = (name, fallback) => {
    const parsed = parseInt(process.env[name], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Limits are keyed on the authenticated mailbox where we have one, falling back
 * to the client address. Keying purely on IP punishes everyone behind a shared
 * NAT or corporate gateway, and a webmail client is chatty enough that a single
 * active user would exhaust a per-IP budget shared with their colleagues.
 */
const createRateLimit = (windowMs, max, message) =>
    rateLimit({
        windowMs,
        max,
        message: { error: message },
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.user?.email || req.ip,
    });

const authRateLimit = createRateLimit(
    intFromEnv("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
    intFromEnv("AUTH_RATE_LIMIT_MAX", 10),
    "Too many authentication attempts, please try again later"
);

const emailRateLimit = createRateLimit(
    intFromEnv("SEND_RATE_LIMIT_WINDOW_MS", 60 * 1000),
    intFromEnv("SEND_RATE_LIMIT_MAX", 20),
    "Too many emails sent, please try again later"
);

/**
 * Opening a folder costs a list request plus one per message opened, so the
 * ceiling has to be generous or normal reading trips it. This is an abuse
 * backstop, not a quota.
 */
const apiRateLimit = createRateLimit(
    intFromEnv("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
    intFromEnv("RATE_LIMIT_MAX_REQUESTS", 3000),
    "Too many API requests, please try again later"
);

// Input validation middleware
const validateEmail = (req, res, next) => {
    // Skip validation in development mode
    if (
        process.env.NODE_ENV === "development" &&
        process.env.USE_MOCK_DATA === "true"
    ) {
        console.log("🔓 Skipping email validation in development mode");
        return next();
    }

    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: "Invalid email format" });
    }

    next();
};

const validatePassword = (req, res, next) => {
    // Skip validation in development mode
    if (
        process.env.NODE_ENV === "development" &&
        process.env.USE_MOCK_DATA === "true"
    ) {
        console.log("🔓 Skipping password validation in development mode");
        return next();
    }

    const { password } = req.body;

    if (!password) {
        return res.status(400).json({ error: "Password is required" });
    }

    if (password.length < 8) {
        return res.status(400).json({
            error: "Password must be at least 8 characters long",
        });
    }

    next();
};

// Error handling middleware
const errorHandler = (error, req, res, next) => {
    console.error("Error:", error);

    // JWT errors
    if (error.name === "JsonWebTokenError") {
        return res.status(401).json({ error: "Invalid token" });
    }

    if (error.name === "TokenExpiredError") {
        return res.status(401).json({ error: "Token expired" });
    }

    // Database errors
    if (error.code === "23505") {
        // PostgreSQL unique violation
        return res.status(409).json({ error: "Resource already exists" });
    }

    if (error.code === "42P01") {
        // PostgreSQL table doesn't exist
        return res.status(500).json({ error: "Database configuration error" });
    }

    // Default error
    const status = error.status || 500;
    const message = error.message || "Internal server error";

    res.status(status).json({
        error: message,
        ...(process.env.NODE_ENV === "development" && { stack: error.stack }),
    });
};

// Request logging middleware
const requestLogger = (req, res, next) => {
    const start = Date.now();

    res.on("finish", () => {
        const duration = Date.now() - start;
        console.log(
            `${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`
        );
    });

    next();
};

// Security headers middleware
const securityHeaders = (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains"
    );
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
};

// Content Security Policy middleware
const cspMiddleware = (req, res, next) => {
    const csp = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "media-src 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ].join("; ");

    res.setHeader("Content-Security-Policy", csp);
    next();
};

module.exports = {
    authenticateToken,
    resolveMailboxScope,
    requireAdmin,
    requireGlobalAdmin,
    requireDomainAccess,
    canManageDomain,
    clientIp,
    verify2FA,
    authenticateAppPassword,
    authRateLimit,
    emailRateLimit,
    apiRateLimit,
    validateEmail,
    validatePassword,
    errorHandler,
    requestLogger,
    securityHeaders,
    cspMiddleware,
};
