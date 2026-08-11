/**
 * End-to-end smoke test for iRedMail provisioning.
 *
 * Exercises the full lifecycle against the in-process Postgres used in mock
 * mode, and asserts that the rows we write match what Postfix and Dovecot
 * actually read: node scripts/smoke-provisioning.js
 */
process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.USE_MOCK_DATA = "true";
process.env.JWT_SECRET = process.env.JWT_SECRET || "smoke-secret";

const http = require("http");
const jwt = require("jsonwebtoken");

const app = require("../src/server");
const { query } = require("../src/config/database");
const { verifyPassword } = require("../src/config/iredmail");

const sign = (payload) =>
    jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1h" });

const request = (server, { method = "GET", path, token, body }) =>
    new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request(
            {
                host: "127.0.0.1",
                port: server.address().port,
                method,
                path,
                headers: {
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    ...(payload
                        ? {
                              "Content-Type": "application/json",
                              "Content-Length": Buffer.byteLength(payload),
                          }
                        : {}),
                },
            },
            (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    let parsed;
                    try {
                        parsed = JSON.parse(data);
                    } catch (error) {
                        parsed = data;
                    }
                    resolve({ status: res.statusCode, body: parsed });
                });
            }
        );
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });

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

const DOMAIN = "smoke.test";
const USER = `alice@${DOMAIN}`;
const ALIAS = `team@${DOMAIN}`;

