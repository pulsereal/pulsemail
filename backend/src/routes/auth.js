const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const speakeasy = require("speakeasy");
const qrcode = require("qrcode");
const User = require("../models/User");
const {
    authRateLimit,
    validateEmail,
    validatePassword,
    authenticateToken,
} = require("../middleware/auth");

const router = express.Router();

// Login endpoint
router.post(
    "/login",
    authRateLimit,
    validateEmail,
    validatePassword,
    async (req, res) => {
        try {
            const { email, password, twoFactorCode } = req.body;

            // Authenticate user
            const user = await User.authenticate(email, password);
            if (!user) {
                return res
                    .status(401)
                    .json({ error: "Invalid email or password" });
            }

            if (!user.active) {
                return res.status(401).json({ error: "Account is disabled" });
            }

            // Check if 2FA is enabled
            const secret = await User.get2FASecret(email);
            if (secret) {
                if (!twoFactorCode) {
                    return res.status(400).json({
                        requires2FA: true,
                        message: "2FA code required",
                    });
                }

                // Verify 2FA code
                const verified = speakeasy.totp.verify({
                    secret: secret,
                    encoding: "base32",
                    token: twoFactorCode,
                    window: 2,
                });

                if (!verified) {
                    return res.status(401).json({ error: "Invalid 2FA code" });
                }
            }

            // Generate JWT token
            const token = jwt.sign(
                {
                    email: user.email,
                    name: user.name,
                    isAdmin: user.isAdmin,
                    adminType: user.adminType,
                },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
            );

            res.json({
                success: true,
                token,
                user: {
                    email: user.email,
                    name: user.name,
                    quota: user.quota,
                    language: user.language,
                    has2FA: !!secret,
                    isAdmin: user.isAdmin,
                    adminType: user.adminType,
                    domains: user.domains,
                },
            });
        } catch (error) {
            console.error("Login error:", error);
            res.status(500).json({ error: "Login failed" });
        }
    }
);

// Admin: Get accessible mailboxes
router.get("/admin/mailboxes", authenticateToken, async (req, res) => {
    try {
        const { email } = req.user;

        // Check admin permissions
        const adminInfo = await User.isAdmin(email);
        if (!adminInfo.isAdmin) {
            return res
                .status(403)
                .json({ error: "Access denied: Admin privileges required" });
        }

        const { search, domain, limit = 50, offset = 0 } = req.query;

        let mailboxes = await User.getAccessibleMailboxes(email);

        // Apply filters
        if (search) {
            const searchLower = search.toLowerCase();
            mailboxes = mailboxes.filter(
                (mailbox) =>
                    mailbox.email.toLowerCase().includes(searchLower) ||
                    (mailbox.name &&
                        mailbox.name.toLowerCase().includes(searchLower))
            );
        }

        if (domain && domain !== "all") {
            mailboxes = mailboxes.filter(
                (mailbox) => mailbox.domain === domain
            );
        }

        // Apply pagination
        const total = mailboxes.length;
        const paginatedMailboxes = mailboxes.slice(
            parseInt(offset),
            parseInt(offset) + parseInt(limit)
        );

        // Get unique domains for filter dropdown
        const domains = [...new Set(mailboxes.map((m) => m.domain))].sort();

        res.json({
            success: true,
            mailboxes: paginatedMailboxes,
            pagination: {
                total,
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: parseInt(offset) + parseInt(limit) < total,
            },
            domains,
            adminInfo,
        });
    } catch (error) {
        console.error("Get mailboxes error:", error);
        res.status(500).json({ error: "Failed to fetch mailboxes" });
    }
});

