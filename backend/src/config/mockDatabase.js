const path = require("path");
const { PGlite } = require("@electric-sql/pglite");
const MockDataManager = require("./mockData");
const IREDMAIL_SCHEMA = require("./iredmailSchema");
const {
    hashPassword,
    generateMaildir,
    splitStorage,
    serializeSettings,
} = require("./iredmail");

/**
 * Development database: a real PostgreSQL instance compiled to WASM, seeded
 * with iRedMail's schema and a handful of fixture domains and mailboxes.
 *
 * Using actual Postgres rather than a hand-rolled SQL emulator means mock mode
 * exercises the same queries, constraints and transaction semantics as a live
 * `vmail` database, so provisioning bugs surface here instead of in production.
 */

const DEV_PASSWORD = process.env.MOCK_PASSWORD || "test";

// PGlite is a single connection, so overlapping transactions would interleave
class Mutex {
    #tail = Promise.resolve();

    acquire() {
        let release;
        const next = new Promise((resolve) => {
            release = resolve;
        });
        const previous = this.#tail;
        this.#tail = this.#tail.then(() => next);
        return previous.then(() => release);
    }
}

class MockDatabase {
    constructor() {
        this.mockData = new MockDataManager();
        this.mutex = new Mutex();
        this.ready = null;
    }

    async init() {
        if (!this.ready) {
            this.ready = this.#bootstrap();
        }
        return this.ready;
    }

    async #bootstrap() {
        const dataDir = path.join(__dirname, "../../data/pglite");
        const db = await PGlite.create({ dataDir });

        await db.exec(IREDMAIL_SCHEMA);
        await this.#seed(db);

        console.log("📁 Mock database ready (in-process PostgreSQL)");
        return db;
    }

    /**
     * Fixture data mirrors what iRedMail itself would have written: a domain
     * row, a mailbox row with a hashed password and generated maildir, and the
     * self-referencing forwardings row Postfix routes through.
     */
    async #seed(db) {
        const existing = await db.query("SELECT COUNT(*) AS n FROM domain");
        if (parseInt(existing.rows[0].n, 10) > 0) return;

        const users = this.mockData.getDefaultUsers();
        const admins = this.mockData.getDefaultAdmins();
        const emails = this.mockData.readData("emails.json");
        const domains = [...new Set(users.map((user) => user.domain))];
        const password = await hashPassword(DEV_PASSWORD, "SSHA512");
        const { base, node } = splitStorage();

        for (const domain of domains) {
            await db.query(
                `INSERT INTO domain (domain, description, settings, created)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (domain) DO NOTHING`,
                [
                    domain,
                    `${domain} (development fixture)`,
                    serializeSettings({ default_user_quota: 2048 }),
                ]
            );
        }

        for (const user of users) {
            await db.query(
                `INSERT INTO mailbox
                    (username, password, name, language, storagebasedirectory,
                     storagenode, maildir, quota, domain, isglobaladmin, active)
                 VALUES ($1, $2, $3, 'en_US', $4, $5, $6, 2048, $7, $8, $9)
                 ON CONFLICT (username) DO NOTHING`,
                [
                    user.email,
                    password,
                    user.name,
                    base,
                    node,
                    generateMaildir(user.email),
                    user.domain,
                    admins.some(
                        (admin) =>
                            admin.username === user.email &&
                            admin.domain === "ALL"
                    )
                        ? 1
                        : 0,
                    user.active ?? 1,
                ]
            );

            await db.query(
                `INSERT INTO forwardings
                    (address, forwarding, domain, dest_domain, is_forwarding)
                 VALUES ($1, $1, $2, $2, 1)
                 ON CONFLICT (address, forwarding) DO NOTHING`,
                [user.email, user.domain]
            );

            // Stand in for Dovecot's quota_clone dict
            const received = emails.filter((item) => item.to === user.email);
            await db.query(
                `INSERT INTO used_quota (username, bytes, messages, domain)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (username) DO NOTHING`,
                [
                    user.email,
                    received.reduce((sum, item) => sum + (item.size || 0), 0),
                    received.length,
                    user.domain,
                ]
            );

            await db.query(
                `INSERT INTO last_login (username, domain, imap)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (username, domain) DO NOTHING`,
                [
                    user.email,
                    user.domain,
                    Math.floor((Date.now() - 3600_000) / 1000),
                ]
            );
        }

        for (const admin of admins) {
            await db.query(
                `INSERT INTO domain_admins (username, domain, created)
                 VALUES ($1, $2, NOW())
                 ON CONFLICT (username, domain) DO NOTHING`,
                [admin.username, admin.domain]
            );
        }

        console.log(
            `📁 Seeded ${users.length} mailboxes across ${domains.length} domains ` +
                `(password: "${DEV_PASSWORD}")`
        );
    }

    async query(text, params = []) {
        const db = await this.init();

        if (process.env.DB_DEBUG === "true") {
            console.log("🔍 Mock Query:", text.replace(/\s+/g, " ").slice(0, 140));
            console.log("📝 Params:", params);
        }

        const result = await db.query(text, params);

        return {
            rows: result.rows || [],
            rowCount: result.rows?.length || result.affectedRows || 0,
            command: text.trim().split(/\s+/)[0].toUpperCase(),
        };
    }

    /**
     * Hand out an exclusive lease on the single connection so BEGIN/COMMIT
     * blocks cannot interleave with other callers.
     */
    async getClient() {
        const db = await this.init();
        const release = await this.mutex.acquire();
        let released = false;

        return {
            query: async (text, params = []) => {
                const result = await db.query(text, params);
                return {
                    rows: result.rows || [],
                    rowCount: result.rows?.length || result.affectedRows || 0,
                };
            },
            release: () => {
                if (released) return;
                released = true;
                release();
            },
        };
    }

    async connect() {
        return this.getClient();
    }

    async end() {
        if (!this.ready) return true;
        const db = await this.ready;
        await db.close();
        return true;
    }

    getMockData() {
        return this.mockData;
    }

    resetData() {
        this.mockData.resetData();
    }

    exportData() {
        return this.mockData.exportData();
    }

    importData(data) {
        this.mockData.importData(data);
    }
}

const mockDatabase = new MockDatabase();

const mockPool = {
    query: (text, params) => mockDatabase.query(text, params),
    getClient: () => mockDatabase.getClient(),
    connect: () => mockDatabase.connect(),
    end: () => mockDatabase.end(),
    on: () => {},
    close: () => mockDatabase.end(),
    totalCount: 1,
    idleCount: 0,
    waitingCount: 0,
};

module.exports = {
    query: (text, params) => mockDatabase.query(text, params),
    getClient: () => mockDatabase.getClient(),
    connect: () => mockDatabase.connect(),
    end: () => mockDatabase.end(),
    getMockData: () => mockDatabase.getMockData(),
    resetData: () => mockDatabase.resetData(),
    exportData: () => mockDatabase.exportData(),
    importData: (data) => mockDatabase.importData(data),
    pool: mockPool,
};
