/**
 * End-to-end smoke test for the webmail features added on top of the original
 * read/send core: drafts, folder management, flags, spam, attachments, Sieve
 * filters, vacation and identities.
 *
 *   node scripts/smoke-webmail.js
 */
process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.USE_MOCK_DATA = "true";
process.env.JWT_SECRET = process.env.JWT_SECRET || "smoke-secret";

const http = require("http");
const jwt = require("jsonwebtoken");

const app = require("../src/server");
const { generateScript } = require("../src/services/SieveService");

const sign = (payload) =>
    jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1h" });

const request = (server, { method = "GET", path, token, mailbox, body, raw }) =>
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
                const chunks = [];
                res.on("data", (chunk) => chunks.push(chunk));
                res.on("end", () => {
                    const buffer = Buffer.concat(chunks);
                    if (raw) {
                        resolve({
                            status: res.statusCode,
                            headers: res.headers,
                            body: buffer,
                        });
                        return;
                    }
                    let parsed;
                    try {
                        parsed = JSON.parse(buffer.toString("utf8"));
                    } catch (error) {
                        parsed = buffer.toString("utf8");
                    }
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: parsed,
                    });
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

    const user = sign({ email: "test@localhost", name: "Test User" });
    const admin = sign({
        email: "admin@localhost",
        isAdmin: true,
        adminType: "global",
    });

    console.log("\nFlags");
    const star = await request(server, {
        method: "PATCH",
        path: "/api/emails/1/mark",
        token: user,
        body: { action: "flagged", folder: "INBOX" },
    });
    check("can set the star flag", star.status === 200, JSON.stringify(star.body));

    const unstar = await request(server, {
        method: "PATCH",
        path: "/api/emails/1/mark",
        token: user,
        body: { action: "unflagged", folder: "INBOX" },
    });
    check("can clear the star flag", unstar.status === 200);

    const badFlag = await request(server, {
        method: "PATCH",
        path: "/api/emails/1/mark",
        token: user,
        body: { action: "bogus" },
    });
    check("rejects an unknown flag action", badFlag.status === 400, `got ${badFlag.status}`);

    console.log("\nPagination");
    const firstPage = await request(server, {
        path: "/api/emails?folder=INBOX&limit=3&offset=0",
        token: user,
    });
    check("returns a page", firstPage.status === 200);
    check(
        "page respects the limit",
        (firstPage.body.emails || []).length <= 3,
        String((firstPage.body.emails || []).length)
    );
    check(
        "total counts the whole folder, not the page",
        firstPage.body.pagination?.total > (firstPage.body.emails || []).length,
        JSON.stringify(firstPage.body.pagination)
    );
    check(
        "total is flagged exact when unfiltered",
        firstPage.body.pagination?.exact === true
    );

    const secondPage = await request(server, {
        path: "/api/emails?folder=INBOX&limit=3&offset=3",
        token: user,
    });
    const firstUids = new Set(
        (firstPage.body.emails || []).map((e) => e.uid)
    );
    check(
        "the next page holds different messages",
        (secondPage.body.emails || []).every((e) => !firstUids.has(e.uid)),
        JSON.stringify((secondPage.body.emails || []).map((e) => e.uid))
    );

    const filteredPage = await request(server, {
        path: "/api/emails?folder=INBOX&unread_only=true",
        token: user,
    });
    check(
        "a filtered listing does not claim an exact total",
        filteredPage.body.pagination?.exact === false,
        JSON.stringify(filteredPage.body.pagination)
    );

    console.log("\nDrafts");
    const draft = await request(server, {
        method: "POST",
        path: "/api/emails/drafts",
        token: user,
        body: {
            to: "someone@example.com",
            subject: "Draft subject",
            content: "<p>Work in progress</p>",
        },
    });
    check("saves a draft", draft.status === 200, JSON.stringify(draft.body).slice(0, 160));
    check("lands in the Drafts folder", draft.body.folder === "Drafts", draft.body.folder);

    const drafts = await request(server, {
        path: "/api/emails?folder=Drafts",
        token: user,
    });
    check(
        "draft is listed",
        (drafts.body.emails || []).some((e) => e.subject === "Draft subject"),
        String((drafts.body.emails || []).length)
    );

    console.log("\nFolder management");
    const created = await request(server, {
        method: "POST",
        path: "/api/emails/folders",
        token: user,
        body: { name: "Projects" },
    });
    check("creates a folder", created.status === 201, JSON.stringify(created.body));

    const folders = await request(server, {
        path: "/api/emails/folders/list",
        token: user,
    });
    check(
        "new folder appears in the list",
        (folders.body.folders || []).some((f) => f.name === "Projects")
    );

    const renamed = await request(server, {
        method: "PUT",
        path: "/api/emails/folders/Projects",
        token: user,
        body: { newName: "Clients" },
    });
    check("renames a folder", renamed.status === 200, JSON.stringify(renamed.body));

    const systemFolder = await request(server, {
        method: "DELETE",
        path: "/api/emails/folders/INBOX",
        token: user,
    });
    check(
        "refuses to delete a system folder",
        systemFolder.status === 400,
        `got ${systemFolder.status}`
    );

    const deleted = await request(server, {
        method: "DELETE",
        path: "/api/emails/folders/Clients",
        token: user,
    });
    check("deletes a user folder", deleted.status === 200);

    console.log("\nMove between folders");
    const moved = await request(server, {
        method: "PATCH",
        path: "/api/emails/3/move",
        token: user,
        body: { target_folder: "Archive", source_folder: "INBOX" },
    });
    check("moves a message", moved.status === 200, JSON.stringify(moved.body));

    const archive = await request(server, {
        path: "/api/emails?folder=Archive",
        token: user,
    });
    check(
        "the message is in the target folder",
        (archive.body.emails || []).some((e) => e.uid === "3"),
        JSON.stringify((archive.body.emails || []).map((e) => e.uid))
    );

    const moveNowhere = await request(server, {
        method: "PATCH",
        path: "/api/emails/3/move",
        token: user,
        body: { source_folder: "Archive" },
    });
    check(
        "rejects a move without a target",
        moveNowhere.status === 400,
        `got ${moveNowhere.status}`
    );

    console.log("\nDelete moves to Trash");
    const trashed = await request(server, {
        method: "DELETE",
        path: "/api/emails/12?folder=INBOX",
        token: user,
    });
    check("delete succeeds", trashed.status === 200, JSON.stringify(trashed.body));
    check("moved rather than expunged", trashed.body.expunged === false);
    check("target is Trash", trashed.body.movedTo === "Trash", trashed.body.movedTo);

    const purged = await request(server, {
        method: "DELETE",
        path: "/api/emails/12?folder=Trash",
        token: user,
    });
    check("deleting from Trash expunges", purged.body.expunged === true);

    console.log("\nSpam");
    const spam = await request(server, {
        method: "PATCH",
        path: "/api/emails/7/spam",
        token: user,
        body: { folder: "INBOX", spam: true },
    });
    check("reports spam", spam.status === 200, JSON.stringify(spam.body));
    check("moves to Junk", spam.body.target === "Junk", spam.body.target);

    console.log("\nMessage source and attachments");
    const source = await request(server, {
        path: "/api/emails/1/source?folder=INBOX",
        token: user,
        raw: true,
    });
    check("returns raw source", source.status === 200);
    check(
        "source contains headers",
        source.body.toString("utf8").includes("Subject:"),
        source.body.toString("utf8").slice(0, 60)
    );

    const eml = await request(server, {
        path: "/api/emails/1/source?folder=INBOX&download=true",
        token: user,
        raw: true,
    });
    check(
        "exports as .eml",
        (eml.headers["content-disposition"] || "").includes("message-1.eml"),
        eml.headers["content-disposition"]
    );

    const missing = await request(server, {
        path: "/api/emails/1/attachments/0?folder=INBOX",
        token: user,
    });
    check(
        "404 when the message has no attachment",
        missing.status === 404,
        `got ${missing.status}`
    );

    console.log("\nSieve filters");
    const filter = await request(server, {
        method: "POST",
        path: "/api/mailbox/filters",
        token: user,
        body: {
            name: "Newsletters to a folder",
            match: "any",
            conditions: [
                { field: "from", match: "contains", value: "newsletter@" },
                { field: "subject", match: "contains", value: "Weekly" },
            ],
            actions: [{ type: "fileinto", folder: "Newsletters" }],
        },
    });
    check("creates a filter", filter.status === 201, JSON.stringify(filter.body).slice(0, 200));
    check("filter is returned", (filter.body.rules || []).length === 1);

    const script = await request(server, {
        path: "/api/mailbox/filters/script",
        token: user,
    });
    check("generates a sieve script", script.status === 200);
    check(
        "requires the fileinto extension",
        (script.body.script || "").includes('require ["fileinto"'),
        (script.body.script || "").split("\n")[1]
    );
    check(
        "uses anyof for an any-match rule",
        (script.body.script || "").includes("anyof (")
    );
    check(
        "files into the target folder",
        (script.body.script || "").includes('fileinto :create "Newsletters";')
    );

    const ruleId = filter.body.rules[0].id;
    const removed = await request(server, {
        method: "DELETE",
        path: `/api/mailbox/filters/${ruleId}`,
        token: user,
    });
    check("deletes a filter", removed.status === 200 && removed.body.rules.length === 0);

    console.log("\nSieve generation details");
    const vacationScript = generateScript(
        [],
        {
            enabled: true,
            subject: "Away",
            body: "Back Monday",
            startDate: "2026-08-01",
            endDate: "2026-08-14",
            intervalDays: 3,
        }
    );
    check("vacation requires the vacation extension", vacationScript.includes('"vacation"'));
    check("vacation is date-guarded", vacationScript.includes("currentdate"));
    check("vacation interval honoured", vacationScript.includes(":days 3"));

    const escaped = generateScript([
        {
            name: "quote test",
            match: "all",
            conditions: [{ field: "subject", match: "is", value: 'say "hi"' }],
            actions: [{ type: "discard" }],
        },
    ]);
    check(
        "quotes in rule values are escaped",
        escaped.includes('\\"hi\\"'),
        escaped.split("\n").find((line) => line.includes("header"))
    );

    console.log("\nVacation settings");
    const vacation = await request(server, {
        method: "PUT",
        path: "/api/mailbox/vacation",
        token: user,
        body: {
            enabled: true,
            subject: "On leave",
            body: "Back on the 20th",
            intervalDays: 5,
        },
    });
    check("saves vacation settings", vacation.status === 200, JSON.stringify(vacation.body).slice(0, 200));
    check("reports it was not published in mock mode", vacation.body.published === false);

    const readBack = await request(server, {
        path: "/api/mailbox/vacation",
        token: user,
    });
    check(
        "vacation persists",
        readBack.body.vacation?.enabled === true &&
            readBack.body.vacation?.subject === "On leave"
    );

    console.log("\nIdentities");
    const identities = await request(server, {
        path: "/api/mailbox/identities",
        token: user,
    });
    check("lists available send-as addresses", identities.status === 200);
    check(
        "own address is offered",
        (identities.body.availableAddresses || []).includes("test@localhost"),
        JSON.stringify(identities.body.availableAddresses)
    );

    const signature = await request(server, {
        method: "PUT",
        path: "/api/mailbox/identities",
        token: user,
        body: {
            fromAddress: "test@localhost",
            displayName: "Test User",
            signature: "<p>Regards,<br>Test</p>",
            isDefault: true,
        },
    });
    check("saves a signature", signature.status === 200, JSON.stringify(signature.body));

    const spoof = await request(server, {
        method: "PUT",
        path: "/api/mailbox/identities",
        token: user,
        body: { fromAddress: "ceo@acme.test", signature: "nope" },
    });
    check(
        "cannot claim an address that is not theirs",
        spoof.status === 403,
        `got ${spoof.status}`
    );

    console.log("\nAdmin acts on another mailbox");
    const adminFilters = await request(server, {
        path: "/api/mailbox/filters",
        token: admin,
        mailbox: "sarah@localhost",
    });
    check(
        "admin reads another mailbox's filters",
        adminFilters.status === 200 && adminFilters.body.mailbox === "sarah@localhost",
        `got ${adminFilters.status}`
    );

    const userSnoop = await request(server, {
        path: "/api/mailbox/filters",
        token: user,
        mailbox: "sarah@localhost",
    });
    check("non-admin cannot", userSnoop.status === 403, `got ${userSnoop.status}`);

    console.log("\nSelf-service password change");
    const wrongCurrent = await request(server, {
        method: "POST",
        path: "/api/auth/change-password",
        token: user,
        body: { currentPassword: "wrong", newPassword: "NewPassword123" },
    });
    check("rejects a wrong current password", wrongCurrent.status === 401, `got ${wrongCurrent.status}`);

    const changed = await request(server, {
        method: "POST",
        path: "/api/auth/change-password",
        token: user,
        body: { currentPassword: "test", newPassword: "NewPassword123" },
    });
    check("changes the password", changed.status === 200, JSON.stringify(changed.body));

    // Put it back so repeat runs behave the same
    await request(server, {
        method: "POST",
        path: "/api/auth/change-password",
        token: user,
        body: { currentPassword: "NewPassword123", newPassword: "test" },
    });

    console.log("\nQuota");
    const quota = await request(server, {
        path: "/api/auth/quota",
        token: user,
    });
    check("reports quota", quota.status === 200);
    check(
        "total comes from mailbox.quota in bytes",
        quota.body.quota?.total === 2048 * 1048576,
        String(quota.body.quota?.total)
    );
    check(
        "usage comes from used_quota",
        quota.body.quota?.used > 0 && quota.body.quota?.tracked === true,
        JSON.stringify(quota.body.quota)
    );

    server.close();
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
};

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
