/**
 * Runs mailbox provisioning against iRedMail's own `vmail` schema rather than
 * our transcription of it: node scripts/check-stock-schema.js
 *
 * fixtures/iredmail-1.7.1.pgsql is samples/iredmail/iredmail.pgsql from the
 * iRedMail 1.7.1 tag, unmodified. Production runs 1.7.1; 1.7.3 added optional
 * profile columns, so the same lifecycle also runs with those present.
 *
 * The other smoke tests use the mock schema in src/config/iredmailSchema.js,
 * so this also fails if that schema gains a column 1.7.1 does not have.
 */
const fs = require("fs");
const path = require("path");
const { PGlite } = require("@electric-sql/pglite");

const STOCK_SCHEMA = fs.readFileSync(
    path.join(__dirname, "fixtures", "iredmail-1.7.1.pgsql"),
    "utf8"
);

const IREDMAIL_1_7_3_COLUMNS = `
ALTER TABLE mailbox
    ADD COLUMN first_name VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN last_name VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN mobile VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN telephone VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN recovery_email VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN birthday DATE NOT NULL DEFAULT '0001-01-01';
ALTER TABLE deleted_mailboxes
    ADD COLUMN bytes INT8 NOT NULL DEFAULT 0,
    ADD COLUMN messages INT8 NOT NULL DEFAULT 0;
`;

const DOMAIN = "stock.test";
const JANE = `jane@${DOMAIN}`;
const BOB = `bob@${DOMAIN}`;

let passed = 0;
let failed = 0;

const check = (label, condition, detail) => {
    if (condition) {
        passed += 1;
        console.log(`  PASS  ${label}`);
    } else {
        failed += 1;
        console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
    }
};

const attempt = async (fn) => {
    try {
        return { value: await fn() };
    } catch (error) {
        return { error };
    }
};

/** A fresh copy of the model whose vmail connection is `db`. */
const loadMailbox = (db) => {
    const run = async (text, params = []) => {
        const result = await db.query(text, params);
        return { rows: result.rows, rowCount: result.affectedRows ?? 0 };
    };

    const databasePath = require.resolve("../src/config/database");
    require.cache[databasePath] = {
        id: databasePath,
        filename: databasePath,
        loaded: true,
        exports: {
            mailQuery: run,
            getMailClient: async () => ({ query: run, release: () => {} }),
        },
    };

    const mailboxPath = require.resolve("../src/models/Mailbox");
    delete require.cache[mailboxPath];
    return require(mailboxPath);
};

const columnsOf = async (db) =>
    new Map(
        (
            await db.query(
                `SELECT table_name, column_name, data_type, is_nullable
                   FROM information_schema.columns
                  WHERE table_schema = 'public'`
            )
        ).rows.map((row) => [`${row.table_name}.${row.column_name}`, row])
    );

const checkMockSchema = async () => {
    console.log("\nMock schema against stock iRedMail 1.7.1");

    const stock = await PGlite.create();
    const mock = await PGlite.create();

    try {
        await stock.exec(STOCK_SCHEMA);
        await mock.exec(require("../src/config/iredmailSchema"));

        const stockColumns = await columnsOf(stock);
        const mockColumns = await columnsOf(mock);

        const missing = [...mockColumns.keys()].filter(
            (key) => !stockColumns.has(key)
        );
        check(
            "every mock column exists in 1.7.1",
            missing.length === 0,
            missing.join(", ")
        );

        const mismatched = [...mockColumns]
            .filter(([key, column]) => {
                const original = stockColumns.get(key);
                return (
                    original &&
                    (original.data_type !== column.data_type ||
                        original.is_nullable !== column.is_nullable)
                );
            })
            .map(([key]) => key);
        check(
            "types and nullability match 1.7.1",
            mismatched.length === 0,
            mismatched.join(", ")
        );
    } finally {
        await stock.close();
        await mock.close();
    }
};