// Admin: Switch to another mailbox
router.post("/admin/switch-mailbox", authenticateToken, async (req, res) => {
    try {
        const adminEmail = req.user.email;
        const { targetEmail } = req.body;

        if (!targetEmail) {
            return res.status(400).json({ error: "Target email is required" });
        }

        // Perform the switch
        const switchedUser = await User.switchToMailbox(
            adminEmail,
            targetEmail
        );

        // Generate new token for the switched user
        const token = jwt.sign(
            {
                email: switchedUser.email,
                name: switchedUser.name,
                isAdminSwitch: true,
                originalAdmin: adminEmail,
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
        );

        res.json({
            success: true,
            token,
            user: {
                email: switchedUser.email,
                name: switchedUser.name,
                quota: switchedUser.quota,
                language: switchedUser.language,
                has2FA: false, // Disable 2FA for admin switches
                isAdminSwitch: true,
                originalAdmin: adminEmail,
            },
            message: `Switched to mailbox: ${targetEmail}`,
        });
    } catch (error) {
        console.error("Switch mailbox error:", error);
        res.status(500).json({
            error: error.message || "Failed to switch mailbox",
        });
    }
});

// Admin: Switch back to original admin account
router.post("/admin/switch-back", authenticateToken, async (req, res) => {
    try {
        const { originalAdmin } = req.user;

        if (!originalAdmin) {
            return res
                .status(400)
                .json({ error: "No original admin account to switch back to" });
        }

        // Get the original admin user
        const adminUser = await User.findByEmail(originalAdmin);
        if (!adminUser) {
            return res
                .status(404)
                .json({ error: "Original admin account not found" });
        }

        // Get admin info
        const adminInfo = await User.isAdmin(originalAdmin);

        // Generate token for original admin
        const token = jwt.sign(
            {
                email: adminUser.email,
                name: adminUser.name,
                isAdmin: adminInfo.isAdmin,
                adminType: adminInfo.adminType,
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
        );

        const secret = await User.get2FASecret(originalAdmin);

        res.json({
            success: true,
            token,
            user: {
                email: adminUser.email,
                name: adminUser.name,
                quota: adminUser.quota,
                language: adminUser.language,
                has2FA: !!secret,
                isAdmin: adminInfo.isAdmin,
                adminType: adminInfo.adminType,
                domains: adminInfo.domains,
            },
            message: `Switched back to admin account: ${originalAdmin}`,
        });
    } catch (error) {
        console.error("Switch back error:", error);
        res.status(500).json({
            error: "Failed to switch back to admin account",
        });
    }
});

// Admin: Get mailbox switch history
router.get("/admin/switch-history", authenticateToken, async (req, res) => {
    try {
        const { email } = req.user;
        const { limit = 20 } = req.query;

        // Check admin permissions
        const adminInfo = await User.isAdmin(email);
        if (!adminInfo.isAdmin) {
            return res
                .status(403)
                .json({ error: "Access denied: Admin privileges required" });
        }

        const history = await User.getSwitchHistory(email, parseInt(limit));

        res.json({
            success: true,
            history,
        });
    } catch (error) {
        console.error("Get switch history error:", error);
        res.status(500).json({ error: "Failed to fetch switch history" });
    }
});

// Refresh token endpoint
router.post("/refresh", authenticateToken, async (req, res) => {
    try {
        const { email } = req.user;

        // Generate new token
        const token = jwt.sign(
            {
                email,
                name: req.user.name,
                isAdminSwitch: req.user.isAdminSwitch,
                originalAdmin: req.user.originalAdmin,
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
        );

        res.json({
            success: true,
            token,
        });
    } catch (error) {
        console.error("Token refresh error:", error);
        res.status(500).json({ error: "Token refresh failed" });
    }
});

// Get current user info
router.get("/me", authenticateToken, async (req, res) => {
    try {
        const { email } = req.user;
        const user = await User.findByEmail(email);

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const secret = await User.get2FASecret(email);
        const preferences = await User.getPreferences(email);

        // Get admin info if applicable
        let adminInfo = { isAdmin: false, adminType: null, domains: [] };
        if (!req.user.isAdminSwitch) {
            adminInfo = await User.isAdmin(email);
        }

        res.json({
            user: {
                email: user.email,
                name: user.name,
                quota: user.quota,
                language: user.language,
                has2FA: !!secret,
                preferences,
                isAdminSwitch: req.user.isAdminSwitch || false,
                originalAdmin: req.user.originalAdmin || null,
                ...adminInfo,
            },
        });
    } catch (error) {
        console.error("Get user error:", error);
        res.status(500).json({ error: "Failed to get user information" });
    }
});

// Update user preferences
router.put("/preferences", authenticateToken, async (req, res) => {
    try {
        const { email } = req.user;
        const { preferences } = req.body;

        await User.updatePreferences(email, preferences);

        res.json({
            success: true,
            message: "Preferences updated successfully",
        });
    } catch (error) {
        console.error("Update preferences error:", error);
        res.status(500).json({ error: "Failed to update preferences" });
    }
});

// Setup 2FA - Generate QR code
router.post("/2fa/setup", authenticateToken, async (req, res) => {
    try {
        const { email } = req.user;

        // Don't allow 2FA setup for admin switches
        if (req.user.isAdminSwitch) {
            return res
                .status(403)
                .json({ error: "Cannot setup 2FA for admin switch sessions" });
        }

        // Generate secret
        const secret = speakeasy.generateSecret({
            issuer: process.env.APP_NAME || "Pulsemail Client",
            name: email,
            length: 32,
        });

        // Save secret to database (not enabled yet)
        await User.set2FASecret(email, secret.base32);

        // Generate QR code
        const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

        res.json({
            success: true,
            secret: secret.base32,
            qrCode: qrCodeUrl,
            manualEntryKey: secret.base32,
        });
    } catch (error) {
        console.error("2FA setup error:", error);
        res.status(500).json({ error: "Failed to setup 2FA" });
    }
});

// Verify and enable 2FA
router.post("/2fa/verify", authenticateToken, async (req, res) => {
    try {
        const { email } = req.user;
        const { token } = req.body;

        if (req.user.isAdminSwitch) {
            return res
                .status(403)
                .json({ error: "Cannot modify 2FA for admin switch sessions" });
        }

        if (!token) {
            return res.status(400).json({ error: "2FA token is required" });
        }

        // Get the secret
        const secret = await User.get2FASecret(email);
        if (!secret) {
            return res
                .status(400)
                .json({ error: "2FA not set up. Please setup 2FA first." });
        }

        // Verify the token
        const verified = speakeasy.totp.verify({
            secret: secret,
            encoding: "base32",
            token: token,
            window: 2,
        });

        if (!verified) {
            return res.status(400).json({ error: "Invalid 2FA token" });
        }

        // Enable 2FA
        await User.toggle2FA(email, true);

        res.json({
            success: true,
            message: "2FA enabled successfully",
        });
    } catch (error) {
        console.error("2FA verification error:", error);
        res.status(500).json({ error: "Failed to verify 2FA" });
    }
});

// Disable 2FA
router.post("/2fa/disable", authenticateToken, async (req, res) => {
    try {
        const { email } = req.user;
        const { token, password } = req.body;

        if (req.user.isAdminSwitch) {
            return res
                .status(403)
                .json({ error: "Cannot modify 2FA for admin switch sessions" });
        }

        if (!token || !password) {
            return res
                .status(400)
                .json({ error: "2FA token and password are required" });
        }

        // Verify password
        const user = await User.authenticate(email, password);
        if (!user) {
            return res.status(401).json({ error: "Invalid password" });
        }

        // Verify 2FA token
        const secret = await User.get2FASecret(email);
        if (!secret) {
            return res.status(400).json({ error: "2FA is not enabled" });
        }

        const verified = speakeasy.totp.verify({
            secret: secret,
            encoding: "base32",
            token: token,
            window: 2,
        });

        if (!verified) {
            return res.status(400).json({ error: "Invalid 2FA token" });
        }

        // Disable 2FA
        await User.toggle2FA(email, false);

        res.json({
            success: true,
            message: "2FA disabled successfully",
        });
    } catch (error) {
        console.error("2FA disable error:", error);
        res.status(500).json({ error: "Failed to disable 2FA" });
    }
});

// Get app passwords
router.get("/app-passwords", authenticateToken, async (req, res) => {
    try {
        const { email } = req.user;
        const appPasswords = await User.getAppPasswords(email);

        // Don't return actual passwords
        const sanitizedPasswords = appPasswords.map((ap) => ({
            id: ap.id,
            name: ap.name,
            created_at: ap.created_at,
            last_used: ap.last_used,
        }));

        res.json({
            success: true,
            appPasswords: sanitizedPasswords,
        });
    } catch (error) {
        console.error("Get app passwords error:", error);
        res.status(500).json({ error: "Failed to get app passwords" });
    }
});

// Create app password
router.post("/app-passwords", authenticateToken, async (req, res) => {
    try {
        const { email } = req.user;
        const { name } = req.body;

        if (req.user.isAdminSwitch) {
            return res.status(403).json({
                error: "Cannot create app passwords for admin switch sessions",
            });
        }

        if (!name) {
            return res
                .status(400)
                .json({ error: "App password name is required" });
        }

        // Generate random password
        const crypto = require("crypto");
        const password = crypto.randomBytes(16).toString("hex");

        // Create app password
        const appPassword = await User.createAppPassword(email, name, password);

        res.json({
            success: true,
            appPassword: {
                id: appPassword.id,
                name: appPassword.name,
                password: password, // Only show password once
                created_at: appPassword.created_at,
            },
        });
    } catch (error) {
        console.error("Create app password error:", error);
        res.status(500).json({ error: "Failed to create app password" });
    }
});

// Delete app password
router.delete("/app-passwords/:id", authenticateToken, async (req, res) => {
    try {
        const { email } = req.user;
        const { id } = req.params;

        if (req.user.isAdminSwitch) {
            return res.status(403).json({
                error: "Cannot delete app passwords for admin switch sessions",
            });
        }

        const { query } = require("../config/database");
        const result = await query(
            `
      DELETE FROM app_passwords 
      WHERE id = $1 AND email = $2
      RETURNING id
    `,
            [id, email]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "App password not found" });
        }

        res.json({
            success: true,
            message: "App password deleted successfully",
        });
    } catch (error) {
        console.error("Delete app password error:", error);
        res.status(500).json({ error: "Failed to delete app password" });
    }
});

// Logout endpoint (client-side token invalidation)
router.post("/logout", authenticateToken, async (req, res) => {
    try {
        // In a more sophisticated setup, you might want to blacklist the token
        // For now, we'll just return success and let the client handle token removal

        res.json({
            success: true,
            message: "Logged out successfully",
        });
    } catch (error) {
        console.error("Logout error:", error);
        res.status(500).json({ error: "Logout failed" });
    }
});

// Check if email exists (for password reset, etc.)
router.post("/check-email", authRateLimit, validateEmail, async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findByEmail(email);

        res.json({
            exists: !!user,
        });
    } catch (error) {
        console.error("Check email error:", error);
        res.status(500).json({ error: "Failed to check email" });
    }
});

// Get user quota information
router.get("/quota", authenticateToken, async (req, res) => {
    try {
        const { email } = req.user;
        const user = await User.findByEmail(email);

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // In a real implementation, you would query the actual mailbox size
        // This is a simplified version
        const quotaInfo = {
            used: 0, // Would be calculated from actual mailbox
            total: user.quota || 0,
            percentage: 0,
        };

        if (quotaInfo.total > 0) {
            quotaInfo.percentage = (quotaInfo.used / quotaInfo.total) * 100;
        }

        res.json({
            success: true,
            quota: quotaInfo,
        });
    } catch (error) {
        console.error("Get quota error:", error);
        res.status(500).json({ error: "Failed to get quota information" });
    }
});

module.exports = router;
