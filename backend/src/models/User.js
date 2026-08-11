// Identity and quota live in iRedMail's vmail (mailQuery); preferences, 2FA,
// app passwords and the impersonation trail are ours (query).
const { query, mailQuery } = require("../config/database");
const bcrypt = require("bcryptjs");
const { verifyPassword, hashPassword } = require("../config/iredmail");

class User {
    // Get user by email (from mailbox table in Pulsemail)
    static async findByEmail(email) {
        try {
            const result = await mailQuery(
                "SELECT * FROM mailbox WHERE username = $1",
                [email]
            );
            return result.rows[0] || null;
        } catch (error) {
            throw new Error(`Error finding user: ${error.message}`);
        }
    }

    // Check if user is admin (from domain_admins table in Pulsemail)
    static async isAdmin(email) {
        try {
            const adminResult = await mailQuery(
                "SELECT * FROM domain_admins WHERE username = $1",
                [email]
            );

            if (adminResult.rows.length === 0) {
                return { isAdmin: false, adminType: null, domains: [] };
            }

            const domains = adminResult.rows.map((row) => row.domain);

            // iRedMail marks a global admin with the reserved "ALL" domain
            if (domains.includes("ALL")) {
                return { isAdmin: true, adminType: "global", domains: ["ALL"] };
            }

            return { isAdmin: true, adminType: "domain", domains };
        } catch (error) {
            console.error("Error checking admin status:", error);
            return {
                isAdmin: false,
                adminType: null,
                domains: [],
            };
        }
    }