const run = async () => {
    await app.initializeDatabase();

    const server = http.createServer(app).listen(0);
    await new Promise((resolve) => server.once("listening", resolve));

    const globalAdmin = sign({
        email: "admin@localhost",
        isAdmin: true,
        adminType: "global",
    });
    const domainAdmin = sign({
        email: "ops@acme.test",
        isAdmin: true,
        adminType: "domain",
    });
    const regularUser = sign({ email: "test@localhost" });

    // Leave no residue from a previous run
    await query("DELETE FROM forwardings WHERE domain = $1", [DOMAIN]);
    await query("DELETE FROM mailbox WHERE domain = $1", [DOMAIN]);
    await query("DELETE FROM alias WHERE domain = $1", [DOMAIN]);
    await query("DELETE FROM domain WHERE domain = $1", [DOMAIN]);

    console.log("\nAuthorization");
    const asUser = await request(server, {
        method: "POST",
        path: "/api/admin/domains",
        token: regularUser,
        body: { domain: DOMAIN },
    });
    check("non-admin cannot create a domain", asUser.status === 403, `got ${asUser.status}`);

    const asDomainAdmin = await request(server, {
        method: "POST",
        path: "/api/admin/domains",
        token: domainAdmin,
        body: { domain: DOMAIN },
    });
    check(
        "domain admin cannot create a domain",
        asDomainAdmin.status === 403,
        `got ${asDomainAdmin.status}`
    );

    console.log("\nDomain lifecycle");
    const created = await request(server, {
        method: "POST",
        path: "/api/admin/domains",
        token: globalAdmin,
        body: {
            domain: DOMAIN,
            description: "Smoke test domain",
            maxMailboxes: 10,
            maxQuotaMb: 4096,
            defaultUserQuotaMb: 1024,
        },
    });
    check("global admin creates domain", created.status === 201, JSON.stringify(created.body).slice(0, 200));
    check(
        "default quota stored in iRedMail settings format",
        created.body.domain?.defaultUserQuotaMb === 1024
    );

    const duplicate = await request(server, {
        method: "POST",
        path: "/api/admin/domains",
        token: globalAdmin,
        body: { domain: DOMAIN },
    });
    check("duplicate domain rejected", duplicate.status === 409, `got ${duplicate.status}`);

    const invalid = await request(server, {
        method: "POST",
        path: "/api/admin/domains",
        token: globalAdmin,
        body: { domain: "not a domain" },
    });
    check("invalid domain rejected", invalid.status === 400, `got ${invalid.status}`);

    console.log("\nMailbox provisioning");
    const mailbox = await request(server, {
        method: "POST",
        path: "/api/admin/mailboxes",
        token: globalAdmin,
        body: {
            email: USER,
            password: "SmokeTest123!",
            name: "Alice Smith",
            quotaMb: 2048,
        },
    });
    check("creates mailbox", mailbox.status === 201, JSON.stringify(mailbox.body).slice(0, 200));

    const row = (
        await query("SELECT * FROM mailbox WHERE username = $1", [USER])
    ).rows[0];
    check("mailbox row exists", Boolean(row));
    check("quota stored in megabytes", Number(row?.quota) === 2048, String(row?.quota));
    check(
        "maildir follows the hashed iRedMail layout",
        /^smoke\.test\/a\/l\/i\/alice-\d{4}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\/$/.test(
            row?.maildir || ""
        ),
        row?.maildir
    );
    check(
        "password hashed with a Dovecot scheme",
        (row?.password || "").startsWith("{SSHA512}"),
        (row?.password || "").slice(0, 12)
    );
    check(
        "password verifies",
        await verifyPassword("SmokeTest123!", row?.password || "")
    );
    check(
        "Dovecot service flags default to enabled",
        Number(row?.enableimap) === 1 && Number(row?.enablesmtp) === 1
    );

    const selfForward = (
        await query(
            "SELECT * FROM forwardings WHERE address = $1 AND forwarding = $1",
            [USER]
        )
    ).rows[0];
    check(
        "self-referencing forwardings row written for Postfix",
        Boolean(selfForward) && Number(selfForward.is_forwarding) === 1
    );

    const overQuota = await request(server, {
        method: "POST",
        path: "/api/admin/mailboxes",
        token: globalAdmin,
        body: { email: `bob@${DOMAIN}`, password: "SmokeTest123!", quotaMb: 99999 },
    });
    check("quota above the domain maximum rejected", overQuota.status === 400, `got ${overQuota.status}`);

    const wrongDomain = await request(server, {
        method: "POST",
        path: "/api/admin/mailboxes",
        token: domainAdmin,
        body: { email: USER, password: "SmokeTest123!" },
    });
    check(
        "domain admin blocked outside own domain",
        wrongDomain.status === 403,
        `got ${wrongDomain.status}`
    );

    console.log("\nPassword and quota changes");
    const pwd = await request(server, {
        method: "PUT",
        path: `/api/admin/mailboxes/${USER}/password`,
        token: globalAdmin,
        body: { password: "Rotated456!" },
    });
    check("admin rotates password", pwd.status === 200, JSON.stringify(pwd.body));

    const rotated = (
        await query("SELECT password, passwordlastchange FROM mailbox WHERE username = $1", [USER])
    ).rows[0];
    check("new password verifies", await verifyPassword("Rotated456!", rotated.password));
    check("old password no longer works", !(await verifyPassword("SmokeTest123!", rotated.password)));
    check("passwordlastchange advanced", Boolean(rotated.passwordlastchange));

    const shortPwd = await request(server, {
        method: "PUT",
        path: `/api/admin/mailboxes/${USER}/password`,
        token: globalAdmin,
        body: { password: "short" },
    });
    check("short password rejected", shortPwd.status === 400, `got ${shortPwd.status}`);

    console.log("\nService toggles and suspension");
    const suspended = await request(server, {
        method: "PUT",
        path: `/api/admin/mailboxes/${USER}`,
        token: globalAdmin,
        body: { active: false, services: { imap: false } },
    });
    check("suspends mailbox", suspended.status === 200);

    const flags = (
        await query(
            'SELECT active, enableimap, enableimapsecured, enableimaptls, enablesmtp FROM mailbox WHERE username = $1',
            [USER]
        )
    ).rows[0];
    check("active cleared", Number(flags.active) === 0);
    check(
        "every IMAP column flipped together",
        Number(flags.enableimap) === 0 &&
            Number(flags.enableimapsecured) === 0 &&
            Number(flags.enableimaptls) === 0
    );
    check("unrelated service untouched", Number(flags.enablesmtp) === 1);

    await request(server, {
        method: "PUT",
        path: `/api/admin/mailboxes/${USER}`,
        token: globalAdmin,
        body: { active: true, services: { imap: true } },
    });

    console.log("\nForwarding");
    const forwarded = await request(server, {
        method: "PUT",
        path: `/api/admin/mailboxes/${USER}/forwardings`,
        token: globalAdmin,
        body: { destinations: ["backup@example.com"], keepCopy: true },
    });
    check("sets forwarding", forwarded.status === 200, JSON.stringify(forwarded.body));
    check(
        "keeps the local copy alongside the destination",
        forwarded.body.forwardings?.keepCopy === true &&
            forwarded.body.forwardings?.destinations.includes("backup@example.com")
    );

    const noCopy = await request(server, {
        method: "PUT",
        path: `/api/admin/mailboxes/${USER}/forwardings`,
        token: globalAdmin,
        body: { destinations: [], keepCopy: false },
    });
    check(
        "refuses to drop the local copy with no destination",
        noCopy.status === 400,
        `got ${noCopy.status}`
    );

    console.log("\nPer-account alias addresses");
    const aliasAddrs = await request(server, {
        method: "PUT",
        path: `/api/admin/mailboxes/${USER}/aliases`,
        token: globalAdmin,
        body: { addresses: [`a.smith@${DOMAIN}`] },
    });
    check("adds an alias address", aliasAddrs.status === 200);

    const aliasRow = (
        await query(
            "SELECT * FROM forwardings WHERE address = $1 AND is_alias = 1",
            [`a.smith@${DOMAIN}`]
        )
    ).rows[0];
    check(
        "alias resolves to the mailbox in virtual_alias_maps",
        aliasRow?.forwarding === USER,
        aliasRow?.forwarding
    );

    console.log("\nStandalone aliases");
    const alias = await request(server, {
        method: "POST",
        path: "/api/admin/aliases",
        token: globalAdmin,
        body: { address: ALIAS, name: "Team", members: [USER, "ceo@acme.test"] },
    });
    check("creates alias", alias.status === 201, JSON.stringify(alias.body).slice(0, 200));
    check("stores members", (alias.body.alias?.members || []).length === 2);

    const clash = await request(server, {
        method: "POST",
        path: "/api/admin/aliases",
        token: globalAdmin,
        body: { address: USER },
    });
    check("alias cannot collide with a mailbox", clash.status === 409, `got ${clash.status}`);

    console.log("\nCatch-all");
    const catchAll = await request(server, {
        method: "PUT",
        path: `/api/admin/domains/${DOMAIN}/catch-all`,
        token: globalAdmin,
        body: { destinations: [USER] },
    });
    check("sets catch-all", catchAll.status === 200);

    const catchRow = (
        await query("SELECT * FROM forwardings WHERE address = $1", [DOMAIN])
    ).rows[0];
    check(
        "catch-all keyed on the bare domain, as catchall_maps expects",
        catchRow?.forwarding === USER,
        catchRow?.forwarding
    );

    console.log("\nDomain admins");
    const addAdmin = await request(server, {
        method: "POST",
        path: `/api/admin/domains/${DOMAIN}/admins`,
        token: globalAdmin,
        body: { email: USER },
    });
    check("grants domain admin", addAdmin.status === 201, JSON.stringify(addAdmin.body));

    const detail = await request(server, {
        method: "GET",
        path: `/api/admin/domains/${DOMAIN}`,
        token: globalAdmin,
    });
    check("domain detail loads", detail.status === 200);
    check("reports usage", typeof detail.body.domain?.usage?.mailboxes === "number");
    check("lists the new admin", (detail.body.domain?.admins || []).some((a) => a.email === USER));

    console.log("\nQuota reporting");
    await query(
        `INSERT INTO used_quota (username, bytes, messages, domain)
         VALUES ($1, 524288, 12, $2)
         ON CONFLICT (username) DO UPDATE SET bytes = 524288, messages = 12`,
        [USER, DOMAIN]
    );

    const withUsage = await request(server, {
        method: "GET",
        path: `/api/admin/mailboxes/${USER}`,
        token: globalAdmin,
    });
    check(
        "reads real usage from used_quota",
        withUsage.body.mailbox?.usedBytes === 524288,
        String(withUsage.body.mailbox?.usedBytes)
    );
    check(
        "quota exposed in bytes for the UI",
        withUsage.body.mailbox?.quotaBytes === 2048 * 1048576,
        String(withUsage.body.mailbox?.quotaBytes)
    );

    console.log("\nDeletion");
    const removed = await request(server, {
        method: "DELETE",
        path: `/api/admin/mailboxes/${USER}`,
        token: globalAdmin,
    });
    check("deletes mailbox", removed.status === 200, JSON.stringify(removed.body).slice(0, 200));

    const gone = await query("SELECT * FROM mailbox WHERE username = $1", [USER]);
    check("mailbox row removed", gone.rows.length === 0);

    const orphans = await query(
        "SELECT * FROM forwardings WHERE address = $1 OR forwarding = $1",
        [USER]
    );
    check("no orphaned forwardings left for Postfix", orphans.rows.length === 0, String(orphans.rows.length));

    const tombstone = await query(
        "SELECT * FROM deleted_mailboxes WHERE username = $1",
        [USER]
    );
    check("maildir filed for later removal", tombstone.rows.length === 1);
    check(
        "tombstone records the full maildir path",
        (tombstone.rows[0]?.maildir || "").includes("smoke.test/a/l/i/alice-"),
        tombstone.rows[0]?.maildir
    );

    const selfDelete = await request(server, {
        method: "DELETE",
        path: "/api/admin/mailboxes/admin@localhost",
        token: globalAdmin,
    });
    check("admin cannot delete themselves", selfDelete.status === 400, `got ${selfDelete.status}`);

    console.log("\nDomain removal cascades");
    await request(server, {
        method: "DELETE",
        path: `/api/admin/domains/${DOMAIN}`,
        token: globalAdmin,
    });

    const leftovers = await Promise.all([
        query("SELECT 1 FROM domain WHERE domain = $1", [DOMAIN]),
        query("SELECT 1 FROM alias WHERE domain = $1", [DOMAIN]),
        query("SELECT 1 FROM forwardings WHERE domain = $1", [DOMAIN]),
        query("SELECT 1 FROM domain_admins WHERE domain = $1", [DOMAIN]),
    ]);
    check(
        "domain and all dependent rows removed",
        leftovers.every((result) => result.rows.length === 0),
        leftovers.map((r) => r.rows.length).join(",")
    );

    server.close();
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
};

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
