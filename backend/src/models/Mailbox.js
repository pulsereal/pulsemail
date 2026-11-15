// Every statement here targets iRedMail's vmail database, never our own.
const {
    mailQuery: query,
    getMailClient: getClient,
} = require("../config/database");
const {
    generateMaildir,
    splitStorage,
    hashPassword,
    parseSettings,
    serializeSettings,
    quotaMbToBytes,
    SERVICE_GROUPS,
    quoteColumn,
    isValidEmail,
} = require("../config/iredmail");

const PROFILE_COLUMNS = {
    first_name: "firstName",
    last_name: "lastName",
    mobile: "mobile",
    telephone: "telephone",
    recovery_email: "recoveryEmail",
};

/**
 * Columns iRedMail introduced in 1.7.3. Older releases have none of them, and
 * the schema is iRedMail's to change, so each is written only when it exists.
 */
const OPTIONAL_COLUMNS = {
    mailbox: Object.keys(PROFILE_COLUMNS),
    deleted_mailboxes: ["bytes", "messages"],
};

let optionalColumns = null;

/** Resolves to the `table.column` names from OPTIONAL_COLUMNS that exist. */
const presentOptionalColumns = () => {
    optionalColumns ??= query(
        `SELECT c.relname AS table_name, a.attname AS column_name
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
          WHERE a.attrelid IN (SELECT to_regclass(name) FROM unnest($1::text[]) AS name)
            AND a.attname = ANY ($2::text[])
            AND a.attnum > 0
            AND NOT a.attisdropped`,
        [Object.keys(OPTIONAL_COLUMNS), Object.values(OPTIONAL_COLUMNS).flat()]
    ).then(
        (result) =>
            new Set(
                result.rows.map((row) => `${row.table_name}.${row.column_name}`)
            ),
        (error) => {
            optionalColumns = null;
            throw error;
        }
    );
    return optionalColumns;
};

/** `name` is the only display-name column every iRedMail release has. */
const displayName = ({ name, firstName, lastName }) =>
    String(name ?? "").trim() ||
    [firstName, lastName]
        .map((part) => String(part ?? "").trim())
        .filter(Boolean)
        .join(" ");

const placeholders = (values) => values.map((_, i) => `$${i + 1}`).join(", ");

/**
 * Provisioning against iRedMail's `mailbox` table plus the `forwardings` rows
 * Postfix needs to route to it.
 *
 * Every mail user owns a self-referencing forwardings row
 * (address == forwarding == the user's own address). virtual_alias_maps
 * resolves through that row, so dropping it is how "forward without keeping a
 * local copy" is expressed.
 */
class Mailbox {
    static #shape(row, extras = {}) {
        if (!row) return null;

        const services = {};
        for (const [group, columns] of Object.entries(SERVICE_GROUPS)) {
            services[group] = columns.every(
                (column) => Number(row[column]) === 1
            );
        }

