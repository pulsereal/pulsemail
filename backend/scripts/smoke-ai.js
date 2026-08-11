/**
 * Exercises AI importance sorting end to end against a stub LLM endpoint.
 *
 * The stub is the point: because every provider we support speaks the OpenAI
 * chat-completions API, pointing base_url at a local server covers the real
 * request path, the reply parsing, persistence and the priority listing without
 * spending anything or needing network access:
 *   node scripts/smoke-ai.js
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
                    } catch {
                        parsed = data;
                    }
                    console.log(`${method} ${path} - ${res.statusCode}`);
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

/**
 * Stands in for the LLM. Scores anything whose subject looks urgent highly and
 * everything else low, and wraps the JSON in a code fence so the reply parser
 * is exercised the way a real model behaves.
 */
const startStubLLM = async () => {
    const state = { requests: 0, batchSizes: [], lastBody: null };

    const server = http.createServer((req, res) => {
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
            const parsed = JSON.parse(raw);

            const reply = (content) => {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(
                    JSON.stringify({
                        model: parsed.model,
                        choices: [{ message: { role: "assistant", content } }],
                        usage: { prompt_tokens: 100, completion_tokens: 20 },
                    })
                );
            };

            // The connection test sends a single throwaway user message.
            if (parsed.messages.length < 2) {
                reply("ok");
                return;
            }

            state.requests += 1;
            state.lastBody = parsed;

            const prompt = parsed.messages[1].content;
            const messages = JSON.parse(
                prompt.slice(prompt.indexOf("["), prompt.lastIndexOf("]") + 1)
            );
            state.batchSizes.push(messages.length);

            const verdicts = messages.map((message) => {
                const urgent = /urgent|invoice|security|deadline/i.test(
                    `${message.subject} ${message.body}`
                );
                return {
                    id: message.id,
                    importance: urgent ? 92 : 12,
                    category: urgent ? "important" : "promotional",
                    reason: urgent ? "asks for action" : "bulk mail",
                };
            });

            // Fenced, the way a real model usually answers.
            reply("```json\n" + JSON.stringify(verdicts) + "\n```");
        });
    });

    server.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));

    return {
        state,
        url: `http://127.0.0.1:${server.address().port}/v1`,
        close: () => server.close(),
    };
};

