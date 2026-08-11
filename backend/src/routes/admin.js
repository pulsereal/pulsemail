const express = require("express");
const {
    authenticateToken,
    requireAdmin,
    clientIp,
} = require("../middleware/auth");
// Mailbox and quota totals come from iRedMail (mailQuery); the impersonation
// audit trail is ours (query).
const { query, mailQuery } = require("../config/database");
const { mailService } = require("../services/MailService");
const { pool: imapPool } = require("../services/ImapConnection");
const User = require("../models/User");
const { quotaMbToBytes } = require("../config/iredmail");

const router = express.Router();

const admin = [authenticateToken, requireAdmin];

const intFromEnv = (name, fallback) => {
    const parsed = parseInt(process.env[name], 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const unifiedConfig = () => ({
    concurrency: intFromEnv("UNIFIED_INBOX_CONCURRENCY", 5),
    maxMailboxes: intFromEnv("UNIFIED_INBOX_MAX_MAILBOXES", 50),
    cacheTtlMs: intFromEnv("UNIFIED_INBOX_CACHE_TTL_MS", 15000),
});

/**
 * Run `worker` over `items` with at most `limit` in flight. Failures are
 * captured per item so one unreachable mailbox cannot fail the whole request.
 */
const mapWithConcurrency = async (items, limit, worker) => {
    const results = new Array(items.length);
    let cursor = 0;

    const runners = Array.from(
        { length: Math.min(Math.max(1, limit), items.length || 1) },
        async () => {
            while (cursor < items.length) {
                const index = cursor++;
                try {
                    results[index] = {
                        status: "ok",
                        value: await worker(items[index], index),
                    };
                } catch (error) {
                    results[index] = {
                        status: "error",
                        error: error.message,
                    };
                }
            }
        }
    );

    await Promise.all(runners);
    return results;
};

const unifiedCache = new Map();

const readCache = (key) => {
    const entry = unifiedCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        unifiedCache.delete(key);
        return null;
    }
    return entry.value;
};

const writeCache = (key, value, ttlMs) => {
    unifiedCache.set(key, { value, expiresAt: Date.now() + ttlMs });
    if (unifiedCache.size > 50) {
        const oldest = unifiedCache.keys().next().value;
        unifiedCache.delete(oldest);
    }
};

const resolveTargets = async (adminEmail, requested) => {
    const accessible = await User.getAccessibleMailboxes(adminEmail);
    const permitted = new Set(accessible.map((row) => row.email));

    if (!requested || requested.length === 0) {
        return { targets: accessible, denied: [] };
    }

    const denied = requested.filter((email) => !permitted.has(email));
    const targets = accessible.filter((row) => requested.includes(row.email));
    return { targets, denied };
};

// Get admin dashboard data
router.get("/dashboard", admin, async (req, res) => {
    try {
        // Domain admins only ever see totals for the domains they administer
        const scoped = req.adminInfo.adminType !== "global";
        const domainFilter = scoped ? "WHERE m.domain = ANY($1)" : "";
        const domainParams = scoped ? [req.adminInfo.domains] : [];

        const userStats = await mailQuery(
            `SELECT
                COUNT(*) as total_users,
                COUNT(CASE WHEN m.active = 1 THEN 1 END) as active_users,
                COUNT(CASE WHEN m.active = 0 THEN 1 END) as inactive_users,
                COUNT(DISTINCT m.domain) as total_domains
             FROM mailbox m
             ${domainFilter}`,
            domainParams
        );

        /**
         * Message counts and storage come from `used_quota`, which Dovecot's
         * quota_clone dict keeps current, and from `mailbox.quota`, which is
         * megabytes (Dovecot multiplies it by 1048576).
         */
        const storageStats = await mailQuery(
            `SELECT
                COALESCE(SUM(u.messages), 0) as total_messages,
                COALESCE(SUM(u.bytes), 0) as total_storage_used,
                COALESCE(SUM(m.quota), 0) as total_quota_mb
             FROM mailbox m
             LEFT JOIN used_quota u ON u.username = m.username
             ${domainFilter}`,
            domainParams
        );

        let recentActivity = [];
        try {
            const activity = await query(
                `
                SELECT admin_email, target_email, switched_at, ip_address
                FROM admin_mailbox_switches
                WHERE admin_email = $1
                ORDER BY switched_at DESC
                LIMIT 10
            `,
                [req.user.email]
            );

            recentActivity = activity.rows.map((row, index) => ({
                id: String(index + 1),
                user: row.admin_email,
                action: "Mailbox access",
                timestamp: row.switched_at,
                details: `Opened ${row.target_email} from ${row.ip_address}`,
            }));
        } catch (error) {
            console.error("Failed to load admin activity:", error.message);
        }

        const users = userStats.rows[0] || {};
        const storage = storageStats.rows[0] || {};

        res.json({
            success: true,
            stats: {
                totalUsers: parseInt(users.total_users || 0),
                activeUsers: parseInt(users.active_users || 0),
                inactiveUsers: parseInt(users.inactive_users || 0),
                totalDomains: parseInt(users.total_domains || 0),
                totalMessages: parseInt(storage.total_messages || 0),
                storageUsed: parseInt(storage.total_storage_used || 0),
                storageLimit: quotaMbToBytes(storage.total_quota_mb || 0),
            },
            adminType: req.adminInfo.adminType,
            domains: req.adminInfo.domains,
            recentActivity,
            imapPool: imapPool.stats(),
        });
    } catch (error) {
        console.error("Admin dashboard error:", error);
        res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
});

// Merged inbox across every mailbox the admin can reach
router.get("/unified/emails", admin, async (req, res) => {
    try {
        const config = unifiedConfig();
        const {
            folder = "INBOX",
            limit = 25,
            unread_only,
            mailboxes: mailboxFilter,
        } = req.query;

        const requested = mailboxFilter
            ? String(mailboxFilter)
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean)
            : [];

        const { targets, denied } = await resolveTargets(
            req.user.email,
            requested
        );

        if (denied.length > 0) {
            return res.status(403).json({
                error: `Access denied for: ${denied.join(", ")}`,
            });
        }

        const capped = targets.slice(0, config.maxMailboxes);
        const truncated = targets.length > capped.length;
        const perMailbox = Math.max(
            1,
            Math.min(parseInt(limit, 10) || 25, 100)
        );

        const cacheKey = JSON.stringify({
            admin: req.user.email,
            folder,
            perMailbox,
            unread_only: unread_only === "true",
            mailboxes: capped.map((row) => row.email),
        });

        const cached = readCache(cacheKey);
        if (cached) {
            return res.json({ ...cached, cached: true });
        }

        const outcomes = await mapWithConcurrency(
            capped,
            config.concurrency,
            (mailbox) =>
                mailService.getEmails(mailbox.email, folder, perMailbox, 0)
        );

        const emails = [];
        const errors = [];
        const perMailboxCounts = [];

        outcomes.forEach((outcome, index) => {
            const mailbox = capped[index];

            if (outcome.status === "error") {
                errors.push({ mailbox: mailbox.email, error: outcome.error });
                perMailboxCounts.push({
                    mailbox: mailbox.email,
                    name: mailbox.name,
                    total: 0,
                    unread: 0,
                    error: outcome.error,
                });
                return;
            }

            let items = outcome.value || [];
            if (unread_only === "true") {
                items = items.filter(
                    (item) => !(item.flags || []).includes("\\Seen")
                );
            }

            const tagged = items.map((item) => ({
                ...item,
                mailbox: mailbox.email,
                mailboxName: mailbox.name || mailbox.email,
                mailboxDomain: mailbox.domain,
            }));

            perMailboxCounts.push({
                mailbox: mailbox.email,
                name: mailbox.name,
                domain: mailbox.domain,
                total: tagged.length,
                unread: tagged.filter(
                    (item) => !(item.flags || []).includes("\\Seen")
                ).length,
            });

            emails.push(...tagged);
        });

        emails.sort((a, b) => {
            const left = a.date ? Date.parse(a.date) : 0;
            const right = b.date ? Date.parse(b.date) : 0;
            return right - left;
        });

        // Reading across mailboxes is an admin action; keep the audit trail.
        await Promise.all(
            capped.map((mailbox) =>
                mailbox.email === req.user.email
                    ? Promise.resolve()
                    : User.logMailboxAccess(
                          req.user.email,
                          mailbox.email,
                          clientIp(req)
                      )
            )
        );

        const payload = {
            success: true,
            folder,
            emails,
            total: emails.length,
            mailboxes: perMailboxCounts,
            errors,
            truncated,
            scanned: capped.length,
        };

        writeCache(cacheKey, payload, config.cacheTtlMs);
        res.json(payload);
    } catch (error) {
        console.error("Unified inbox error:", error);
        res.status(500).json({ error: "Failed to build unified inbox" });
    }
});

// Per-mailbox unread counts for the unified view sidebar
router.get("/unified/stats", admin, async (req, res) => {
    try {
        const config = unifiedConfig();
        const { folder = "INBOX" } = req.query;

        const targets = (
            await User.getAccessibleMailboxes(req.user.email)
        ).slice(0, config.maxMailboxes);

        const cacheKey = JSON.stringify({
            stats: req.user.email,
            folder,
            count: targets.length,
        });
        const cached = readCache(cacheKey);
        if (cached) return res.json({ ...cached, cached: true });

        const outcomes = await mapWithConcurrency(
            targets,
            config.concurrency,
            (mailbox) => mailService.getUnreadCount(mailbox.email, folder)
        );

        const mailboxes = targets.map((mailbox, index) => {
            const outcome = outcomes[index];
            return {
                mailbox: mailbox.email,
                name: mailbox.name,
                domain: mailbox.domain,
                unread: outcome.status === "ok" ? outcome.value : 0,
                error: outcome.status === "error" ? outcome.error : null,
            };
        });

        const payload = {
            success: true,
            folder,
            mailboxes,
            totalUnread: mailboxes.reduce((sum, row) => sum + row.unread, 0),
            imapPool: imapPool.stats(),
        };

        writeCache(cacheKey, payload, config.cacheTtlMs);
        res.json(payload);
    } catch (error) {
        console.error("Unified stats error:", error);
        res.status(500).json({ error: "Failed to load mailbox stats" });
    }
});

// Cross-mailbox access audit trail
router.get("/access-log", admin, async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        const history = await User.getSwitchHistory(
            req.user.email,
            parseInt(limit, 10) || 50
        );

        res.json({ success: true, history, total: history.length });
    } catch (error) {
        console.error("Access log error:", error);
        res.status(500).json({ error: "Failed to load access log" });
    }
});

