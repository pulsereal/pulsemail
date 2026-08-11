/**
 * Checks that deploy/grants.sql actually grants every privilege the mail-side
 * code uses on iRedMail's vmail database:
 *   node scripts/check-grants.js
 *
 * No functional test can catch a missing grant. The development database is
 * PGlite, where the application connects as the owner and privileges are never
 * enforced, so a statement that is refused in production passes locally. This
 * compares the statements in the source against the grant list instead.
 *
 * Table names are matched against the inventory in grants.sql, which is the
 * authoritative list of iRedMail tables. That sidesteps having to work out
 * which connection pool a given statement uses: no table this application owns
 * shares a name with an iRedMail table.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const GRANTS = path.join(ROOT, "deploy", "grants.sql");

const SOURCES = [
    "backend/src/models/Mailbox.js",
    "backend/src/models/Domain.js",
    "backend/src/models/Alias.js",
    "backend/src/models/User.js",
    "backend/src/routes/admin.js",
    "backend/src/routes/provisioning.js",
    "backend/src/services/ClassificationWorker.js",
];

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

/** table -> Set of privileges, read out of the GRANT blocks in grants.sql. */
const parseGrants = (sql) => {
    const granted = new Map();

    for (const chunk of sql.split("\\gexec")) {
        const grant = chunk.match(/GRANT\s+([A-Z,\s]+?)\s+ON\s+(\w*)/);
        if (!grant) continue;

        // Only table grants matter here.
        const target = grant[2].toUpperCase();
        if (["DATABASE", "SCHEMA", "SEQUENCE"].includes(target)) continue;

        const privileges = grant[1]
            .split(",")
            .map((privilege) => privilege.trim().toUpperCase())
            .filter(Boolean);

        const names = [];
        const array = chunk.match(/ARRAY\s*\[([\s\S]*?)\]/);
        if (array) {
            for (const match of array[1].matchAll(/'([a-z_][a-z0-9_]*)'/g)) {
                names.push(match[1]);
            }
        }
        for (const match of chunk.matchAll(
            /relname\s*=\s*'([a-z_][a-z0-9_]*)'/g
        )) {
            names.push(match[1]);
        }

        for (const name of names) {
            if (!granted.has(name)) granted.set(name, new Set());
            for (const privilege of privileges) granted.get(name).add(privilege);
        }
    }

    return granted;
};

/** Statements in the source, as { table, privilege, file } tuples. */
const parseUsage = (known) => {
    const usages = [];

    const patterns = [
        [/INSERT\s+INTO\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi, "INSERT"],
        [/DELETE\s+FROM\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi, "DELETE"],
        [/\bUPDATE\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+SET/gi, "UPDATE"],
        [/\bFROM\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi, "SELECT"],
        [/\bJOIN\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi, "SELECT"],
    ];

    for (const relative of SOURCES) {
        const file = path.join(ROOT, relative);
        if (!fs.existsSync(file)) continue;
        const source = fs.readFileSync(file, "utf8");

        for (const [pattern, privilege] of patterns) {
            for (const match of source.matchAll(pattern)) {
                const table = match[1].toLowerCase();
                if (!known.has(table)) continue;
                usages.push({ table, privilege, file: relative });
            }
        }
    }

    return usages;
};

const run = () => {
    const sql = fs.readFileSync(GRANTS, "utf8");
    const granted = parseGrants(sql);

    // The inventory notice at the end of grants.sql lists every iRedMail table
    // the application touches, so it doubles as the set of names to look for.
    const inventory = sql.match(/unnest\(ARRAY\[([\s\S]*?)\]\)/);
    const known = new Set(
        [...(inventory?.[1] ?? "").matchAll(/'([a-z_][a-z0-9_]*)'/g)].map(
            (match) => match[1]
        )
    );

    console.log("\nGrant list sanity");
    check("grants.sql declares an iRedMail table inventory", known.size > 0);
    check(
        "every inventoried table is granted something",
        [...known].every((table) => granted.has(table)),
        [...known].filter((table) => !granted.has(table)).join(", ")
    );

    console.log("\nPrivileges required by the code");
    const usages = parseUsage(known);
    check("statements were found to check", usages.length > 0);

    const missing = new Map();
    for (const usage of usages) {
        if (granted.get(usage.table)?.has(usage.privilege)) continue;

        const key = `${usage.privilege} on ${usage.table}`;
        if (!missing.has(key)) missing.set(key, new Set());
        missing.get(key).add(usage.file);
    }

    for (const table of [...known].sort()) {
        const needed = new Set(
            usages
                .filter((usage) => usage.table === table)
                .map((usage) => usage.privilege)
        );
        if (needed.size === 0) continue;

        const held = granted.get(table) ?? new Set();
        const gap = [...needed].filter((privilege) => !held.has(privilege));

        check(
            `${table}: needs ${[...needed].sort().join(", ")}`,
            gap.length === 0,
            gap.length ? `not granted: ${gap.join(", ")}` : undefined
        );
    }

    if (missing.size > 0) {
        console.log("\nWhere the missing privileges are used:");
        for (const [key, files] of missing) {
            console.log(`  ${key}  <-  ${[...files].join(", ")}`);
        }
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
};

run();
