const { Pool } = require("pg");
require("dotenv").config();

/**
 * Two logical databases.
 *
 * `mailPool` is iRedMail's `vmail`: mailbox, domain, alias, forwardings,
 * domain_admins, used_quota. Postfix and Dovecot read it directly, so this
 * application only ever touches the documented iRedMail schema and never
 * creates tables there.
 *
 * `appPool` holds everything this application owns (preferences, campaigns,
 * automation, filters, audit trail). Keeping it separate means the schema
 * bootstrap needs DDL rights on our own database only, and an iRedMail upgrade
 * can never collide with our tables.
 *
 * Point APP_DB_* at the same server and they can share a cluster; leave the
 * APP_DB_* variables unset and it falls back to the vmail connection, which
 * preserves the previous single-database behaviour for existing installs.
 */

const useMockData =
    process.env.NODE_ENV === "development" &&
    process.env.USE_MOCK_DATA === "true";

const POOL_TUNING = {
    max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis:
        parseInt(process.env.DB_CONNECT_TIMEOUT_MS, 10) || 5000,
};

const mailSettings = () => ({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || "vmail",
    user: process.env.DB_USER || "vmail",
    password: process.env.DB_PASSWORD,
});

const appSettings = () => {
    const mail = mailSettings();
    return {
        host: process.env.APP_DB_HOST || mail.host,
        port: parseInt(process.env.APP_DB_PORT, 10) || mail.port,
        database: process.env.APP_DB_NAME || mail.database,
        user: process.env.APP_DB_USER || mail.user,
        password: process.env.APP_DB_PASSWORD || mail.password,
    };
};

/** True when the two are the same physical database, so we skip a second pool. */
const sharesConnection = () => {
    const mail = mailSettings();
    const app = appSettings();
    return (
        mail.host === app.host &&
        mail.port === app.port &&
        mail.database === app.database
    );
};

let mailPool;
let appPool;

if (useMockData) {
    console.log("📁 Using mock database for development");
    const mockDb = require("./mockDatabase");
    // PGlite hosts both schemas in one instance; the split only matters in production.
    mailPool = mockDb.pool;
    appPool = mockDb.pool;
} else {
    const attach = (pool, label) => {
        pool.on("error", (error) => {
            console.error(`${label} database connection error:`, error);
        });
        return pool;
    };

    mailPool = attach(
        new Pool({ ...mailSettings(), ...POOL_TUNING }),
        "Mail (vmail)"
    );

    appPool = sharesConnection()
        ? mailPool
        : attach(new Pool({ ...appSettings(), ...POOL_TUNING }), "Application");

    console.log(
        sharesConnection()
            ? `🗄️  PostgreSQL: ${mailSettings().database} (mail and application data share one database)`
            : `🗄️  PostgreSQL: ${mailSettings().database} for mail, ${appSettings().database} for application data`
    );
}

const runQuery = (pool, label) => async (text, params) => {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        if (process.env.DB_DEBUG === "true") {
            console.log(`Executed ${label} query`, {
                text,
                duration: Date.now() - start,
                rows: result.rowCount,
            });
        }
        return result;
    } catch (error) {
        console.error(`${label} database query error:`, error.message);
        throw error;
    }
};

/**
 * Checkout wrapper for transactions. The timeout is a safety valve for a client
 * that is never released, set long enough not to fire mid-provisioning.
 */
const checkout = (pool) => async () => {
    const client = await pool.connect();
    const query = client.query;
    const release = client.release;

    const timeout = setTimeout(() => {
        console.warn("Releasing a database client that was held too long");
        client.release(true);
    }, 30000);

    client.query = (...args) => {
        client.lastQuery = args;
        return query.apply(client, args);
    };

    client.release = () => {
        clearTimeout(timeout);
        client.query = query;
        client.release = release;
        return release.apply(client);
    };

    return client;
};

/** Fail fast at boot rather than on the first user request. */
const verifyConnections = async () => {
    if (useMockData) return;

    await mailPool.query("SELECT 1");
    if (appPool !== mailPool) await appPool.query("SELECT 1");
};

module.exports = {
    pool: appPool,
    mailPool,
    query: runQuery(appPool, "application"),
    mailQuery: runQuery(mailPool, "mail"),
    getClient: checkout(appPool),
    getMailClient: checkout(mailPool),
    verifyConnections,
    sharesConnection,
};
