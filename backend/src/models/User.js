const { query } = require("../config/database");
const bcrypt = require("bcryptjs");

class User {
    // Get user by email (from mailbox table in Pulsemail)
    static async findByEmail(email) {
        try {
            const result = await query(
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
            // Check if user is in domain_admins table
            const adminResult = await query(
                "SELECT * FROM domain_admins WHERE username = $1",
                [email]
            );

            if (adminResult.rows.length > 0) {
                return {
                    isAdmin: true,
                    adminType: "domain",
                    domains: adminResult.rows.map((row) => row.domain),
                };
            }

            // Check if user is global admin (usually indicated by @ALL domain)
            const globalAdminResult = await query(
                "SELECT * FROM domain_admins WHERE username = $1 AND domain = $2",
                [email, "ALL"]
            );

            if (globalAdminResult.rows.length > 0) {
                return {
                    isAdmin: true,
                    adminType: "global",
                    domains: ["ALL"],
                };
            }

            return {
                isAdmin: false,
                adminType: null,
                domains: [],
            };
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

            const result = await query(
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

    // Switch to another mailbox (admin only)
    static async switchToMailbox(adminEmail, targetEmail) {
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

            // Log the mailbox switch for audit
            await query(
                `
        INSERT INTO admin_mailbox_switches (
          admin_email, target_email, switched_at, ip_address
        )
        VALUES ($1, $2, NOW(), $3)
      `,
                [adminEmail, targetEmail, "0.0.0.0"]
            ); // IP will be set from middleware

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

            // Pulsemail uses different password schemes
            const isValid = await this.verifyPassword(password, user.password);
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

    // Verify password based on Pulsemail schemes
    static async verifyPassword(plainPassword, hashedPassword) {
        try {
            // Handle different password schemes used by Pulsemail
            if (hashedPassword.startsWith("{SSHA512}")) {
                // SSHA512 verification
                return await this.verifySSSHA512(plainPassword, hashedPassword);
            } else if (hashedPassword.startsWith("{SSHA256}")) {
                // SSHA256 verification
                return await this.verifySSSHA256(plainPassword, hashedPassword);
            } else if (hashedPassword.startsWith("{SSHA}")) {
                // SSHA verification
                return await this.verifySSHA(plainPassword, hashedPassword);
            } else if (
                hashedPassword.startsWith("$2b$") ||
                hashedPassword.startsWith("$2a$")
            ) {
                // bcrypt verification
                return await bcrypt.compare(plainPassword, hashedPassword);
            }
            return false;
        } catch (error) {
            console.error("Password verification error:", error);
            return false;
        }
    }

    // SSHA512 verification
    static async verifySSSHA512(password, hash) {
        const crypto = require("crypto");
        const decoded = Buffer.from(hash.substring(9), "base64");
        const salt = decoded.slice(64);
        const hashedPassword = crypto
            .createHash("sha512")
            .update(password + salt.toString())
            .digest();
        return Buffer.compare(hashedPassword, decoded.slice(0, 64)) === 0;
    }

    // SSHA256 verification
    static async verifySSSHA256(password, hash) {
        const crypto = require("crypto");
        const decoded = Buffer.from(hash.substring(9), "base64");
        const salt = decoded.slice(32);
        const hashedPassword = crypto
            .createHash("sha256")
            .update(password + salt.toString())
            .digest();
        return Buffer.compare(hashedPassword, decoded.slice(0, 32)) === 0;
    }

    // SSHA verification
    static async verifySSHA(password, hash) {
        const crypto = require("crypto");
        const decoded = Buffer.from(hash.substring(6), "base64");
        const salt = decoded.slice(20);
        const hashedPassword = crypto
            .createHash("sha1")
            .update(password + salt.toString())
            .digest();
        return Buffer.compare(hashedPassword, decoded.slice(0, 20)) === 0;
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

module.exports = User;