// Get all users (admin only)
router.get("/users", admin, async (req, res) => {
    try {
        const { limit = 50, offset = 0, search } = req.query;

        let whereClause = "";
        let params = [];

        if (search) {
            whereClause = "WHERE username ILIKE $1 OR name ILIKE $1";
            params.push(`%${search}%`);
        }

        const result = await mailQuery(
            `
            SELECT 
                username as email,
                name,
                domain,
                quota,
                created,
                active
            FROM mailbox 
            ${whereClause}
            ORDER BY created DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `,
            [...params, parseInt(limit), parseInt(offset)]
        );

        const countResult = await mailQuery(
            `
            SELECT COUNT(*) as total
            FROM mailbox 
            ${whereClause}
        `,
            params
        );

        const permitted = new Set(
            (await User.getAccessibleMailboxes(req.user.email)).map(
                (row) => row.email
            )
        );

        res.json({
            success: true,
            users: result.rows.filter((row) => permitted.has(row.email)),
            total: parseInt(countResult.rows[0]?.total || 0),
            limit: parseInt(limit),
            offset: parseInt(offset),
        });
    } catch (error) {
        console.error("Get users error:", error);
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

// Get user details (admin only)
router.get("/users/:email", admin, async (req, res) => {
    try {
        const { email } = req.params;

        const permitted = (
            await User.getAccessibleMailboxes(req.user.email)
        ).some((row) => row.email === email);

        if (!permitted) {
            return res
                .status(403)
                .json({ error: "Access denied for this mailbox" });
        }

        const user = await User.findByEmail(email);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const [usage, lastLogin] = await Promise.all([
            User.getQuotaUsage(email),
            User.getLastLogin(email),
        ]);

        res.json({
            success: true,
            user: {
                email: user.username,
                name: user.name,
                domain: user.domain,
                quota: user.quota,
                quotaBytes: quotaMbToBytes(user.quota),
                active: user.active,
                created: user.created,
                lastLogin,
                storageUsed: usage.bytes,
                totalMessages: usage.messages,
                quotaTrackingAvailable: usage.available,
            },
        });
    } catch (error) {
        console.error("Get user details error:", error);
        res.status(500).json({ error: "Failed to fetch user details" });
    }
});

module.exports = router;
