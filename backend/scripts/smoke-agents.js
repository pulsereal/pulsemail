/**
 * Exercises agent webhooks and the agent API end to end in mock mode.
 *
 * A local HTTP server stands in for the agent, so the real signing, delivery,
 * retry and scope paths run without network access:
 *   node scripts/smoke-agents.js
 *
 * Mock mail fixtures touched along the way are restored on exit.
 */
process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.USE_MOCK_DATA = "true";
process.env.JWT_SECRET = process.env.JWT_SECRET || "smoke-secret";

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const app = require("../src/server");
const { query, mailQuery } = require("../src/config/database");
const { mailService } = require("../src/services/MailService");
const AgentService = require("../src/services/AgentService");
const AgentMailWatcher = require("../src/services/AgentMailWatcher");
const WebhookDispatcher = require("../src/services/WebhookDispatcher");

const DATA_DIR = path.join(__dirname, "../data");
const FIXTURES = ["emails.json", "sent_emails.json", "folders.json"];
const NAME_PREFIX = "smoke-agent-";
const HIRE = "agent-hire@acme.test";
const SMOKE_DOMAIN = "agents-smoke.test";

const sign = (payload) =>
    jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1h" });

const request = (server, { method = "GET", path: url, token, body }) =>
    new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request(
            {
                host: "127.0.0.1",
                port: server.address().port,
                method,
                path: url,
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
                    } catch {
                        parsed = data;
                    }
                    console.log(`${method} ${url} - ${res.statusCode}`);
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

/** Records every webhook call; `respondWith` queues status codes to return. */
const startStubAgent = async () => {
    const state = { calls: [], respondWith: [] };

    const server = http.createServer((req, res) => {
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
            state.calls.push({
                headers: req.headers,
                raw,
                body: JSON.parse(raw),
            });
            const status = state.respondWith.shift() || 200;
            res.writeHead(status, { "Content-Type": "text/plain" });
            res.end(status === 200 ? "ok" : "stub failure");
        });
    });

    server.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));

    return {
        state,
        url: `http://127.0.0.1:${server.address().port}/hooks/pulsemail`,
        close: () => server.close(),
    };
};

const verifySignature = (call, secret) => {
    const timestamp = call.headers["x-pulsemail-timestamp"];
    const expected = crypto
        .createHmac("sha256", secret)
        .update(`${timestamp}.${call.raw}`)
        .digest("hex");
    return call.headers["x-pulsemail-signature"] === `sha256=${expected}`;
};

const deliverMail = (to, subject) => {
    const emails = mailService.mockData.readData("emails.json");
    const uid = String(
        emails.reduce(
            (max, email) => Math.max(max, Number(email.uid) || 0),
            0
        ) + 1
    );
    emails.push({
        uid,
        from: "customer@example.com",
        to,
        subject,
        date: new Date().toISOString(),
        messageId: `<smoke-${uid}@example.com>`,
        flags: [],
        size: 512,
        category: "primary",
        folder: "INBOX",
        content: `<p>${subject}</p>`,
    });
    mailService.mockData.writeData("emails.json", emails);
    return uid;
};

