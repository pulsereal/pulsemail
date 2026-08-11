/**
 * Pins the response envelope of every endpoint the admin and settings UI read.
 *
 * The frontend unwraps these by hand and several call sites use an `as` cast,
 * so a mismatch typechecks cleanly and only surfaces as a blank panel at
 * runtime. Asserting the shapes here is what catches that:
 * node scripts/check-envelopes.js
 */
process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.USE_MOCK_DATA = "true";
process.env.JWT_SECRET = process.env.JWT_SECRET || "smoke-secret";

const http = require("http");
const jwt = require("jsonwebtoken");

const app = require("../src/server");

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

// A dotless domain such as `localhost` fails alias address validation
const ALIAS = "envelope-check@acme.test";

const run = async () => {
    await app.initializeDatabase();

    const server = http.createServer(app).listen(0);
    await new Promise((resolve) => server.once("listening", resolve));

    const admin = sign({
        email: "admin@localhost",
        isAdmin: true,
        adminType: "global",
    });
    const user = sign({ email: "test@localhost" });

    const get = async (path, token) =>
        (await request(server, { method: "GET", path, token })).body;

    console.log("\nProvisioning list envelopes");
    const domains = await get("/api/admin/domains", admin);
    check("GET /admin/domains -> { domains }", Array.isArray(domains.domains));

    const mailboxes = await get("/api/admin/mailboxes", admin);
    check(
        "GET /admin/mailboxes -> { mailboxes, total }",
        Array.isArray(mailboxes.mailboxes) && mailboxes.total !== undefined
    );

    const aliases = await get("/api/admin/aliases", admin);
    check("GET /admin/aliases -> { aliases }", Array.isArray(aliases.aliases));

    console.log("\nProvisioning detail envelopes");
    const first = domains.domains[0]?.domain;
    const domainDetail = await get(
        `/api/admin/domains/${encodeURIComponent(first)}`,
        admin
    );
    check(
        "GET /admin/domains/:domain nests under `domain`",
        Boolean(domainDetail.domain?.domain),
        JSON.stringify(Object.keys(domainDetail))
    );
    check(
        "domain detail carries usage, admins, aliasDomains",
        domainDetail.domain?.usage !== undefined &&
            Array.isArray(domainDetail.domain?.admins) &&
            Array.isArray(domainDetail.domain?.aliasDomains)
    );

    const mailboxDetail = await get(
        "/api/admin/mailboxes/test%40localhost",
        admin
    );
    check(
        "GET /admin/mailboxes/:email nests under `mailbox`",
        Boolean(mailboxDetail.mailbox?.email),
        JSON.stringify(Object.keys(mailboxDetail))
    );
    check(
        "mailbox detail carries aliases[] and forwardings{destinations,keepCopy}",
        Array.isArray(mailboxDetail.mailbox?.aliases) &&
            Array.isArray(mailboxDetail.mailbox?.forwardings?.destinations) &&
            typeof mailboxDetail.mailbox?.forwardings?.keepCopy === "boolean"
    );

    console.log("\nMailbox settings envelopes");
    check(
        "GET /mailbox/filters -> { rules }",
        Array.isArray((await get("/api/mailbox/filters", user)).rules)
    );
    check(
        "GET /mailbox/filters/script -> { script }",
        typeof (await get("/api/mailbox/filters/script", user)).script ===
            "string"
    );
    check(
        "GET /mailbox/vacation -> { vacation }",
        (await get("/api/mailbox/vacation", user)).vacation !== undefined
    );
    check(
        "GET /mailbox/forwarding -> { forwarding }",
        (await get("/api/mailbox/forwarding", user)).forwarding !== undefined
    );

    const identities = await get("/api/mailbox/identities", user);
    check(
        "GET /mailbox/identities -> { identities, availableAddresses }",
        Array.isArray(identities.identities) &&
            Array.isArray(identities.availableAddresses)
    );

    console.log("\nAlias create honours `active` in one request");
    await request(server, {
        method: "DELETE",
        path: `/api/admin/aliases/${encodeURIComponent(ALIAS)}`,
        token: admin,
    });

    const created = await request(server, {
        method: "POST",
        path: "/api/admin/aliases",
        token: admin,
        body: {
            address: ALIAS,
            name: "Envelope check",
            members: ["test@localhost"],
            active: false,
        },
    });
    check(
        "POST /admin/aliases -> { alias }",
        Boolean(created.body.alias?.address),
        `status ${created.status}`
    );
    check(
        "alias created disabled without a follow-up update",
        created.body.alias?.active === 0 ||
            created.body.alias?.active === false,
        `active=${created.body.alias?.active}`
    );

    await request(server, {
        method: "DELETE",
        path: `/api/admin/aliases/${encodeURIComponent(ALIAS)}`,
        token: admin,
    });

    server.close();

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
};

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
