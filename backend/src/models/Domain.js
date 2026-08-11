// Every statement here targets iRedMail's vmail database, never our own.
const {
    mailQuery: query,
    getMailClient: getClient,
} = require("../config/database");
const {
    DOMAIN_TRANSPORT,
    parseSettings,
    serializeSettings,
    isValidDomain,
    quotaMbToBytes,
} = require("../config/iredmail");

/**
 * CRUD over iRedMail's `domain`, `alias_domain` and `domain_admins` tables.
 *
 * Postfix reads `domain` through virtual_mailbox_domains / relay_domains, so a
 * row written here takes effect on the next lookup with no restart needed.
 */
class Domain {
    static #shape(row, extras = {}) {
        if (!row) return null;
        const settings = parseSettings(row.settings);

        return {
            domain: row.domain,
            description: row.description || "",
            disclaimer: row.disclaimer || "",
            maxAliases: parseInt(row.aliases || 0, 10),
            maxMailboxes: parseInt(row.mailboxes || 0, 10),
            maxMaillists: parseInt(row.maillists || 0, 10),
            maxQuotaMb: parseInt(row.maxquota || 0, 10),
            transport: row.transport || DOMAIN_TRANSPORT,
            backupmx: Number(row.backupmx) === 1,
            active: Number(row.active) === 1,
            created: row.created,
            modified: row.modified,
            defaultUserQuotaMb: parseInt(settings.default_user_quota || 0, 10),
            settings,
            ...extras,
        };
    }

    static async list({ domains = null, search = "" } = {}) {
        const conditions = [];
        const params = [];

        if (Array.isArray(domains)) {
            if (domains.length === 0) return [];
            const placeholders = domains.map((_, i) => `$${i + 1}`).join(",");
            conditions.push(`d.domain IN (${placeholders})`);
            params.push(...domains);
        }

        if (search) {
            params.push(`%${search}%`);
            conditions.push(
                `(d.domain ILIKE $${params.length} OR d.description ILIKE $${params.length})`
            );
        }

        const where = conditions.length
            ? `WHERE ${conditions.join(" AND ")}`
            : "";

        const result = await query(
            `SELECT d.*,
                    (SELECT COUNT(*) FROM mailbox m WHERE m.domain = d.domain)
                        AS mailbox_count,
                    (SELECT COUNT(*) FROM alias a WHERE a.domain = d.domain)
                        AS alias_count
               FROM domain d
               ${where}
              ORDER BY d.domain`,
            params
        );

        return result.rows.map((row) =>
            Domain.#shape(row, {
                mailboxCount: parseInt(row.mailbox_count || 0, 10),
                aliasCount: parseInt(row.alias_count || 0, 10),
            })
        );
    }

    static async findByName(domain) {
        const result = await query("SELECT * FROM domain WHERE domain = $1", [
            domain,
        ]);
        return Domain.#shape(result.rows[0]);
    }

    /**
     * Usage roll-up for a domain, sourced from the `used_quota` table Dovecot
     * maintains rather than from anything we track ourselves.
     */
    static async usage(domain) {
        const result = await query(
            `SELECT COUNT(m.username) AS mailboxes,
                    COALESCE(SUM(m.quota), 0) AS quota_mb,
                    COALESCE(SUM(u.bytes), 0) AS used_bytes,
                    COALESCE(SUM(u.messages), 0) AS messages
               FROM mailbox m
               LEFT JOIN used_quota u ON u.username = m.username
              WHERE m.domain = $1`,
            [domain]
        );

        const row = result.rows[0] || {};
        return {
            mailboxes: parseInt(row.mailboxes || 0, 10),
            quotaBytes: quotaMbToBytes(row.quota_mb || 0),
            usedBytes: parseInt(row.used_bytes || 0, 10),
            messages: parseInt(row.messages || 0, 10),
        };
    }

    static async create(input) {
        const domain = String(input.domain || "")
            .trim()
            .toLowerCase();

        if (!isValidDomain(domain)) {
            throw Object.assign(new Error("Invalid domain name"), {
                status: 400,
            });
        }

        const existing = await Domain.findByName(domain);
        if (existing) {
            throw Object.assign(new Error("Domain already exists"), {
                status: 409,
            });
        }

        const settings = serializeSettings({
            default_user_quota: input.defaultUserQuotaMb ?? 1024,
        });

        await query(
            `INSERT INTO domain
                (domain, description, disclaimer, aliases, mailboxes, maillists,
                 maxquota, transport, settings, backupmx, active, created)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
            [
                domain,
                input.description || "",
                input.disclaimer || "",
                input.maxAliases ?? 0,
                input.maxMailboxes ?? 0,
                input.maxMaillists ?? 0,
                input.maxQuotaMb ?? 0,
                input.transport || DOMAIN_TRANSPORT,
                settings,
                input.backupmx ? 1 : 0,
                input.active === false ? 0 : 1,
            ]
        );

        return Domain.findByName(domain);
    }

    static async update(domain, input) {
        const current = await Domain.findByName(domain);
        if (!current) {
            throw Object.assign(new Error("Domain not found"), { status: 404 });
        }

        const assignments = [];
        const params = [domain];

        const set = (column, value) => {
            if (value === undefined) return;
            params.push(value);
            assignments.push(`${column} = $${params.length}`);
        };

        set("description", input.description);
        set("disclaimer", input.disclaimer);
        set("aliases", input.maxAliases);
        set("mailboxes", input.maxMailboxes);
        set("maillists", input.maxMaillists);
        set("maxquota", input.maxQuotaMb);
        set("transport", input.transport);
        set(
            "backupmx",
            input.backupmx === undefined ? undefined : input.backupmx ? 1 : 0
        );
        set(
            "active",
            input.active === undefined ? undefined : input.active ? 1 : 0
        );

        if (input.defaultUserQuotaMb !== undefined) {
            set(
                "settings",
                serializeSettings({
                    ...current.settings,
                    default_user_quota: input.defaultUserQuotaMb,
                })
            );
        }

        if (assignments.length === 0) return current;

        await query(
            `UPDATE domain SET ${assignments.join(", ")}, modified = NOW()
              WHERE domain = $1`,
            params
        );

        return Domain.findByName(domain);
    }

    /**
     * Removing a domain has to take every dependent row with it, otherwise
     * Postfix keeps resolving orphaned aliases and forwardings.
     */
    static async remove(domain) {
        const client = await getClient();

        try {
            await client.query("BEGIN");
            await client.query("DELETE FROM forwardings WHERE domain = $1", [
                domain,
            ]);
            await client.query(
                "DELETE FROM forwardings WHERE dest_domain = $1",
                [domain]
            );
            await client.query("DELETE FROM alias WHERE domain = $1", [domain]);
            await client.query("DELETE FROM moderators WHERE domain = $1", [
                domain,
            ]);
            await client.query(
                "DELETE FROM maillist_owners WHERE domain = $1",
                [domain]
            );
            await client.query("DELETE FROM maillists WHERE domain = $1", [
                domain,
            ]);
            await client.query("DELETE FROM domain_admins WHERE domain = $1", [
                domain,
            ]);
            await client.query(
                "DELETE FROM alias_domain WHERE target_domain = $1 OR alias_domain = $1",
                [domain]
            );
            await client.query("DELETE FROM sender_bcc_domain WHERE domain = $1", [
                domain,
            ]);
            await client.query(
                "DELETE FROM recipient_bcc_domain WHERE domain = $1",
                [domain]
            );
            await client.query("DELETE FROM used_quota WHERE domain = $1", [
                domain,
            ]);
            await client.query("DELETE FROM mailbox WHERE domain = $1", [
                domain,
            ]);
            await client.query("DELETE FROM domain WHERE domain = $1", [
                domain,
            ]);
            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }

        return true;
    }

    // Domain administrators -------------------------------------------------

    static async listAdmins(domain) {
        const result = await query(
            `SELECT da.username, da.created, da.active, m.name
               FROM domain_admins da
               LEFT JOIN mailbox m ON m.username = da.username
              WHERE da.domain = $1
              ORDER BY da.username`,
            [domain]
        );

        return result.rows.map((row) => ({
            email: row.username,
            name: row.name || "",
            created: row.created,
            active: Number(row.active) === 1,
        }));
    }

    static async addAdmin(domain, email) {
        await query(
            `INSERT INTO domain_admins (username, domain, created, active)
             VALUES ($1, $2, NOW(), 1)
             ON CONFLICT (username, domain) DO UPDATE SET active = 1`,
            [email, domain]
        );
        return true;
    }

    static async removeAdmin(domain, email) {
        await query(
            "DELETE FROM domain_admins WHERE username = $1 AND domain = $2",
            [email, domain]
        );
        return true;
    }

    // Alias domains ---------------------------------------------------------

    static async listAliasDomains(targetDomain) {
        const result = await query(
            `SELECT alias_domain, target_domain, active, created
               FROM alias_domain
              WHERE target_domain = $1
              ORDER BY alias_domain`,
            [targetDomain]
        );

        return result.rows.map((row) => ({
            aliasDomain: row.alias_domain,
            targetDomain: row.target_domain,
            active: Number(row.active) === 1,
            created: row.created,
        }));
    }

    static async addAliasDomain(targetDomain, aliasDomain) {
        const normalized = String(aliasDomain).trim().toLowerCase();

        if (!isValidDomain(normalized)) {
            throw Object.assign(new Error("Invalid alias domain"), {
                status: 400,
            });
        }

        await query(
            `INSERT INTO alias_domain (alias_domain, target_domain, created, active)
             VALUES ($1, $2, NOW(), 1)
             ON CONFLICT (alias_domain)
             DO UPDATE SET target_domain = $2, active = 1, modified = NOW()`,
            [normalized, targetDomain]
        );

        return true;
    }

    static async removeAliasDomain(aliasDomain) {
        await query("DELETE FROM alias_domain WHERE alias_domain = $1", [
            aliasDomain,
        ]);
        return true;
    }

    // Catch-all -------------------------------------------------------------

    /**
     * Postfix's catchall_maps looks up `forwardings` rows keyed on the bare
     * domain name, so a catch-all is just a forwarding whose address is the
     * domain itself.
     */
    static async getCatchAll(domain) {
        const result = await query(
            `SELECT forwarding FROM forwardings
              WHERE address = $1 AND is_forwarding = 1 AND active = 1`,
            [domain]
        );
        return result.rows.map((row) => row.forwarding);
    }

    static async setCatchAll(domain, destinations = []) {
        const client = await getClient();

        try {
            await client.query("BEGIN");
            await client.query("DELETE FROM forwardings WHERE address = $1", [
                domain,
            ]);

            for (const destination of destinations) {
                await client.query(
                    `INSERT INTO forwardings
                        (address, forwarding, domain, dest_domain, is_forwarding, active)
                     VALUES ($1, $2, $3, $4, 1, 1)`,
                    [
                        domain,
                        destination,
                        domain,
                        destination.split("@")[1] || "",
                    ]
                );
            }

            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }

        return true;
    }
}

module.exports = Domain;
