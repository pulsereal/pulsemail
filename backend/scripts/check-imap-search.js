/**
 * Validates the IMAP SEARCH criteria we build against node-imap's own query
 * builder:
 *   node scripts/check-imap-search.js
 *
 * The mock mail service ignores the structure of the criteria entirely: it digs
 * the first string literal out of the tree and matches on that. So a malformed
 * criteria tree passes every mock-backed test and only fails against a real
 * Dovecot. This drives the real builder instead, by giving a Connection just
 * enough state to reach it without opening a socket.
 */
const assert = require("assert");
const Imap = require("imap");

const { anyOf, buildSearchCriteria } = require("../src/utils/imapSearch");

let passed = 0;
let failed = 0;

const check = (label, fn) => {
    try {
        fn();
        passed += 1;
        console.log(`  PASS  ${label}`);
    } catch (error) {
        failed += 1;
        console.log(`  FAIL  ${label} -> ${error.message}`);
    }
};

/**
 * Runs criteria through node-imap's buildSearchQuery and returns the command
 * it would send. `_search` needs a selected box and a capability list, and
 * queues the command afterwards, so those are stubbed out.
 */
const compile = (criteria) => {
    const connection = new Imap({ user: "u", password: "p" });
    connection._box = { name: "INBOX" };
    connection._caps = [];

    let sent = null;
    connection._enqueue = (command) => {
        sent = command;
    };

    connection._search("", criteria, () => {});
    return sent;
};

console.log("\nnode-imap accepts what we build");

check("a plain term search compiles", () => {
    const command = compile(buildSearchCriteria({ query: "invoice" }));
    assert.match(command, /^SEARCH/);
    assert.match(command, /SUBJECT/);
    assert.match(command, /FROM/);
    assert.match(command, /BODY/);
});

check("three alternatives become nested binary ORs", () => {
    const command = compile(buildSearchCriteria({ query: "invoice" }));
    // Two OR keywords for three alternatives.
    assert.strictEqual(
        (command.match(/OR/g) || []).length,
        2,
        `expected two ORs, got: ${command}`
    );
});

check("an empty search compiles to ALL", () => {
    assert.match(compile(buildSearchCriteria({})), /ALL/);
});

check("every field at once compiles", () => {
    const command = compile(
        buildSearchCriteria({
            query: "invoice",
            sender: "billing@example.com",
            subject: "overdue",
            dateFrom: "2026-01-01",
            dateTo: "2026-02-01",
            hasAttachments: true,
        })
    );
    assert.match(command, /SINCE/);
    assert.match(command, /BEFORE/);
    assert.match(command, /HEADER/);
});

check("criteria are ANDed implicitly, never with a literal AND", () => {
    const criteria = buildSearchCriteria({
        sender: "a@example.com",
        subject: "b",
    });
    assert.ok(
        !JSON.stringify(criteria).includes("AND"),
        `criteria must not contain an AND key: ${JSON.stringify(criteria)}`
    );
    compile(criteria);
});

check("the result is always a top-level array", () => {
    for (const input of [{}, { query: "x" }, { sender: "a@b.c" }]) {
        assert.ok(
            Array.isArray(buildSearchCriteria(input)),
            `not an array for ${JSON.stringify(input)}`
        );
    }
});

check("unparseable dates are dropped rather than sent as Invalid Date", () => {
    const command = compile(
        buildSearchCriteria({ query: "x", dateFrom: "not-a-date" })
    );
    assert.ok(
        !command.includes("Invalid"),
        `Invalid Date leaked into the query: ${command}`
    );
});

console.log("\nThe shapes node-imap rejects");

check("a flat three-operand OR is rejected, as we assumed", () => {
    assert.throws(
        () =>
            compile([
                ["OR", ["SUBJECT", "x"], ["FROM", "x"], ["BODY", "x"]],
            ]),
        /exactly two arguments/
    );
});

check("a literal AND key is rejected, as we assumed", () => {
    assert.throws(
        () => compile(["AND", ["FROM", "a@b.c"], ["SUBJECT", "x"]]),
        /Unexpected search option/
    );
});

check("an unwrapped OR group is rejected, as we assumed", () => {
    assert.throws(() =>
        compile(["OR", ["SUBJECT", "x"], ["FROM", "x"]])
    );
});

console.log("\nFolding helper");

check("anyOf leaves a single alternative alone", () => {
    assert.deepStrictEqual(anyOf([["SUBJECT", "x"]]), ["SUBJECT", "x"]);
});

check("anyOf nests to the right", () => {
    assert.deepStrictEqual(anyOf([["A", 1], ["B", 2], ["C", 3]]), [
        "OR",
        ["A", 1],
        ["OR", ["B", 2], ["C", 3]],
    ]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
