/**
 * End-to-end smoke test for mailbox scoping and the unified admin inbox.
 * Runs against mock data: node scripts/smoke-admin.js
 */
process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.USE_MOCK_DATA = "true";
process.env.JWT_SECRET = process.env.JWT_SECRET || "smoke-secret";

const http = require("http");
const jwt = require("jsonwebtoken");

const app = require("../src/server");

const sign = (payload) =>
    jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1h" });

const request = (server, { method = "GET", path, token, mailbox, body }) =>
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
                    ...(mailbox ? { "X-Mailbox": mailbox } : {}),
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

const run = async () => {
    await app.initializeDatabase();

    const server = http.createServer(app).listen(0);
    await new Promise((resolve) => server.once("listening", resolve));

    const globalAdmin = sign({
        email: "admin@localhost",
        name: "Admin User",
        isAdmin: true,
        adminType: "global",
    });
    const domainAdmin = sign({
        email: "ops@acme.test",
        name: "Acme Operations",
        isAdmin: true,
        adminType: "domain",
    });
    const regularUser = sign({ email: "test@localhost", name: "Test User" });

    console.log("\nOwn-mailbox access");
    const own = await request(server, {
        server,
        path: "/api/emails?folder=INBOX&limit=50",
        token: regularUser,
    });
    check("user reads own inbox", own.status === 200, JSON.stringify(own.body).slice(0, 160));
    check(
        "scoped to own address",
        own.body.mailbox === "test@localhost" && own.body.impersonating === false
    );
    check("returns messages", (own.body.emails || []).length > 0);

    console.log("\nNon-admin cannot target another mailbox");
    const denied = await request(server, {
        path: "/api/emails",
        token: regularUser,
        mailbox: "sarah@localhost",
    });
    check("403 for non-admin X-Mailbox", denied.status === 403, `got ${denied.status}`);

    console.log("\nGlobal admin impersonation");
    const impersonated = await request(server, {
        path: "/api/emails?folder=INBOX",
        token: globalAdmin,
        mailbox: "sarah@localhost",
    });
    check("200 for global admin", impersonated.status === 200, `got ${impersonated.status}`);
    check(
        "scoped to target mailbox",
        impersonated.body.mailbox === "sarah@localhost" &&
            impersonated.body.impersonating === true
    );
    check(
        "returns target's mail",
        (impersonated.body.emails || []).every(
            (email) => email.mailbox === "sarah@localhost"
        ) && impersonated.body.emails.length > 0
    );

    console.log("\nDomain admin scoping");
    const crossDomain = await request(server, {
        path: "/api/emails",
        token: domainAdmin,
        mailbox: "sarah@localhost",
    });
    check(
        "acme.test admin blocked from localhost mailbox",
        crossDomain.status === 403,
        `got ${crossDomain.status}`
    );

    const sameDomain = await request(server, {
        path: "/api/emails",
        token: domainAdmin,
        mailbox: "ceo@acme.test",
    });
    check(
        "acme.test admin allowed inside own domain",
        sameDomain.status === 200 && sameDomain.body.mailbox === "ceo@acme.test",
        `got ${sameDomain.status}`
    );

    console.log("\nUnified inbox");
    const unified = await request(server, {
        path: "/api/admin/unified/emails?limit=10",
        token: globalAdmin,
    });
    check("200 for global admin", unified.status === 200, JSON.stringify(unified.body).slice(0, 160));
    const boxes = new Set((unified.body.emails || []).map((e) => e.mailbox));
    check("merges multiple mailboxes", boxes.size >= 4, `saw ${boxes.size}`);
    check(
        "every message is tagged",
        (unified.body.emails || []).every((e) => e.mailbox && e.mailboxName)
    );
    const dates = (unified.body.emails || []).map((e) => Date.parse(e.date));
    check(
        "sorted newest first",
        dates.every((value, index) => index === 0 || dates[index - 1] >= value)
    );
    check("no per-mailbox errors", (unified.body.errors || []).length === 0, JSON.stringify(unified.body.errors));

    const unifiedDomain = await request(server, {
        path: "/api/admin/unified/emails?limit=10",
        token: domainAdmin,
    });
    const domainBoxes = new Set(
        (unifiedDomain.body.emails || []).map((e) => e.mailbox)
    );
    check(
        "domain admin only sees own domain",
        [...domainBoxes].every((box) => box.endsWith("@acme.test")) &&
            domainBoxes.size > 0,
        [...domainBoxes].join(",")
    );

    const unifiedForbidden = await request(server, {
        path: "/api/admin/unified/emails",
        token: regularUser,
    });
    check("non-admin blocked", unifiedForbidden.status === 403, `got ${unifiedForbidden.status}`);

    console.log("\nUnified stats");
    const stats = await request(server, {
        path: "/api/admin/unified/stats",
        token: globalAdmin,
    });
    check("200", stats.status === 200);
    check("reports unread totals", typeof stats.body.totalUnread === "number" && stats.body.totalUnread > 0, String(stats.body.totalUnread));

    console.log("\nAudit trail");
    const log = await request(server, {
        path: "/api/admin/access-log",
        token: globalAdmin,
    });
    check("200", log.status === 200);
    check("recorded cross-mailbox access", (log.body.history || []).length > 0, String((log.body.history || []).length));

    console.log("\nFolders");
    const folders = await request(server, {
        path: "/api/emails/folders/list",
        token: globalAdmin,
        mailbox: "ceo@acme.test",
    });
    check("200", folders.status === 200);
    check(
        "normalized folder shape",
        (folders.body.folders || []).every(
            (f) => "path" in f && "specialUse" in f && "children" in f
        ) && folders.body.folders.length > 0
    );

    console.log("\nSearch");
    const search = await request(server, {
        method: "POST",
        path: "/api/emails/search",
        token: globalAdmin,
        mailbox: "support@localhost",
        body: { query: "ticket", folder: "INBOX" },
    });
    check("200", search.status === 200, JSON.stringify(search.body).slice(0, 160));
    check("finds matching mail", (search.body.emails || []).length > 0);

    server.close();
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
};

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