        return {
            email: row.username,
            name: row.name || "",
            domain: row.domain,
            quotaMb: parseInt(row.quota || 0, 10),
            quotaBytes: quotaMbToBytes(row.quota),
            active: Number(row.active) === 1,
            isGlobalAdmin: Number(row.isglobaladmin) === 1,
            language: row.language || "",
            maildir: row.maildir,
            employeeId: row.employeeid || "",
            department: row.department || "",
            firstName: row.first_name || "",
            lastName: row.last_name || "",
            mobile: row.mobile || "",
            telephone: row.telephone || "",
            recoveryEmail: row.recovery_email || "",
            passwordLastChange: row.passwordlastchange,
            created: row.created,
            modified: row.modified,
            services,
            settings: parseSettings(row.settings),
            ...extras,
        };
    }

    static async findByEmail(email) {
        const result = await query(
            `SELECT m.*, u.bytes AS used_bytes, u.messages AS used_messages
               FROM mailbox m
               LEFT JOIN used_quota u ON u.username = m.username
              WHERE m.username = $1`,
            [email]
        );

        const row = result.rows[0];
        if (!row) return null;

        return Mailbox.#shape(row, {
            usedBytes: parseInt(row.used_bytes || 0, 10),
            usedMessages: parseInt(row.used_messages || 0, 10),
        });
    }

    static async list({
        domains = null,
        search = "",
        limit = 50,
        offset = 0,
    } = {}) {
        const conditions = [];
        const params = [];

        if (Array.isArray(domains)) {
            if (domains.length === 0) return { rows: [], total: 0 };
            const placeholders = domains.map((_, i) => `$${i + 1}`).join(",");
            conditions.push(`m.domain IN (${placeholders})`);
            params.push(...domains);
        }

        if (search) {
            params.push(`%${search}%`);
            conditions.push(
                `(m.username ILIKE $${params.length} OR m.name ILIKE $${params.length})`
            );
        }

        const where = conditions.length
            ? `WHERE ${conditions.join(" AND ")}`
            : "";

        const countResult = await query(
            `SELECT COUNT(*) AS total FROM mailbox m ${where}`,
            params
        );

        const result = await query(
            `SELECT m.*, u.bytes AS used_bytes, u.messages AS used_messages
               FROM mailbox m
               LEFT JOIN used_quota u ON u.username = m.username
               ${where}
              ORDER BY m.domain, m.username
              LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );

        return {
            rows: result.rows.map((row) =>
                Mailbox.#shape(row, {
                    usedBytes: parseInt(row.used_bytes || 0, 10),
                    usedMessages: parseInt(row.used_messages || 0, 10),
                })
            ),
            total: parseInt(countResult.rows[0]?.total || 0, 10),
        };
    }

    static async create(input) {
        const email = String(input.email || "")
            .trim()
            .toLowerCase();

        if (!isValidEmail(email)) {
            throw Object.assign(new Error("Invalid email address"), {
                status: 400,
            });
        }
        if (!input.password) {
            throw Object.assign(new Error("Password is required"), {
                status: 400,
            });
        }

        const domain = email.split("@")[1];

        const domainRow = await query(
            "SELECT domain, mailboxes, maxquota, settings FROM domain WHERE domain = $1",
            [domain]
        );
        if (domainRow.rows.length === 0) {
            throw Object.assign(
                new Error(`Domain ${domain} is not hosted here`),
                { status: 400 }
            );
        }

        const existing = await query(
            "SELECT username FROM mailbox WHERE username = $1",
            [email]
        );
        if (existing.rows.length > 0) {
            throw Object.assign(new Error("Mailbox already exists"), {
                status: 409,
            });
        }

        const limits = domainRow.rows[0];
        const settings = parseSettings(limits.settings);

        if (Number(limits.mailboxes) > 0) {
            const count = await query(
                "SELECT COUNT(*) AS total FROM mailbox WHERE domain = $1",
                [domain]
            );
            if (
                parseInt(count.rows[0].total, 10) >= Number(limits.mailboxes)
            ) {
                throw Object.assign(
                    new Error(`Domain ${domain} has reached its mailbox limit`),
                    { status: 409 }
                );
            }
        }

        const quotaMb =
            input.quotaMb ?? parseInt(settings.default_user_quota || 1024, 10);

        if (Number(limits.maxquota) > 0 && quotaMb > Number(limits.maxquota)) {
            throw Object.assign(
                new Error(
                    `Quota exceeds the domain maximum of ${limits.maxquota} MB`
                ),
                { status: 400 }
            );
        }

        const { base, node } = splitStorage();
        const present = await presentOptionalColumns();

        const row = {
            username: email,
            password: await hashPassword(input.password, input.scheme),
            name: displayName(input),
            language: input.language || "en_US",
            storagebasedirectory: base,
            storagenode: node,
            maildir: generateMaildir(email),
            quota: quotaMb,
            domain,
            employeeid: input.employeeId || "",
            department: input.department || "",
            isadmin: 0,
            isglobaladmin: input.isGlobalAdmin ? 1 : 0,
            active: input.active === false ? 0 : 1,
        };
        for (const [column, field] of Object.entries(PROFILE_COLUMNS)) {
            if (present.has(`mailbox.${column}`)) {
                row[column] = input[field] || "";
            }
        }

        const client = await getClient();

        try {
            await client.query("BEGIN");

            const columns = Object.keys(row);
            await client.query(
                `INSERT INTO mailbox
                    (${columns.join(", ")}, passwordlastchange, created)
                 VALUES (${placeholders(columns)}, NOW(), NOW())`,
                Object.values(row)
            );

            // Postfix resolves the mailbox through virtual_alias_maps
            await client.query(
                `INSERT INTO forwardings
                    (address, forwarding, domain, dest_domain, is_forwarding, active)
                 VALUES ($1, $1, $2, $2, 1, 1)`,
                [email, domain]
            );

            if (input.isGlobalAdmin) {
                await client.query(
                    `INSERT INTO domain_admins (username, domain, created, active)
                     VALUES ($1, 'ALL', NOW(), 1)
                     ON CONFLICT (username, domain) DO UPDATE SET active = 1`,
                    [email]
                );
            }

            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }

        return Mailbox.findByEmail(email);
    }

    static async update(email, input) {
        const current = await Mailbox.findByEmail(email);
        if (!current) {
            throw Object.assign(new Error("Mailbox not found"), {
                status: 404,
            });
        }

        const assignments = [];
        const params = [email];

        const set = (column, value) => {
            if (value === undefined) return;
            params.push(value);
            assignments.push(`${quoteColumn(column)} = $${params.length}`);
        };

        const present = await presentOptionalColumns();

        set("name", input.name === undefined ? undefined : displayName(input));
        set("language", input.language);
        set("employeeid", input.employeeId);
        set("department", input.department);
        for (const [column, field] of Object.entries(PROFILE_COLUMNS)) {
            if (present.has(`mailbox.${column}`)) set(column, input[field]);
        }
        set(
            "active",
            input.active === undefined ? undefined : input.active ? 1 : 0
        );

        if (input.quotaMb !== undefined) {
            const domainRow = await query(
                "SELECT maxquota FROM domain WHERE domain = $1",
                [current.domain]
            );
            const maxQuota = Number(domainRow.rows[0]?.maxquota || 0);
            if (maxQuota > 0 && input.quotaMb > maxQuota) {
                throw Object.assign(
                    new Error(
                        `Quota exceeds the domain maximum of ${maxQuota} MB`
                    ),
                    { status: 400 }
                );
            }
            set("quota", input.quotaMb);
        }

        // A service group maps onto several Dovecot/Postfix columns
        if (input.services) {
            for (const [group, enabled] of Object.entries(input.services)) {
                const columns = SERVICE_GROUPS[group];
                if (!columns) continue;
                for (const column of columns) {
                    set(column, enabled ? 1 : 0);
                }
            }
        }

        if (input.settings) {
            set(
                "settings",
                serializeSettings({ ...current.settings, ...input.settings })
            );
        }

        if (assignments.length > 0) {
            await query(
                `UPDATE mailbox SET ${assignments.join(", ")}, modified = NOW()
                  WHERE username = $1`,
                params
            );
        }

        if (input.isGlobalAdmin !== undefined) {
            await Mailbox.setGlobalAdmin(email, input.isGlobalAdmin);
        }

        return Mailbox.findByEmail(email);
    }

    static async setGlobalAdmin(email, isGlobalAdmin) {
        await query(
            "UPDATE mailbox SET isglobaladmin = $2, modified = NOW() WHERE username = $1",
            [email, isGlobalAdmin ? 1 : 0]
        );

        if (isGlobalAdmin) {
            await query(
                `INSERT INTO domain_admins (username, domain, created, active)
                 VALUES ($1, 'ALL', NOW(), 1)
                 ON CONFLICT (username, domain) DO UPDATE SET active = 1`,
                [email]
            );
        } else {
            await query(
                "DELETE FROM domain_admins WHERE username = $1 AND domain = 'ALL'",
                [email]
            );
        }

        return true;
    }

    /**
     * Delete the SQL side of a mailbox and file the Maildir for removal.
     *
     * The message files themselves stay on disk: iRedMail's convention is that
     * a cron job reads `deleted_mailboxes` and removes them later, which keeps
     * an accidental deletion recoverable.
     */
    static async remove(email, { deletedBy, keepMaildirDays = 7 } = {}) {
        const mailbox = await query(
            `SELECT m.username, m.domain, m.storagebasedirectory, m.storagenode,
                    m.maildir, u.bytes, u.messages
               FROM mailbox m
               LEFT JOIN used_quota u ON u.username = m.username
              WHERE m.username = $1`,
            [email]
        );

        const row = mailbox.rows[0];
        if (!row) {
            throw Object.assign(new Error("Mailbox not found"), {
                status: 404,
            });
        }

        const fullMaildir = [
            row.storagebasedirectory,
            row.storagenode,
            row.maildir,
        ]
            .filter(Boolean)
            .join("/")
            .replace(/\/+/g, "/");

        const deleteDate = new Date();
        deleteDate.setDate(deleteDate.getDate() + keepMaildirDays);

        const present = await presentOptionalColumns();
        const tombstone = {
            username: email,
            domain: row.domain,
            maildir: fullMaildir,
            admin: deletedBy || "",
            delete_date: deleteDate.toISOString().slice(0, 10),
        };
        for (const column of OPTIONAL_COLUMNS.deleted_mailboxes) {
            if (present.has(`deleted_mailboxes.${column}`)) {
                tombstone[column] = parseInt(row[column] || 0, 10);
            }
        }

        const client = await getClient();

        try {
            await client.query("BEGIN");

            const columns = Object.keys(tombstone);
            await client.query(
                `INSERT INTO deleted_mailboxes (${columns.join(", ")})
                 VALUES (${placeholders(columns)})`,
                Object.values(tombstone)
            );

            await client.query(
                "DELETE FROM forwardings WHERE address = $1 OR forwarding = $1",
                [email]
            );
            await client.query("DELETE FROM moderators WHERE moderator = $1", [
                email,
            ]);
            await client.query(
                "DELETE FROM maillist_owners WHERE owner = $1",
                [email]
            );
            await client.query(
                "DELETE FROM domain_admins WHERE username = $1",
                [email]
            );
            await client.query(
                "DELETE FROM sender_bcc_user WHERE username = $1",
                [email]
            );
            await client.query(
                "DELETE FROM recipient_bcc_user WHERE username = $1",
                [email]
            );
            await client.query("DELETE FROM used_quota WHERE username = $1", [
                email,
            ]);
            await client.query(
                "DELETE FROM share_folder WHERE from_user = $1 OR to_user = $1",
                [email]
            );
            await client.query("DELETE FROM mailbox WHERE username = $1", [
                email,
            ]);

            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }

        return { maildir: fullMaildir, scheduledDeletion: deleteDate };
    }

    // Per-user forwarding ---------------------------------------------------

    /**
     * Destinations mail to this address is copied to. The self-referencing row
     * is reported separately as `keepCopy` rather than as a destination.
     */
    static async getForwardings(email) {
        const result = await query(
            `SELECT forwarding, active FROM forwardings
              WHERE address = $1 AND is_forwarding = 1
              ORDER BY forwarding`,
            [email]
        );

        const rows = result.rows;
        return {
            keepCopy: rows.some((row) => row.forwarding === email),
            destinations: rows
                .filter((row) => row.forwarding !== email)
                .map((row) => row.forwarding),
        };
    }

    static async setForwardings(email, destinations = [], keepCopy = true) {
        const domain = email.split("@")[1];
        const targets = [...new Set(destinations.filter(isValidEmail))];

        if (!keepCopy && targets.length === 0) {
            throw Object.assign(
                new Error(
                    "Cannot disable the local copy without a forwarding destination"
                ),
                { status: 400 }
            );
        }

        const client = await getClient();

        try {
            await client.query("BEGIN");
            await client.query(
                "DELETE FROM forwardings WHERE address = $1 AND is_forwarding = 1",
                [email]
            );

            const rows = keepCopy ? [email, ...targets] : targets;
            for (const forwarding of rows) {
                await client.query(
                    `INSERT INTO forwardings
                        (address, forwarding, domain, dest_domain, is_forwarding, active)
                     VALUES ($1, $2, $3, $4, 1, 1)`,
                    [
                        email,
                        forwarding,
                        domain,
                        forwarding.split("@")[1] || "",
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

        return Mailbox.getForwardings(email);
    }

    // Per-account alias addresses -------------------------------------------

    static async getAliasAddresses(email) {
        const result = await query(
            `SELECT address FROM forwardings
              WHERE forwarding = $1 AND is_alias = 1
              ORDER BY address`,
            [email]
        );
        return result.rows.map((row) => row.address);
    }

    static async setAliasAddresses(email, addresses = []) {
        const domain = email.split("@")[1];
        const targets = [...new Set(addresses.filter(isValidEmail))];
        const client = await getClient();

        try {
            await client.query("BEGIN");
            await client.query(
                "DELETE FROM forwardings WHERE forwarding = $1 AND is_alias = 1",
                [email]
            );

            for (const address of targets) {
                await client.query(
                    `INSERT INTO forwardings
                        (address, forwarding, domain, dest_domain, is_alias, active)
                     VALUES ($1, $2, $3, $4, 1, 1)`,
                    [address, email, address.split("@")[1] || domain, domain]
                );
            }

            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }

        return Mailbox.getAliasAddresses(email);
    }

    // BCC rules -------------------------------------------------------------

    static async getBcc(email) {
        const [sender, recipient] = await Promise.all([
            query(
                "SELECT bcc_address FROM sender_bcc_user WHERE username = $1 AND active = 1",
                [email]
            ),
            query(
                "SELECT bcc_address FROM recipient_bcc_user WHERE username = $1 AND active = 1",
                [email]
            ),
        ]);

        return {
            sender: sender.rows[0]?.bcc_address || null,
            recipient: recipient.rows[0]?.bcc_address || null,
        };
    }

    static async setBcc(email, { sender, recipient }) {
        const domain = email.split("@")[1];

        const apply = async (table, address) => {
            if (address === undefined) return;

            if (!address) {
                await query(`DELETE FROM ${table} WHERE username = $1`, [
                    email,
                ]);
                return;
            }

            await query(
                `INSERT INTO ${table} (username, bcc_address, domain, created, active)
                 VALUES ($1, $2, $3, NOW(), 1)
                 ON CONFLICT (username)
                 DO UPDATE SET bcc_address = $2, modified = NOW(), active = 1`,
                [email, address, domain]
            );
        };

        await apply("sender_bcc_user", sender);
        await apply("recipient_bcc_user", recipient);

        return Mailbox.getBcc(email);
    }
}

module.exports = Mailbox;
