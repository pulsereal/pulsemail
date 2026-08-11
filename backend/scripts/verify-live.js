/**
 * Verifies the integrations that mock mode cannot exercise: a real Dovecot over
 * IMAP and ManageSieve, reached through the configured master user, plus the
 * two database connections.
 *
 * Read-only. It opens mailboxes read-only, writes no messages and publishes no
 * Sieve script.
 *
 *   cd /opt/pulsemail-client/backend
 *   node scripts/verify-live.js someone@yourdomain.com
 *
 * With no argument it picks the first active mailbox from the database.
 */

require("dotenv").config();

const imapPool = require("../src/services/ImapConnection");
const { withSieve } = require("../src/services/ManageSieveClient");
const { query, mailQuery, verifyConnections } = require("../src/config/database");

let failures = 0;

const ok = (label, detail) =>
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
const bad = (label, detail) => {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
};

const attempt = async (label, fn) => {
    try {
        ok(label, await fn());
    } catch (error) {
        bad(label, error.message);
    }
};

const run = async () => {
    if (process.env.USE_MOCK_DATA === "true") {
        console.error(
            "USE_MOCK_DATA is set; this script is meant to run against the real server."
        );
        process.exit(1);
    }

    console.log("\nDatabases");
    await attempt("both connections reachable", async () => {
        await verifyConnections();
        return null;
    });

    await attempt("iRedMail vmail readable", async () => {
        const r = await mailQuery("SELECT COUNT(*) AS n FROM mailbox");
        return `${r.rows[0].n} mailboxes`;
    });

    await attempt("application schema present", async () => {
        const r = await query(
            "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema='public'"
        );
        return `${r.rows[0].n} tables`;
    });

    let mailbox = process.argv[2];
    if (!mailbox) {
        const r = await mailQuery(
            "SELECT username FROM mailbox WHERE active=1 ORDER BY username LIMIT 1"
        );
        mailbox = r.rows[0]?.username;
    }

    if (!mailbox) {
        console.error("\nNo mailbox to test against.");
        process.exit(1);
    }

    console.log(`\nIMAP as master, against ${mailbox}`);
    await attempt("master login and folder list", async () => {
        const boxes = await imapPool.withMailbox(mailbox, (client) =>
            client.listBoxes()
        );
        return `${Object.keys(boxes || {}).length} top-level folders`;
    });

    await attempt("INBOX opens and reports counts", async () => {
        const box = await imapPool.withMailbox(mailbox, (client) =>
            client.openBox("INBOX", true)
        );
        return `${box.messages?.total ?? 0} messages, ${box.messages?.unseen ?? 0} unseen`;
    });

    console.log("\nManageSieve as master");
    await attempt("connect and list scripts", async () => {
        const scripts = await withSieve(mailbox, (client) =>
            client.listScripts()
        );
        const names = (scripts || []).map((s) => s.name ?? s).join(", ");
        return names ? `scripts: ${names}` : "no scripts yet, which is expected";
    });

    console.log(
        failures === 0
            ? "\nAll live integrations verified.\n"
            : `\n${failures} check(s) failed. The client will not work correctly until these pass.\n`
    );

    process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
    console.error("\nUnexpected error:", error.message);
    process.exit(1);
});