    // Get list of mailboxes that admin can access
    static async getAccessibleMailboxes(adminEmail) {
        try {
            const adminInfo = await this.isAdmin(adminEmail);

            if (!adminInfo.isAdmin) {
                return [];
            }

            let whereClause = "";
            let params = [];

            if (adminInfo.adminType === "global") {
                // Global admin can access all mailboxes
                whereClause = "WHERE active = 1";
            } else {
                // Domain admin can only access mailboxes in their domains
                const domainPlaceholders = adminInfo.domains
                    .map((_, index) => `$${index + 1}`)
                    .join(",");
                whereClause = `WHERE domain IN (${domainPlaceholders}) AND active = 1`;
                params = adminInfo.domains;
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
        ORDER BY domain, username
      `,
                params
            );

            return result.rows;
        } catch (error) {
            throw new Error(
                `Error getting accessible mailboxes: ${error.message}`
            );
        }
    }

    /**
     * Record an admin touching someone else's mailbox.
     *
     * Requests are deduplicated per admin/target pair within
     * ADMIN_ACCESS_AUDIT_WINDOW_MS so a browsing session produces a readable
     * audit trail instead of one row per API call.
     */
    static async logMailboxAccess(adminEmail, targetEmail, ipAddress) {
        const windowMs = parseInt(
            process.env.ADMIN_ACCESS_AUDIT_WINDOW_MS || "300000",
            10
        );
        const key = `${adminEmail}->${targetEmail}`;
        const now = Date.now();
        const last = User._auditCache.get(key);

        if (last && now - last < windowMs) return false;
        User._auditCache.set(key, now);

        try {
            await query(
                `
        INSERT INTO admin_mailbox_switches (
          admin_email, target_email, switched_at, ip_address
        )
        VALUES ($1, $2, NOW(), $3)
      `,
                [adminEmail, targetEmail, ipAddress || "0.0.0.0"]
            );
            return true;
        } catch (error) {
            console.error(
                "Failed to write mailbox access audit:",
                error.message
            );
            return false;
        }
    }

    // Switch to another mailbox (admin only)
    static async switchToMailbox(adminEmail, targetEmail, ipAddress) {
        try {
            // Verify admin permissions
            const adminInfo = await this.isAdmin(adminEmail);

            if (!adminInfo.isAdmin) {
                throw new Error("Access denied: Not an admin user");
            }

            // Get target user
            const targetUser = await this.findByEmail(targetEmail);
            if (!targetUser) {
                throw new Error("Target mailbox not found");
            }

            // Check if admin has access to this mailbox
            const targetDomain = targetEmail.split("@")[1];

            if (
                adminInfo.adminType !== "global" &&
                !adminInfo.domains.includes(targetDomain)
            ) {
                throw new Error("Access denied: No permission for this domain");
            }

            User._auditCache.delete(`${adminEmail}->${targetEmail}`);
            await this.logMailboxAccess(adminEmail, targetEmail, ipAddress);

            return {
                id: targetUser.username,
                email: targetUser.username,
                name: targetUser.name,
                quota: targetUser.quota,
                storagebasedirectory: targetUser.storagebasedirectory,
                storagenode: targetUser.storagenode,
                maildir: targetUser.maildir,
                language: targetUser.language,
                active: targetUser.active,
                isAdminSwitch: true,
                originalAdmin: adminEmail,
            };
        } catch (error) {
            throw new Error(`Mailbox switch failed: ${error.message}`);
        }
    }

    // Get mailbox switch history
    static async getSwitchHistory(adminEmail, limit = 50) {
        try {
            const result = await query(
                `
        SELECT 
          target_email,
          switched_at,
          ip_address
        FROM admin_mailbox_switches 
        WHERE admin_email = $1
        ORDER BY switched_at DESC
        LIMIT $2
      `,
                [adminEmail, limit]
            );

            return result.rows;
        } catch (error) {
            return [];
        }
    }

    // Authenticate user
    static async authenticate(email, password) {
        try {
            const user = await this.findByEmail(email);
            if (!user) return null;

            // Development mode: allow simple authentication for testing
            const isDevelopment =
                process.env.NODE_ENV === "development" &&
                process.env.USE_MOCK_DATA === "true";

            let isValid = false;

            if (isDevelopment) {
                // In development mode, accept simple passwords
                if (
                    password === "test" ||
                    password === "admin" ||
                    password === "123"
                ) {
                    console.log(
                        "🔓 Development mode: Accepting simple password"
                    );
                    isValid = true;
                } else {
                    // Still try normal password verification
                    isValid = await this.verifyPassword(
                        password,
                        user.password
                    );
                }
            } else {
                // Production mode: normal password verification
                isValid = await this.verifyPassword(password, user.password);
            }

            if (isValid) {
                // Get admin status
                const adminInfo = await this.isAdmin(email);

                return {
                    id: user.username,
                    email: user.username,
                    name: user.name,
                    quota: user.quota,
                    storagebasedirectory: user.storagebasedirectory,
                    storagenode: user.storagenode,
                    maildir: user.maildir,
                    language: user.language,
                    active: user.active,
                    ...adminInfo,
                };
            }
            return null;
        } catch (error) {
            throw new Error(`Authentication error: ${error.message}`);
        }
    }

    // Verify a password against any scheme iRedMail may have written
    static async verifyPassword(plainPassword, hashedPassword) {
        try {
            return await verifyPassword(plainPassword, hashedPassword);
        } catch (error) {
            console.error("Password verification error:", error.message);
            return false;
        }
    }

    /**
     * Change a mailbox password in place. `passwordlastchange` is what
     * iRedMail's password-expiry policy reads, so it has to move too.
     */
    static async changePassword(email, newPassword, scheme) {
        const hashed = await hashPassword(newPassword, scheme);
        await mailQuery(
            `UPDATE mailbox
                SET password = $2,
                    passwordlastchange = NOW(),
                    modified = NOW()
              WHERE username = $1`,
            [email, hashed]
        );
        return true;
    }

    /**
     * Real mailbox usage. Dovecot's quota_clone dict keeps `used_quota` in
     * sync; the table is absent only when quota_clone is not configured.
     */
    static async getQuotaUsage(email) {
        try {
            const result = await mailQuery(
                "SELECT bytes, messages FROM used_quota WHERE username = $1",
                [email]
            );
            const row = result.rows[0];
            if (!row) return { bytes: 0, messages: 0, available: true };

            return {
                bytes: parseInt(row.bytes || 0, 10),
                messages: parseInt(row.messages || 0, 10),
                available: true,
            };
        } catch (error) {
            return { bytes: 0, messages: 0, available: false };
        }
    }

    // Dovecot's last_login dict stores unix epoch seconds per protocol
    static async getLastLogin(email) {
        try {
            const [, domain] = email.split("@");
            const result = await mailQuery(
                `SELECT imap, pop3, lda FROM last_login
                  WHERE username = $1 AND domain = $2`,
                [email, domain]
            );
            const row = result.rows[0];
            if (!row) return null;

            const newest = Math.max(
                parseInt(row.imap || 0, 10),
                parseInt(row.pop3 || 0, 10),
                parseInt(row.lda || 0, 10)
            );
            return newest > 0 ? new Date(newest * 1000).toISOString() : null;
        } catch (error) {
            return null;
        }
    }

    // Get user preferences
    static async getPreferences(email) {
        try {
            const result = await query(
                "SELECT * FROM user_preferences WHERE email = $1",
                [email]
            );
            return result.rows[0] || {};
        } catch (error) {
            // Table might not exist, return empty preferences
            return {};
        }
    }

    // Update user preferences
    static async updatePreferences(email, preferences) {
        try {
            await query(
                `
        INSERT INTO user_preferences (email, preferences, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (email)
        DO UPDATE SET preferences = $2, updated_at = NOW()
      `,
                [email, JSON.stringify(preferences)]
            );
            return true;
        } catch (error) {
            throw new Error(`Error updating preferences: ${error.message}`);
        }
    }

    // Update the mailbox display name
    static async updateDisplayName(email, name) {
        await mailQuery("UPDATE mailbox SET name = $2 WHERE username = $1", [
            email,
            name,
        ]);
        return true;
    }

    // Get user's app passwords for 2FA
    static async getAppPasswords(email) {
        try {
            const result = await query(
                "SELECT * FROM app_passwords WHERE email = $1 AND active = true",
                [email]
            );
            return result.rows;
        } catch (error) {
            return [];
        }
    }

    // Create app password
    static async createAppPassword(email, name, password) {
        try {
            const hashedPassword = await bcrypt.hash(password, 12);
            const result = await query(
                `
        INSERT INTO app_passwords (email, name, password, created_at, active)
        VALUES ($1, $2, $3, NOW(), true)
        RETURNING id, name, created_at
      `,
                [email, name, hashedPassword]
            );
            return result.rows[0];
        } catch (error) {
            throw new Error(`Error creating app password: ${error.message}`);
        }
    }

    // Get user's 2FA secret
    static async get2FASecret(email) {
        try {
            const result = await query(
                "SELECT totp_secret FROM user_2fa WHERE email = $1",
                [email]
            );
            return result.rows[0]?.totp_secret || null;
        } catch (error) {
            return null;
        }
    }

    // Set 2FA secret
    static async set2FASecret(email, secret) {
        try {
            await query(
                `
        INSERT INTO user_2fa (email, totp_secret, enabled, created_at)
        VALUES ($1, $2, false, NOW())
        ON CONFLICT (email)
        DO UPDATE SET totp_secret = $2, updated_at = NOW()
      `,
                [email, secret]
            );
            return true;
        } catch (error) {
            throw new Error(`Error setting 2FA secret: ${error.message}`);
        }
    }

    // Enable/disable 2FA
    static async toggle2FA(email, enabled) {
        try {
            await query(
                `
        UPDATE user_2fa SET enabled = $2, updated_at = NOW()
        WHERE email = $1
      `,
                [email, enabled]
            );
            return true;
        } catch (error) {
            throw new Error(`Error toggling 2FA: ${error.message}`);
        }
    }
}

User._auditCache = new Map();

module.exports = User;