const checkLifecycle = async (label, extraSchema) => {
    console.log(`\nMailbox lifecycle on ${label}`);

    const db = await PGlite.create();
    const hasProfileColumns = Boolean(extraSchema);

    try {
        await db.exec(STOCK_SCHEMA);
        if (extraSchema) await db.exec(extraSchema);
        await db.query(
            "INSERT INTO domain (domain, settings) VALUES ($1, $2)",
            [DOMAIN, "default_user_quota:1024;"]
        );

        const Mailbox = loadMailbox(db);
        const mailboxRow = async (email) =>
            (
                await db.query("SELECT * FROM mailbox WHERE username = $1", [
                    email,
                ])
            ).rows[0];

        const created = await attempt(() =>
            Mailbox.create({
                email: JANE,
                password: "StockSchema123!",
                name: "",
                firstName: "Jane",
                lastName: "Doe",
                department: "Support",
                mobile: "+1 555 0100",
                quotaMb: 512,
                active: true,
            })
        );
        check("creates a mailbox", !created.error, created.error?.message);
        if (created.error) return;

        const jane = await mailboxRow(JANE);
        check(
            "display name built from first and last name",
            jane?.name === "Jane Doe",
            jane?.name
        );
        check("department stored", jane?.department === "Support");
        if (hasProfileColumns) {
            check(
                "first and last name kept in their own columns",
                jane?.first_name === "Jane" && jane?.last_name === "Doe",
                `${jane?.first_name} ${jane?.last_name}`
            );
            check("mobile stored", jane?.mobile === "+1 555 0100");
        }

        const selfForward = (
            await db.query(
                "SELECT * FROM forwardings WHERE address = $1 AND forwarding = $1",
                [JANE]
            )
        ).rows[0];
        check(
            "self-referencing forwardings row written for delivery",
            Number(selfForward?.is_forwarding) === 1 &&
                Number(selfForward?.active) === 1 &&
                selfForward?.domain === DOMAIN &&
                selfForward?.dest_domain === DOMAIN,
            JSON.stringify(selfForward)
        );

        const explicit = await attempt(() =>
            Mailbox.create({
                email: BOB,
                password: "StockSchema123!",
                name: "Robert T.",
                firstName: "Bob",
                lastName: "Tables",
            })
        );
        check(
            "an explicit display name wins over first and last name",
            !explicit.error && (await mailboxRow(BOB))?.name === "Robert T.",
            explicit.error?.message
        );

        const found = await attempt(() => Mailbox.findByEmail(JANE));
        check(
            "reads the mailbox back",
            found.value?.name === "Jane Doe" &&
                found.value?.firstName === (hasProfileColumns ? "Jane" : ""),
            found.error?.message ?? JSON.stringify(found.value)
        );

        const listed = await attempt(() => Mailbox.list({ domains: [DOMAIN] }));
        check(
            "lists the domain's mailboxes",
            listed.value?.total === 2,
            listed.error?.message ?? String(listed.value?.total)
        );

        const updated = await attempt(() =>
            Mailbox.update(JANE, {
                name: "",
                firstName: "Janet",
                lastName: "Doe",
                department: "Operations",
                mobile: "+1 555 0199",
                quotaMb: 1024,
                active: true,
            })
        );
        check("updates the profile", !updated.error, updated.error?.message);
        check(
            "display name rebuilt on update",
            updated.value?.name === "Janet Doe",
            updated.value?.name
        );
        if (hasProfileColumns) {
            check(
                "first name column updated",
                updated.value?.firstName === "Janet" &&
                    updated.value?.mobile === "+1 555 0199"
            );
        }

        const partial = await attempt(() =>
            Mailbox.update(JANE, { department: "Sales" })
        );
        check(
            "an update without a name leaves the display name alone",
            partial.value?.name === "Janet Doe" &&
                partial.value?.department === "Sales",
            partial.error?.message ?? partial.value?.name
        );

        const forwarded = await attempt(() =>
            Mailbox.setForwardings(JANE, ["backup@example.com"], true)
        );
        check(
            "sets forwarding alongside the local copy",
            forwarded.value?.keepCopy === true &&
                forwarded.value?.destinations.includes("backup@example.com"),
            forwarded.error?.message
        );

        await db.query(
            `INSERT INTO used_quota (username, bytes, messages, domain)
             VALUES ($1, 4096, 3, $2)`,
            [JANE, DOMAIN]
        );

        const removed = await attempt(() =>
            Mailbox.remove(JANE, { deletedBy: `admin@${DOMAIN}` })
        );
        check("deletes the mailbox", !removed.error, removed.error?.message);

        const tombstone = (
            await db.query(
                "SELECT * FROM deleted_mailboxes WHERE username = $1",
                [JANE]
            )
        ).rows[0];
        check(
            "maildir filed for later removal",
            tombstone?.admin === `admin@${DOMAIN}` &&
                (tombstone?.maildir || "").includes(`${DOMAIN}/j/a/n/jane-`),
            JSON.stringify(tombstone)
        );
        if (hasProfileColumns) {
            check(
                "tombstone records the mailbox size",
                Number(tombstone?.bytes) === 4096 &&
                    Number(tombstone?.messages) === 3
            );
        }

        const leftovers = await Promise.all([
            db.query("SELECT 1 FROM mailbox WHERE username = $1", [JANE]),
            db.query(
                "SELECT 1 FROM forwardings WHERE address = $1 OR forwarding = $1",
                [JANE]
            ),
            db.query("SELECT 1 FROM used_quota WHERE username = $1", [JANE]),
        ]);
        check(
            "mailbox, forwardings and usage rows removed",
            leftovers.every((result) => result.rows.length === 0),
            leftovers.map((result) => result.rows.length).join(",")
        );
    } finally {
        await db.close();
    }
};

const run = async () => {
    await checkMockSchema();
    await checkLifecycle("stock iRedMail 1.7.1");
    await checkLifecycle(
        "1.7.1 plus the columns 1.7.3 added",
        IREDMAIL_1_7_3_COLUMNS
    );

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
};

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
