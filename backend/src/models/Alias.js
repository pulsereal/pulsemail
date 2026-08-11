// Every statement here targets iRedMail's vmail database, never our own.
const {
    mailQuery: query,
    getMailClient: getClient,
} = require("../config/database");
const { isValidEmail } = require("../config/iredmail");

/**
 * Standalone mail aliases: a row in `alias` for the address itself plus one
 * `forwardings` row per member, flagged `is_list = 1`.
 *
 * Postfix's virtual_alias_maps only reads `forwardings`; the `alias` table
 * carries the metadata (name, access policy, active flag) that iRedAdmin shows.
 */
class Alias {
    static #shape(row, members = []) {
        if (!row) return null;

        return {
            address: row.address,
            name: row.name || "",
            domain: row.domain,
            accessPolicy: row.accesspolicy || "public",
            active: Number(row.active) === 1,
            created: row.created,
            modified: row.modified,
            members,
        };
    }

    static async list({ domains = null, search = "" } = {}) {
        const conditions = [];
        const params = [];

        if (Array.isArray(domains)) {
            if (domains.length === 0) return [];
            const placeholders = domains.map((_, i) => `$${i + 1}`).join(",");
            conditions.push(`a.domain IN (${placeholders})`);
            params.push(...domains);
        }

        if (search) {
            params.push(`%${search}%`);
            conditions.push(
                `(a.address ILIKE $${params.length} OR a.name ILIKE $${params.length})`
            );
        }

        const where = conditions.length
            ? `WHERE ${conditions.join(" AND ")}`
            : "";

        const result = await query(
            `SELECT a.*,
                    COALESCE(
                        (SELECT COUNT(*) FROM forwardings f
                          WHERE f.address = a.address AND f.is_list = 1), 0
                    ) AS member_count
               FROM alias a
               ${where}
              ORDER BY a.domain, a.address`,
            params
        );

        return result.rows.map((row) => ({
            ...Alias.#shape(row),
            memberCount: parseInt(row.member_count || 0, 10),
        }));
    }

    static async findByAddress(address) {
        const [aliasResult, memberResult] = await Promise.all([
            query("SELECT * FROM alias WHERE address = $1", [address]),
            query(
                `SELECT forwarding FROM forwardings
                  WHERE address = $1 AND is_list = 1
                  ORDER BY forwarding`,
                [address]
            ),
        ]);

        return Alias.#shape(
            aliasResult.rows[0],
            memberResult.rows.map((row) => row.forwarding)
        );
    }

    static async create(input) {
        const address = String(input.address || "")
            .trim()
            .toLowerCase();

        if (!isValidEmail(address)) {
            throw Object.assign(new Error("Invalid alias address"), {
                status: 400,
            });
        }

        const domain = address.split("@")[1];

        const conflict = await query(
            `SELECT 1 FROM mailbox WHERE username = $1
             UNION ALL
             SELECT 1 FROM alias WHERE address = $1`,
            [address]
        );
        if (conflict.rows.length > 0) {
            throw Object.assign(
                new Error("That address is already in use"),
                { status: 409 }
            );
        }

        const domainRow = await query(
            "SELECT aliases FROM domain WHERE domain = $1",
            [domain]
        );
        if (domainRow.rows.length === 0) {
            throw Object.assign(
                new Error(`Domain ${domain} is not hosted here`),
                { status: 400 }
            );
        }

        const maxAliases = Number(domainRow.rows[0].aliases || 0);
        if (maxAliases > 0) {
            const count = await query(
                "SELECT COUNT(*) AS total FROM alias WHERE domain = $1",
                [domain]
            );
            if (parseInt(count.rows[0].total, 10) >= maxAliases) {
                throw Object.assign(
                    new Error(`Domain ${domain} has reached its alias limit`),
                    { status: 409 }
                );
            }
        }

        await query(
            `INSERT INTO alias (address, name, accesspolicy, domain, created, active)
             VALUES ($1, $2, $3, $4, NOW(), $5)`,
            [
                address,
                input.name || "",
                input.accessPolicy || "public",
                domain,
                input.active === false ? 0 : 1,
            ]
        );

        if (Array.isArray(input.members) && input.members.length > 0) {
            await Alias.setMembers(address, input.members);
        }

        return Alias.findByAddress(address);
    }

    static async update(address, input) {
        const current = await Alias.findByAddress(address);
        if (!current) {
            throw Object.assign(new Error("Alias not found"), { status: 404 });
        }

        const assignments = [];
        const params = [address];

        const set = (column, value) => {
            if (value === undefined) return;
            params.push(value);
            assignments.push(`${column} = $${params.length}`);
        };

        set("name", input.name);
        set("accesspolicy", input.accessPolicy);
        set(
            "active",
            input.active === undefined ? undefined : input.active ? 1 : 0
        );

        if (assignments.length > 0) {
            await query(
                `UPDATE alias SET ${assignments.join(", ")}, modified = NOW()
                  WHERE address = $1`,
                params
            );
        }

        if (Array.isArray(input.members)) {
            await Alias.setMembers(address, input.members);
        }

        return Alias.findByAddress(address);
    }

    static async setMembers(address, members = []) {
        const domain = address.split("@")[1];
        const targets = [...new Set(members.filter(isValidEmail))];
        const client = await getClient();

        try {
            await client.query("BEGIN");
            await client.query(
                "DELETE FROM forwardings WHERE address = $1 AND is_list = 1",
                [address]
            );

            for (const member of targets) {
                await client.query(
                    `INSERT INTO forwardings
                        (address, forwarding, domain, dest_domain, is_list, active)
                     VALUES ($1, $2, $3, $4, 1, 1)`,
                    [address, member, domain, member.split("@")[1] || ""]
                );
            }

            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }

        return targets;
    }

    static async remove(address) {
        const client = await getClient();

        try {
            await client.query("BEGIN");
            await client.query("DELETE FROM forwardings WHERE address = $1", [
                address,
            ]);
            await client.query("DELETE FROM moderators WHERE address = $1", [
                address,
            ]);
            await client.query("DELETE FROM alias WHERE address = $1", [
                address,
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
}

module.exports = Alias;