const run = async () => {
    await app.initializeDatabase();

    const agents = AgentService.shared();
    const watcher = AgentMailWatcher.shared();
    const dispatcher = WebhookDispatcher.shared();

    // Mock UIDs are reused once the fixtures are restored, so a cursor left by
    // an earlier run would sit above the mail this run delivers.
    await query("DELETE FROM agents WHERE name LIKE $1", [`${NAME_PREFIX}%`]);
    await query("DELETE FROM agent_mail_cursors WHERE mailbox = $1", [
        "ceo@acme.test",
    ]);
    agents.invalidate();

    const server = http.createServer(app).listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const stub = await startStubAgent();

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
    const user = sign({ email: "test@localhost" });
    const ceo = sign({ email: "ceo@acme.test" });

    // Leftovers from an interrupted run would turn the creates below into 409s.
    await mailQuery("DELETE FROM mailbox WHERE username = $1", [HIRE]);
    await mailQuery("DELETE FROM forwardings WHERE address = $1", [HIRE]);
    await mailQuery("DELETE FROM domain WHERE domain = $1", [SMOKE_DOMAIN]);
    await mailQuery(
        "DELETE FROM domain_admins WHERE username = $1 AND domain = $2",
        ["sarah@localhost", "localhost"]
    );

    try {
        console.log("\nAccess control");
        const denied = await request(server, {
            path: "/api/admin/agents",
            token: user,
        });
        check("a normal user cannot manage agents", denied.status === 403);

        console.log("\nScope rules for domain admins");
        const allDenied = await request(server, {
            method: "POST",
            path: "/api/admin/agents",
            token: domainAdmin,
            body: {
                name: `${NAME_PREFIX}all`,
                scopeAll: true,
                permissions: ["read"],
            },
        });
        check(
            "a domain admin cannot grant every mailbox",
            allDenied.status === 403
        );

        const domainDenied = await request(server, {
            method: "POST",
            path: "/api/admin/agents",
            token: domainAdmin,
            body: {
                name: `${NAME_PREFIX}x`,
                domains: ["localhost"],
                permissions: ["read"],
            },
        });
        check(
            "a domain admin cannot grant another domain",
            domainDenied.status === 403
        );

        const mailboxDenied = await request(server, {
            method: "POST",
            path: "/api/admin/agents",
            token: domainAdmin,
            body: {
                name: `${NAME_PREFIX}x`,
                mailboxes: ["test@localhost"],
                permissions: ["read"],
            },
        });
        check(
            "a domain admin cannot grant a mailbox in another domain",
            mailboxDenied.status === 403
        );

        console.log("\nWebhook URL safety");
        process.env.AGENT_WEBHOOK_ALLOW_PRIVATE = "false";
        const privateDenied = await request(server, {
            method: "POST",
            path: "/api/admin/agents",
            token: globalAdmin,
            body: {
                name: `${NAME_PREFIX}private`,
                webhookUrl: stub.url,
                events: ["email.received"],
                domains: ["acme.test"],
            },
        });
        check(
            "a loopback webhook URL is rejected",
            privateDenied.status === 400
        );

        const noUrl = await request(server, {
            method: "POST",
            path: "/api/admin/agents",
            token: globalAdmin,
            body: {
                name: `${NAME_PREFIX}nourl`,
                events: ["email.received"],
                domains: ["acme.test"],
            },
        });
        check(
            "events without a webhook URL are rejected",
            noUrl.status === 400
        );
        process.env.AGENT_WEBHOOK_ALLOW_PRIVATE = "true";

        console.log("\nCreating agents");
        const createdA = await request(server, {
            method: "POST",
            path: "/api/admin/agents",
            token: domainAdmin,
            body: {
                name: `${NAME_PREFIX}acme`,
                webhookUrl: stub.url,
                events: ["email.received", "email.sent"],
                permissions: ["read"],
                domains: ["acme.test"],
            },
        });
        check(
            "a domain admin creates an agent for their domain",
            createdA.status === 201,
            JSON.stringify(createdA.body)
        );
        check(
            "the API key and signing secret are returned once",
            createdA.body.apiKey?.startsWith("pm_agent_") &&
                createdA.body.signingSecret?.startsWith("whsec_")
        );
        check(
            "the stored agent never echoes its secrets",
            !JSON.stringify(createdA.body.agent).includes(
                createdA.body.apiKey
            ) &&
                !JSON.stringify(createdA.body.agent).includes(
                    createdA.body.signingSecret
                )
        );

        const agentA = createdA.body.agent;
        let keyA = createdA.body.apiKey;
        const secretA = createdA.body.signingSecret;

        const createdB = await request(server, {
            method: "POST",
            path: "/api/admin/agents",
            token: globalAdmin,
            body: {
                name: `${NAME_PREFIX}everything`,
                scopeAll: true,
                permissions: ["read", "send", "modify"],
            },
        });
        check(
            "a global admin creates an all-mailbox agent",
            createdB.status === 201,
            JSON.stringify(createdB.body)
        );
        const agentB = createdB.body.agent;
        const keyB = createdB.body.apiKey;

        const domainList = await request(server, {
            path: "/api/admin/agents",
            token: domainAdmin,
        });
        const domainIds = (domainList.body.agents || []).map(
            (agent) => agent.id
        );
        check(
            "a domain admin only sees agents inside their domains",
            domainIds.includes(agentA.id) && !domainIds.includes(agentB.id)
        );

        const hidden = await request(server, {
            path: `/api/admin/agents/${agentB.id}`,
            token: domainAdmin,
        });
        check(
            "other agents are not disclosed to a domain admin",
            hidden.status === 404
        );

        const widen = await request(server, {
            method: "PUT",
            path: `/api/admin/agents/${agentA.id}`,
            token: domainAdmin,
            body: { mailboxes: ["test@localhost"] },
        });
        check(
            "a domain admin cannot widen an agent beyond their domains",
            widen.status === 403
        );

        console.log("\nNew mail becomes a signed webhook");
        const watched = await agents.watchedMailboxes("email.received");
        check(
            "only mailboxes in a webhook agent's scope are watched",
            watched.includes("ceo@acme.test") &&
                !watched.includes("test@localhost"),
            JSON.stringify(watched)
        );

        const primed = await watcher.runCycle({ mailboxes: ["ceo@acme.test"] });
        check(
            "the first pass only records a starting point",
            primed.queued === 0,
            JSON.stringify(primed)
        );

        const uid = deliverMail("ceo@acme.test", "Smoke: quarterly invoice");
        const cycle = await watcher.runCycle({ mailboxes: ["ceo@acme.test"] });
        check(
            "new mail is queued for the agent",
            cycle.queued === 1,
            JSON.stringify(cycle)
        );

        await dispatcher.drain();
        const call = stub.state.calls.at(-1);
        check(
            "the webhook is called",
            call?.body?.event === "email.received",
            JSON.stringify(call?.body?.event)
        );
        check(
            "the signature verifies with the issued secret",
            call && verifySignature(call, secretA)
        );
        check(
            "the payload carries the message",
            call?.body?.mailbox === "ceo@acme.test" &&
                call?.body?.email?.uid === uid &&
                call?.body?.email?.subject === "Smoke: quarterly invoice" &&
                call?.body?.email?.from?.address === "customer@example.com"
        );

        const again = await watcher.runCycle({ mailboxes: ["ceo@acme.test"] });
        check("the same mail is not delivered twice", again.queued === 0);

        console.log("\nFailed deliveries are retried");
        stub.state.respondWith.push(500);
        deliverMail("ceo@acme.test", "Smoke: retry me");
        await watcher.runCycle({ mailboxes: ["ceo@acme.test"] });
        await dispatcher.drain();

        const pending = await query(
            `SELECT * FROM agent_deliveries WHERE agent_id = $1 ORDER BY id DESC LIMIT 1`,
            [agentA.id]
        );
        check(
            "a 500 leaves the delivery pending with a backoff",
            pending.rows[0]?.status === "pending" &&
                pending.rows[0]?.attempts === 1 &&
                pending.rows[0]?.last_status_code === 500,
            JSON.stringify(
                pending.rows[0] && {
                    status: pending.rows[0].status,
                    attempts: pending.rows[0].attempts,
                    code: pending.rows[0].last_status_code,
                }
            )
        );

        await query(
            "UPDATE agent_deliveries SET next_attempt_at = NOW() WHERE id = $1",
            [pending.rows[0].id]
        );
        await dispatcher.drain();
        const retried = await query(
            "SELECT * FROM agent_deliveries WHERE id = $1",
            [pending.rows[0].id]
        );
        check(
            "the retry succeeds once the endpoint recovers",
            retried.rows[0]?.status === "delivered" &&
                retried.rows[0]?.attempts === 2
        );

        const log = await request(server, {
            path: `/api/admin/agents/${agentA.id}/deliveries`,
            token: domainAdmin,
        });
        check(
            "the delivery log is visible to the admin",
            (log.body.deliveries || []).length >= 2
        );

        const ping = await request(server, {
            method: "POST",
            path: `/api/admin/agents/${agentA.id}/test`,
            token: domainAdmin,
        });
        check(
            "a test ping reaches the endpoint",
            ping.body.result?.ok === true &&
                stub.state.calls.at(-1)?.body?.event === "ping"
        );

        console.log("\nAgent API: scope and permissions");
        const me = await request(server, {
            path: "/api/agent/me",
            token: keyA,
        });
        check(
            "the agent key authenticates",
            me.status === 200 && me.body.agent?.id === agentA.id
        );

        const bogus = await request(server, {
            path: "/api/agent/me",
            token: "pm_agent_nope",
        });
        check("an unknown key is refused", bogus.status === 401);

        const jwtRefused = await request(server, {
            path: "/api/agent/me",
            token: user,
        });
        check("a user session is not an agent key", jwtRefused.status === 401);

        const mailboxes = await request(server, {
            path: "/api/agent/mailboxes",
            token: keyA,
        });
        const addresses = (mailboxes.body.mailboxes || []).map(
            (row) => row.address
        );
        check(
            "the agent lists only its mailboxes",
            addresses.includes("ceo@acme.test") &&
                !addresses.includes("test@localhost"),
            JSON.stringify(addresses)
        );

        const listing = await request(server, {
            path: "/api/agent/mailboxes/ceo@acme.test/emails?limit=10",
            token: keyA,
        });
        check(
            "the agent lists mail in scope",
            listing.status === 200 && listing.body.emails?.length > 0
        );

        const message = await request(server, {
            path: `/api/agent/mailboxes/ceo@acme.test/emails/${uid}`,
            token: keyA,
        });
        check(
            "the agent reads a message in scope",
            message.status === 200 &&
                message.body.email?.subject === "Smoke: quarterly invoice"
        );

        const outside = await request(server, {
            path: "/api/agent/mailboxes/test@localhost/emails",
            token: keyA,
        });
        check("a mailbox outside the scope is refused", outside.status === 403);

        const noSend = await request(server, {
            method: "POST",
            path: "/api/agent/mailboxes/ceo@acme.test/send",
            token: keyA,
            body: { to: "someone@example.com", subject: "Nope", text: "Nope" },
        });
        check("sending requires the send permission", noSend.status === 403);

        console.log("\nAgent API: sending");
        const callsBefore = stub.state.calls.length;
        const sent = await request(server, {
            method: "POST",
            path: "/api/agent/mailboxes/ceo@acme.test/send",
            token: keyB,
            body: {
                to: ["partner@example.com"],
                subject: "From the agent",
                text: "Hello",
            },
        });
        check(
            "an agent with send permission sends",
            sent.status === 201,
            JSON.stringify(sent.body)
        );

        const invalid = await request(server, {
            method: "POST",
            path: "/api/agent/mailboxes/ceo@acme.test/send",
            token: keyB,
            body: { to: ["not-an-address"], subject: "x", text: "x" },
        });
        check("invalid recipients are rejected", invalid.status === 400);

        const reply = await request(server, {
            method: "POST",
            path: `/api/agent/mailboxes/ceo@acme.test/emails/${uid}/reply`,
            token: keyB,
            body: { text: "Thanks, paid." },
        });
        check(
            "a reply goes to the original sender in thread",
            reply.status === 201 &&
                reply.body.to?.[0] === "customer@example.com" &&
                reply.body.subject === "Re: Smoke: quarterly invoice",
            JSON.stringify(reply.body)
        );

        const webmail = await request(server, {
            method: "POST",
            path: "/api/emails/send",
            token: ceo,
            body: {
                to: "vendor@example.com",
                subject: "From webmail",
                content: "<p>Hi</p>",
            },
        });
        check("webmail send still works", webmail.status === 200);

        await dispatcher.drain();
        const sentEvents = stub.state.calls
            .slice(callsBefore)
            .filter((entry) => entry.body.event === "email.sent");
        check(
            "email.sent reaches agents covering the sending mailbox",
            sentEvents.length === 3 &&
                sentEvents.some((entry) => entry.body.via === "agent") &&
                sentEvents.some((entry) => entry.body.via === "webmail"),
            JSON.stringify(sentEvents.map((entry) => entry.body.via))
        );

        const otherDomain = await request(server, {
            method: "POST",
            path: "/api/agent/mailboxes/test@localhost/send",
            token: keyB,
            body: { to: "x@example.com", subject: "Elsewhere", text: "x" },
        });
        await dispatcher.drain();
        check(
            "mail sent outside an agent's scope is not delivered to it",
            otherDomain.status === 201 &&
                !stub.state.calls.some(
                    (entry) => entry.body.email?.subject === "Elsewhere"
                )
        );

        console.log("\nAgent API: managing mail");
        const folder = await request(server, {
            method: "POST",
            path: "/api/agent/mailboxes/ceo@acme.test/folders",
            token: keyB,
            body: { name: "Agent Smoke" },
        });
        check("an agent creates a folder", folder.status === 201);

        const systemFolder = await request(server, {
            method: "DELETE",
            path: "/api/agent/mailboxes/ceo@acme.test/folders/INBOX",
            token: keyB,
        });
        check("system folders cannot be deleted", systemFolder.status === 400);

        const removedFolder = await request(server, {
            method: "DELETE",
            path: "/api/agent/mailboxes/ceo@acme.test/folders/Agent%20Smoke",
            token: keyB,
        });
        check("an agent deletes its folder", removedFolder.status === 200);

        const draft = await request(server, {
            method: "POST",
            path: "/api/agent/mailboxes/ceo@acme.test/drafts",
            token: keyB,
            body: { to: "partner@example.com", subject: "Draft", text: "WIP" },
        });
        check("an agent saves a draft", draft.status === 201);

        const doomed = deliverMail("ceo@acme.test", "Smoke: delete me");
        const source = await request(server, {
            path: `/api/agent/mailboxes/ceo@acme.test/emails/${doomed}/source`,
            token: keyB,
        });
        check(
            "an agent reads the raw source",
            source.status === 200 &&
                String(source.body).includes("Smoke: delete me")
        );

        const trashed = await request(server, {
            method: "DELETE",
            path: `/api/agent/mailboxes/ceo@acme.test/emails/${doomed}`,
            token: keyB,
        });
        check(
            "deleting moves to Trash",
            trashed.status === 200 && trashed.body.movedTo === "Trash",
            JSON.stringify(trashed.body)
        );

        const readOnlyDelete = await request(server, {
            method: "DELETE",
            path: `/api/agent/mailboxes/ceo@acme.test/emails/${uid}`,
            token: keyA,
        });
        check(
            "deleting requires the modify permission",
            readOnlyDelete.status === 403
        );

        console.log("\nAgent API: mailbox settings");
        const noSettings = await request(server, {
            path: "/api/agent/mailboxes/ceo@acme.test/settings/vacation",
            token: keyA,
        });
        check(
            "settings require the settings permission",
            noSettings.status === 403
        );

        const mailboxOnly = await request(server, {
            method: "POST",
            path: "/api/admin/agents",
            token: domainAdmin,
            body: {
                name: `${NAME_PREFIX}mailbox-provisioner`,
                mailboxes: ["ceo@acme.test"],
                permissions: ["provision"],
            },
        });
        check(
            "provisioning needs whole domains in scope",
            mailboxOnly.status === 400,
            JSON.stringify(mailboxOnly.body)
        );

        const createdC = await request(server, {
            method: "POST",
            path: "/api/admin/agents",
            token: domainAdmin,
            body: {
                name: `${NAME_PREFIX}acme-admin`,
                domains: ["acme.test"],
                permissions: ["read", "settings", "provision"],
            },
        });
        check(
            "a domain admin creates a provisioning agent",
            createdC.status === 201,
            JSON.stringify(createdC.body)
        );
        const keyC = createdC.body.apiKey;

        const vacation = await request(server, {
            path: "/api/agent/mailboxes/ceo@acme.test/settings/vacation",
            token: keyC,
        });
        check(
            "an agent reads a mailbox's vacation reply",
            vacation.status === 200
        );

        const identities = await request(server, {
            path: "/api/agent/mailboxes/ceo@acme.test/settings/identities",
            token: keyC,
        });
        check(
            "an agent reads a mailbox's identities",
            identities.status === 200 &&
                identities.body.availableAddresses?.includes("ceo@acme.test")
        );

        const settingsOutside = await request(server, {
            path: "/api/agent/mailboxes/test@localhost/settings/forwarding",
            token: keyC,
        });
        check(
            "settings outside the scope are refused",
            settingsOutside.status === 403
        );

        console.log("\nAgent API: provisioning");
        const noProvision = await request(server, {
            path: "/api/agent/admin/mailboxes",
            token: keyA,
        });
        check(
            "provisioning requires the provision permission",
            noProvision.status === 403
        );

        const domainsC = await request(server, {
            path: "/api/agent/admin/domains",
            token: keyC,
        });
        check(
            "a domain-scoped agent only sees its domains",
            (domainsC.body.domains || [])
                .map((entry) => entry.domain)
                .join() === "acme.test",
            JSON.stringify(
                (domainsC.body.domains || []).map((entry) => entry.domain)
            )
        );

        const hired = await request(server, {
            method: "POST",
            path: "/api/agent/admin/mailboxes",
            token: keyC,
            body: {
                email: HIRE,
                password: "SmokeTest123!",
                name: "Agent Hire",
            },
        });
        check(
            "an agent creates a mailbox in its domain",
            hired.status === 201,
            JSON.stringify(hired.body).slice(0, 200)
        );

        const reachable = await request(server, {
            path: "/api/agent/mailboxes",
            token: keyC,
        });
        check(
            "the new mailbox is immediately in the agent's scope",
            (reachable.body.mailboxes || []).some((row) => row.address === HIRE)
        );

        const elsewhere = await request(server, {
            method: "POST",
            path: "/api/agent/admin/mailboxes",
            token: keyC,
            body: { email: "intruder@localhost", password: "SmokeTest123!" },
        });
        check(
            "an agent cannot create mailboxes outside its domains",
            elsewhere.status === 403
        );

        const promote = await request(server, {
            method: "POST",
            path: "/api/agent/admin/mailboxes",
            token: keyC,
            body: {
                email: "boss@acme.test",
                password: "SmokeTest123!",
                isGlobalAdmin: true,
            },
        });
        check("an agent cannot mint a global admin", promote.status === 403);

        const newDomain = await request(server, {
            method: "POST",
            path: "/api/agent/admin/domains",
            token: keyC,
            body: { domain: SMOKE_DOMAIN },
        });
        check(
            "a domain-scoped agent cannot add domains",
            newDomain.status === 403
        );

        const grantDenied = await request(server, {
            method: "POST",
            path: "/api/agent/admin/domains/acme.test/admins",
            token: keyC,
            body: { email: HIRE },
        });
        check(
            "granting admins requires the admins permission",
            grantDenied.status === 403
        );

        const password = await request(server, {
            method: "PUT",
            path: `/api/agent/admin/mailboxes/${HIRE}/password`,
            token: keyC,
            body: { password: "AnotherPass123!" },
        });
        check(
            "an agent resets a password in its domain",
            password.status === 200
        );

        const forwarding = await request(server, {
            method: "PUT",
            path: `/api/agent/admin/mailboxes/${HIRE}/forwardings`,
            token: keyC,
            body: { destinations: ["ops@acme.test"], keepCopy: true },
        });
        check("an agent sets forwarding", forwarding.status === 200);

        const fired = await request(server, {
            method: "DELETE",
            path: `/api/agent/admin/mailboxes/${HIRE}`,
            token: keyC,
        });
        check(
            "an agent deletes a mailbox",
            fired.status === 200,
            JSON.stringify(fired.body)
        );

        const tombstone = await mailQuery(
            "SELECT * FROM deleted_mailboxes WHERE username = $1 ORDER BY id DESC LIMIT 1",
            [HIRE]
        );
        check(
            "the deletion is attributed to the agent",
            JSON.stringify(tombstone.rows[0] || {}).includes(
                `agent:${createdC.body.agent.id}`
            ),
            JSON.stringify(tombstone.rows[0])
        );

        const createdD = await request(server, {
            method: "POST",
            path: "/api/admin/agents",
            token: globalAdmin,
            body: {
                name: `${NAME_PREFIX}directory`,
                scopeAll: true,
                permissions: ["provision"],
            },
        });
        const keyD = createdD.body.apiKey;

        const addDomain = await request(server, {
            method: "POST",
            path: "/api/agent/admin/domains",
            token: keyD,
            body: { domain: SMOKE_DOMAIN, description: "Agent smoke" },
        });
        check(
            "an all-mailbox agent adds a domain",
            addDomain.status === 201,
            JSON.stringify(addDomain.body).slice(0, 200)
        );

        const dropDomain = await request(server, {
            method: "DELETE",
            path: `/api/agent/admin/domains/${SMOKE_DOMAIN}`,
            token: keyD,
        });
        check(
            "an all-mailbox agent removes a domain",
            dropDomain.status === 200
        );

        const globalWithoutAdmins = await request(server, {
            method: "POST",
            path: "/api/agent/admin/mailboxes",
            token: keyD,
            body: {
                email: "boss@localhost",
                password: "SmokeTest123!",
                isGlobalAdmin: true,
            },
        });
        check(
            "even an all-mailbox agent needs the admins permission to grant global admin",
            globalWithoutAdmins.status === 403
        );

        const createdE = await request(server, {
            method: "POST",
            path: "/api/admin/agents",
            token: globalAdmin,
            body: {
                name: `${NAME_PREFIX}localhost-admin`,
                domains: ["localhost"],
                permissions: ["provision", "admins"],
            },
        });
        const keyE = createdE.body.apiKey;

        const takeover = await request(server, {
            method: "PUT",
            path: "/api/agent/admin/mailboxes/admin@localhost/password",
            token: keyE,
            body: { password: "Hijacked123!" },
        });
        check(
            "a domain-scoped agent cannot reset a global admin's password",
            takeover.status === 403
        );

        const granted = await request(server, {
            method: "POST",
            path: "/api/agent/admin/domains/localhost/admins",
            token: keyE,
            body: { email: "sarah@localhost" },
        });
        const revokedAdmin = await request(server, {
            method: "DELETE",
            path: "/api/agent/admin/domains/localhost/admins/sarah@localhost",
            token: keyE,
        });
        check(
            "an agent with the admins permission grants and revokes domain admins",
            granted.status === 201 && revokedAdmin.status === 200
        );

        const humanPromote = await request(server, {
            method: "POST",
            path: "/api/admin/mailboxes",
            token: domainAdmin,
            body: {
                email: "boss@acme.test",
                password: "SmokeTest123!",
                isGlobalAdmin: true,
            },
        });
        check(
            "a human domain admin cannot mint a global admin either",
            humanPromote.status === 403
        );

        console.log("\nRevocation");
        await mailQuery(
            "DELETE FROM domain_admins WHERE username = $1 AND domain = $2",
            ["ops@acme.test", "acme.test"]
        );
        agents.invalidate();
        const revoked = await request(server, {
            path: "/api/agent/mailboxes/ceo@acme.test/emails",
            token: keyA,
        });
        check(
            "an agent loses access when its creator does",
            revoked.status === 403
        );
        await mailQuery(
            "INSERT INTO domain_admins (username, domain, created) VALUES ($1, $2, NOW())",
            ["ops@acme.test", "acme.test"]
        );
        agents.invalidate();

        const rotated = await request(server, {
            method: "POST",
            path: `/api/admin/agents/${agentA.id}/rotate-key`,
            token: domainAdmin,
        });
        const oldKey = await request(server, {
            path: "/api/agent/me",
            token: keyA,
        });
        keyA = rotated.body.apiKey;
        const newKey = await request(server, {
            path: "/api/agent/me",
            token: keyA,
        });
        check(
            "rotating the key revokes the old one",
            oldKey.status === 401 && newKey.status === 200
        );

        await request(server, {
            method: "PUT",
            path: `/api/admin/agents/${agentA.id}`,
            token: domainAdmin,
            body: { active: false },
        });
        const disabled = await request(server, {
            path: "/api/agent/me",
            token: keyA,
        });
        check("a disabled agent's key stops working", disabled.status === 401);

        console.log("\nCleanup");
        const removedA = await request(server, {
            method: "DELETE",
            path: `/api/admin/agents/${agentA.id}`,
            token: domainAdmin,
        });
        const removedB = await request(server, {
            method: "DELETE",
            path: `/api/admin/agents/${agentB.id}`,
            token: globalAdmin,
        });
        check(
            "agents can be deleted",
            removedA.status === 200 && removedB.status === 200
        );

        const orphaned = await query(
            "SELECT COUNT(*) AS n FROM agent_deliveries WHERE agent_id = $1",
            [agentA.id]
        );
        check(
            "deleting an agent removes its deliveries",
            Number(orphaned.rows[0].n) === 0
        );
    } finally {
        await query("DELETE FROM agents WHERE name LIKE $1", [
            `${NAME_PREFIX}%`,
        ]);
        stub.close();
        server.close();
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    return failed;
};

const snapshots = new Map(
    FIXTURES.map((name) => [name, fs.readFileSync(path.join(DATA_DIR, name))])
);
const restoreFixtures = () => {
    for (const [name, contents] of snapshots) {
        fs.writeFileSync(path.join(DATA_DIR, name), contents);
    }
};

run()
    .then((failures) => {
        restoreFixtures();
        process.exit(failures > 0 ? 1 : 0);
    })
    .catch((error) => {
        restoreFixtures();
        console.error(error);
        process.exit(1);
    });
