/**
 * Reproduces what the admin screens do, one layer at a time, and prints the
 * real error instead of the generic "Request failed" the API returns.
 *
 * Read-only.
 *
 *   cd /opt/pulsemail-client/backend
 *   node scripts/diagnose-admin.js
 */

require("dotenv").config();

const { mailQuery, query } = require("../src/config/database");

const show = (label, value) => console.log(`  ok    ${label}${value ? ` — ${value}` : ""}`);
const fail = (label, error) => {
    console.log(`  FAIL  ${label}`);
    console.log(`        ${error.message}`);
    if (error.code) console.log(`        pg code: ${error.code}`);
    if (error.hint) console.log(`        hint: ${error.hint}`);
};

const step = async (label, fn) => {
    try {
        show(label, await fn());
        return true;
    } catch (error) {
        fail(label, error);
        return false;
    }
};

const run = async () => {
    console.log(`\nConnected as ${process.env.DB_USER} to ${process.env.DB_NAME}`);

    // Must match deploy/grants.sql. A table here that is not granted there
    // surfaces as a 500 the moment a user opens the relevant screen.
    const TABLES = [
        "mailbox",
        "domain",
        "domain_admins",
        "alias",
        "alias_domain",
        "forwardings",
        "deleted_mailboxes",
        "sender_bcc_user",
        "recipient_bcc_user",
        "sender_bcc_domain",
        "recipient_bcc_domain",
        "moderators",
        "maillists",
        "maillist_owners",
        "share_folder",
        "used_quota",
        "last_login",
    ];

    console.log("\nRaw table access on the iRedMail database");
    for (const table of TABLES) {
        await step(`SELECT on ${table}`, async () => {
            const exists = await mailQuery(
                "SELECT to_regclass($1) IS NOT NULL AS present",
                [`public.${table}`]
            );
            if (!exists.rows[0].present) return "not in this schema, skipped";

            const r = await mailQuery(`SELECT COUNT(*) AS n FROM ${table}`);
            return `${r.rows[0].n} rows`;
        });
    }

    console.log("\nThe joins the mailbox list actually runs");
    await step("mailbox LEFT JOIN used_quota", async () => {
        const r = await mailQuery(
            `SELECT m.*, u.bytes AS used_bytes, u.messages AS used_messages
               FROM mailbox m
               LEFT JOIN used_quota u ON u.username = m.username
              ORDER BY m.domain, m.username
              LIMIT 5`
        );
        return `${r.rows.length} rows, ${Object.keys(r.rows[0] || {}).length} columns`;
    });

    console.log("\nModel layer");
    const Mailbox = require("../src/models/Mailbox");
    const Domain = require("../src/models/Domain");
    const Alias = require("../src/models/Alias");

    await step("Mailbox.list()", async () => {
        const r = await Mailbox.list({ limit: 5, offset: 0 });
        return `${r.rows.length} of ${r.total}`;
    });

    await step("Domain.list()", async () => {
        const r = await Domain.list();
        const list = Array.isArray(r) ? r : r.rows;
        return `${list.length} domains`;
    });

    await step("Alias.list()", async () => {
        const r = await Alias.list();
        const list = Array.isArray(r) ? r : r.rows;
        return `${list.length} aliases`;
    });

    const first = await mailQuery(
        "SELECT username FROM mailbox ORDER BY username LIMIT 1"
    );
    const email = first.rows[0]?.username;
    if (email) {
        await step(`Mailbox.findByEmail(${email})`, async () => {
            const m = await Mailbox.findByEmail(email);
            return m ? `resolved, quota ${m.quotaMb} MB` : "returned null";
        });
        await step(`Mailbox.getForwardings(${email})`, async () => {
            const f = await Mailbox.getForwardings(email);
            return `${f.destinations.length} destinations, keepCopy=${f.keepCopy}`;
        });
    }

    console.log("\nAdmin scope resolution");
    const User = require("../src/models/User");
    const admins = await mailQuery(
        "SELECT username FROM domain_admins ORDER BY username LIMIT 3"
    );
    for (const row of admins.rows) {
        await step(`User.isAdmin(${row.username})`, async () => {
            const info = await User.isAdmin(row.username);
            return `${info.adminType || "not admin"}, domains: ${info.domains.join(", ") || "none"}`;
        });
    }

    console.log("\nApplication database");
    await step("application tables reachable", async () => {
        const r = await query(
            "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema='public'"
        );
        return `${r.rows[0].n} tables`;
    });

    console.log("");
    process.exit(0);
};

run().catch((error) => {
    console.error("\nUnexpected error:", error);
    process.exit(1);
});