const run = async () => {
    await app.initializeDatabase();

    const server = http.createServer(app).listen(0);
    await new Promise((resolve) => server.once("listening", resolve));

    const stub = await startStubLLM();

    const admin = sign({
        email: "admin@localhost",
        isAdmin: true,
        adminType: "global",
    });
    const user = sign({ email: "test@localhost" });

    console.log("\nAccess control");
    const denied = await request(server, {
        method: "GET",
        path: "/api/admin/ai/settings",
        token: user,
    });
    check("a normal user cannot read AI settings", denied.status === 403);

    console.log("\nDefaults");
    const initial = await request(server, {
        method: "GET",
        path: "/api/admin/ai/settings",
        token: admin,
    });
    check("admin reads settings", initial.status === 200);
    check(
        "AI is off until it is configured",
        initial.body.settings?.enabled === false ||
            initial.body.settings?.classify_enabled === false
    );
    check(
        "the raw API key is never returned",
        !("apiKey" in (initial.body.settings || {})) &&
            !("api_key_encrypted" in (initial.body.settings || {})),
        JSON.stringify(Object.keys(initial.body.settings || {}))
    );

    console.log("\nValidation");
    const bad = await request(server, {
        method: "PUT",
        path: "/api/admin/ai/settings",
        token: admin,
        body: { baseUrl: "not-a-url", model: "x" },
    });
    check("a malformed base URL is rejected", bad.status === 400);

    console.log("\nConfiguring the endpoint");
    const saved = await request(server, {
        method: "PUT",
        path: "/api/admin/ai/settings",
        token: admin,
        body: {
            enabled: true,
            classifyEnabled: true,
            baseUrl: stub.url,
            apiKey: "sk-smoke-secret-key-1234",
            model: "stub-model",
            importanceThreshold: 70,
            batchSize: 5,
            dailyLimit: 500,
            lookbackDays: 3650,
            snippetChars: 300,
        },
    });
    check("settings save", saved.status === 200);
    check(
        "the key is stored but only shown as a hint",
        saved.body.settings?.hasApiKey === true &&
            saved.body.settings?.apiKeyHint === "****1234",
        JSON.stringify(saved.body.settings?.apiKeyHint)
    );
    check(
        "turning classification on schedules the worker",
        saved.body.worker?.scheduled === true
    );

    console.log("\nConnection test");
    const tested = await request(server, {
        method: "POST",
        path: "/api/admin/ai/settings/test",
        token: admin,
        body: {},
    });
    check("the endpoint answers", tested.body.result?.ok === true,
        JSON.stringify(tested.body.result));

    console.log("\nSaving again keeps the stored key");
    const resaved = await request(server, {
        method: "PUT",
        path: "/api/admin/ai/settings",
        token: admin,
        body: { importanceThreshold: 70 },
    });
    check(
        "an omitted key does not wipe the saved one",
        resaved.body.settings?.hasApiKey === true &&
            resaved.body.settings?.apiKeyHint === "****1234"
    );

    console.log("\nClassification");
    const before = stub.state.requests;
    // Scoped to one mailbox: an unscoped run visits mailboxes round-robin and
    // would not reach this one on the first pass.
    const runResult = await request(server, {
        method: "POST",
        path: "/api/admin/ai/classify/run",
        token: admin,
        body: { mailboxes: ["test@localhost"] },
    });
    check("a run can be triggered by hand", runResult.status === 200);
    check(
        "messages were scored",
        (runResult.body.result?.scored ?? 0) > 0,
        JSON.stringify(runResult.body.result)
    );
    check("the endpoint was actually called", stub.state.requests > before);
    check(
        "messages are batched rather than sent one at a time",
        stub.state.batchSizes.every((size) => size <= 5)
    );
    check(
        "the configured model is used, not a hardcoded one",
        stub.state.lastBody?.model === "stub-model",
        stub.state.lastBody?.model
    );

    console.log("\nScores reach the inbox");
    const listed = await request(server, {
        method: "GET",
        path: "/api/emails?folder=INBOX&limit=50",
        token: user,
    });
    check("the inbox still loads", listed.status === 200);

    const scored = (listed.body.emails || []).filter(
        (item) => item.importance !== undefined
    );
    check("scores are attached to the listing", scored.length > 0);
    check(
        "the threshold decides what is flagged as priority",
        scored.every((item) => item.priority === item.importance >= 70)
    );

    console.log("\nPriority view");
    const priority = await request(server, {
        method: "GET",
        path: "/api/emails?folder=INBOX&limit=50&priority=true",
        token: user,
    });
    check("the priority listing loads", priority.status === 200);
    check(
        "it returns only mail at or above the threshold",
        (priority.body.emails || []).every(
            (item) => (item.importance ?? 0) >= 70
        ),
        JSON.stringify(
            (priority.body.emails || []).map((item) => item.importance)
        )
    );
    check(
        "it reports an exact total rather than the page length",
        priority.body.pagination?.exact === true
    );

    console.log("\nRe-running does not re-score the same mail");
    const requestsBefore = stub.state.requests;
    await request(server, {
        method: "POST",
        path: "/api/admin/ai/classify/run",
        token: admin,
        body: { mailboxes: ["test@localhost"] },
    });
    check(
        "already-scored messages are skipped",
        stub.state.requests === requestsBefore,
        `${stub.state.requests - requestsBefore} extra call(s)`
    );

    console.log("\nManual correction");
    const target = (listed.body.emails || [])[0];
    const corrected = await request(server, {
        method: "PATCH",
        path: `/api/emails/${target.uid}/categorize`,
        token: user,
        body: { category: "important", importance: 95, folder: "INBOX" },
    });
    check("a user can correct the classifier", corrected.status === 200);

    const afterCorrection = await request(server, {
        method: "GET",
        path: "/api/emails?folder=INBOX&limit=50",
        token: user,
    });
    const updated = (afterCorrection.body.emails || []).find(
        (item) => item.uid === target.uid
    );
    check(
        "the correction is stored",
        updated?.importance === 95 && updated?.category === "important",
        JSON.stringify({
            importance: updated?.importance,
            category: updated?.category,
        })
    );

    console.log("\nUsage accounting");
    const usage = await request(server, {
        method: "GET",
        path: "/api/admin/ai/usage",
        token: admin,
    });
    check("usage is recorded", (usage.body.today ?? 0) > 0);
    check(
        "token spend is tracked",
        usage.body.usage?.some((row) => Number(row.prompt_tokens) > 0)
    );

    console.log("\nFeature flags reach the client");
    const me = await request(server, {
        method: "GET",
        path: "/api/auth/me",
        token: user,
    });
    check("aiSorting is advertised once enabled", me.body.features?.aiSorting === true);

    console.log("\nTurning it off");
    const disabled = await request(server, {
        method: "PUT",
        path: "/api/admin/ai/settings",
        token: admin,
        body: { classifyEnabled: false },
    });
    check(
        "the worker is unscheduled",
        disabled.body.worker?.scheduled === false
    );

    const runWhenOff = await request(server, {
        method: "POST",
        path: "/api/admin/ai/classify/run",
        token: admin,
    });
    check(
        "a run does nothing while disabled",
        Boolean(runWhenOff.body.result?.skipped),
        JSON.stringify(runWhenOff.body.result)
    );

    stub.close();
    server.close();

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
};

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
