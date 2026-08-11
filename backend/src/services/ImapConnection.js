const Imap = require("imap");

const DEFAULTS = {
    idleTtlMs: 30000,
    maxConnections: 10,
    connTimeout: 15000,
    authTimeout: 10000,
    acquireTimeoutMs: 20000,
};

let cachedConfig = null;

const readConfig = () => {
    if (cachedConfig) return cachedConfig;

    const intFromEnv = (name, fallback) => {
        const parsed = parseInt(process.env[name], 10);
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    cachedConfig = {
        host: process.env.IMAP_HOST || "localhost",
        port: intFromEnv("IMAP_PORT", 143),
        tls: process.env.IMAP_SECURE === "true",
        tlsOptions: {
            rejectUnauthorized:
                process.env.IMAP_TLS_REJECT_UNAUTHORIZED !== "false",
            servername: process.env.IMAP_TLS_SERVERNAME || undefined,
        },
        masterUser: process.env.IMAP_MASTER_USER || "",
        masterPass: process.env.IMAP_MASTER_PASS || "",
        // Dovecot's auth_master_user_separator, "*" by default.
        separator: process.env.IMAP_MASTER_SEPARATOR || "*",
        connTimeout: intFromEnv("IMAP_CONN_TIMEOUT_MS", DEFAULTS.connTimeout),
        authTimeout: intFromEnv("IMAP_AUTH_TIMEOUT_MS", DEFAULTS.authTimeout),
        maxConnections: intFromEnv(
            "IMAP_MAX_CONNECTIONS",
            DEFAULTS.maxConnections
        ),
        idleTtlMs: intFromEnv("IMAP_IDLE_TTL_MS", DEFAULTS.idleTtlMs),
        acquireTimeoutMs: intFromEnv(
            "IMAP_ACQUIRE_TIMEOUT_MS",
            DEFAULTS.acquireTimeoutMs
        ),
    };

    return cachedConfig;
};

const resetConfigCache = () => {
    cachedConfig = null;
};

/**
 * Counting semaphore that hands a released slot straight to the next waiter so
 * the total number of live IMAP sockets never exceeds the configured cap.
 */
class Semaphore {
    constructor(max) {
        this.max = Math.max(1, max);
        this.active = 0;
        this.waiters = [];
    }

    acquire(timeoutMs) {
        if (this.active < this.max) {
            this.active += 1;
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            const waiter = { resolve, reject, timer: null };
            waiter.timer = setTimeout(() => {
                const index = this.waiters.indexOf(waiter);
                if (index !== -1) this.waiters.splice(index, 1);
                reject(
                    new Error(
                        `Timed out after ${timeoutMs}ms waiting for a free IMAP connection slot`
                    )
                );
            }, timeoutMs);
            this.waiters.push(waiter);
        });
    }

    release() {
        const waiter = this.waiters.shift();
        if (waiter) {
            clearTimeout(waiter.timer);
            waiter.resolve();
            return;
        }
        this.active = Math.max(0, this.active - 1);
    }
}

/**
 * Promise wrapper around a single node-imap socket. Tracks the currently
 * selected mailbox so pooled connections can skip redundant SELECT round trips.
 */
class ImapClient {
    constructor(raw, mailbox) {
        this.raw = raw;
        this.mailbox = mailbox;
        this.box = null;
        this.boxReadOnly = null;
        this.usable = true;

        const markDead = () => {
            this.usable = false;
        };
        raw.on("error", markDead);
        raw.on("close", markDead);
        raw.on("end", markDead);
    }

    async openBox(name, readOnly = true) {
        if (
            this.box &&
            this.box.name === name &&
            this.boxReadOnly === readOnly
        ) {
            return this.box;
        }

        const box = await new Promise((resolve, reject) => {
            this.raw.openBox(name, readOnly, (err, opened) =>
                err ? reject(err) : resolve(opened)
            );
        });

        this.box = box;
        this.boxReadOnly = readOnly;
        return box;
    }

    listBoxes() {
        return new Promise((resolve, reject) => {
            this.raw.getBoxes((err, boxes) =>
                err ? reject(err) : resolve(boxes || {})
            );
        });
    }

    status(name) {
        return new Promise((resolve, reject) => {
            this.raw.status(name, (err, box) =>
                err ? reject(err) : resolve(box)
            );
        });
    }

    search(criteria) {
        return new Promise((resolve, reject) => {
            this.raw.search(criteria, (err, uids) =>
                err ? reject(err) : resolve(uids || [])
            );
        });
    }

    /**
     * @param source UID set (or sequence set when byUid is false)
     * @returns [{ seqno, attrs, bodies: { [which]: Buffer } }]
     */
    fetch(source, options, byUid = true) {
        return new Promise((resolve, reject) => {
            const namespace = byUid ? this.raw : this.raw.seq;
            const messages = [];
            let fetcher;

            try {
                fetcher = namespace.fetch(source, options);
            } catch (error) {
                reject(error);
                return;
            }

            fetcher.on("message", (msg) => {
                const record = { seqno: null, attrs: null, bodies: {} };

                msg.on("body", (stream, info) => {
                    const chunks = [];
                    stream.on("data", (chunk) => chunks.push(chunk));
                    stream.once("end", () => {
                        record.bodies[info.which] = Buffer.concat(chunks);
                    });
                });

                msg.once("attributes", (attrs) => {
                    record.attrs = attrs;
                });

                msg.once("end", () => {
                    messages.push(record);
                });
            });

            fetcher.once("error", reject);
            fetcher.once("end", () => resolve(messages));
        });
    }

    addFlags(source, flags, byUid = true) {
        const namespace = byUid ? this.raw : this.raw.seq;
        return new Promise((resolve, reject) => {
            namespace.addFlags(source, flags, (err) =>
                err ? reject(err) : resolve(true)
            );
        });
    }

    delFlags(source, flags, byUid = true) {
        const namespace = byUid ? this.raw : this.raw.seq;
        return new Promise((resolve, reject) => {
            namespace.delFlags(source, flags, (err) =>
                err ? reject(err) : resolve(true)
            );
        });
    }

    move(source, targetFolder, byUid = true) {
        const namespace = byUid ? this.raw : this.raw.seq;
        return new Promise((resolve, reject) => {
            namespace.move(source, targetFolder, (err) =>
                err ? reject(err) : resolve(true)
            );
        });
    }

    append(message, options) {
        return new Promise((resolve, reject) => {
            this.raw.append(message, options, (err) =>
                err ? reject(err) : resolve(true)
            );
        });
    }

    expunge(uids) {
        return new Promise((resolve, reject) => {
            const callback = (err) => (err ? reject(err) : resolve(true));
            if (uids) this.raw.expunge(uids, callback);
            else this.raw.expunge(callback);
        });
    }

    addBox(name) {
        return new Promise((resolve, reject) => {
            this.raw.addBox(name, (err) => (err ? reject(err) : resolve(true)));
        });
    }

    /**
     * Deleting or renaming the selected mailbox is illegal in IMAP, so drop the
     * selection first and let the next call re-SELECT.
     */
    #deselect() {
        this.box = null;
        this.boxReadOnly = null;
        return new Promise((resolve) => {
            try {
                this.raw.closeBox(false, () => resolve());
            } catch (error) {
                resolve();
            }
        });
    }

    async delBox(name) {
        if (this.box?.name === name) await this.#deselect();
        return new Promise((resolve, reject) => {
            this.raw.delBox(name, (err) => (err ? reject(err) : resolve(true)));
        });
    }

    async renameBox(from, to) {
        if (this.box?.name === from) await this.#deselect();
        return new Promise((resolve, reject) => {
            this.raw.renameBox(from, to, (err) =>
                err ? reject(err) : resolve(true)
            );
        });
    }

    subscribeBox(name) {
        return new Promise((resolve, reject) => {
            this.raw.subscribeBox(name, (err) =>
                err ? reject(err) : resolve(true)
            );
        });
    }

    unsubscribeBox(name) {
        return new Promise((resolve, reject) => {
            this.raw.unsubscribeBox(name, (err) =>
                err ? reject(err) : resolve(true)
            );
        });
    }

    destroy() {
        this.usable = false;
        try {
            this.raw.end();
        } catch (error) {
            // Socket already gone; nothing to clean up.
        }
    }
}

/**
 * Per-mailbox pool of IMAP connections authenticated through the Dovecot
 * master user. Idle sockets are reused for a short window, then evicted.
 */
class ImapPool {
    constructor() {
        this.idle = new Map();
        this.semaphore = null;
    }

    get config() {
        return readConfig();
    }

    getSemaphore() {
        if (!this.semaphore) {
            this.semaphore = new Semaphore(this.config.maxConnections);
        }
        return this.semaphore;
    }

    assertConfigured() {
        const { masterUser, masterPass } = this.config;
        if (!masterUser || !masterPass) {
            throw new Error(
                "IMAP master user is not configured. Set IMAP_MASTER_USER and IMAP_MASTER_PASS, or enable USE_MOCK_DATA for local development."
            );
        }
    }

    buildLoginUser(mailbox) {
        const { masterUser, separator } = this.config;
        return `${mailbox}${separator}${masterUser}`;
    }

    async connect(mailbox) {
        this.assertConfigured();
        const config = this.config;

        const raw = new Imap({
            user: this.buildLoginUser(mailbox),
            password: config.masterPass,
            host: config.host,
            port: config.port,
            tls: config.tls,
            tlsOptions: config.tls ? config.tlsOptions : undefined,
            connTimeout: config.connTimeout,
            authTimeout: config.authTimeout,
            keepalive: true,
        });

        // Guarantee an error listener exists for the whole socket lifetime.
        raw.on("error", () => {});

        await new Promise((resolve, reject) => {
            const onReady = () => {
                raw.removeListener("error", onError);
                resolve();
            };
            const onError = (err) => {
                raw.removeListener("ready", onReady);
                reject(
                    new Error(
                        `IMAP connection failed for ${mailbox}: ${err.message}`
                    )
                );
            };

            raw.once("ready", onReady);
            raw.once("error", onError);
            raw.connect();
        });

        return new ImapClient(raw, mailbox);
    }

    takeIdle(mailbox) {
        const entries = this.idle.get(mailbox);
        if (!entries || entries.length === 0) return null;

        while (entries.length > 0) {
            const entry = entries.pop();
            clearTimeout(entry.timer);
            if (entry.client.usable) return entry.client;
            entry.client.destroy();
            this.getSemaphore().release();
        }

        return null;
    }

    async acquire(mailbox) {
        const reused = this.takeIdle(mailbox);
        if (reused) return reused;

        await this.getSemaphore().acquire(this.config.acquireTimeoutMs);

        try {
            return await this.connect(mailbox);
        } catch (error) {
            this.getSemaphore().release();
            throw error;
        }
    }

    release(client, { discard = false } = {}) {
        if (discard || !client.usable) {
            client.destroy();
            this.getSemaphore().release();
            return;
        }

        const entries = this.idle.get(client.mailbox) || [];
        const entry = { client, timer: null };
        entry.timer = setTimeout(() => {
            const list = this.idle.get(client.mailbox) || [];
            const index = list.indexOf(entry);
            if (index !== -1) list.splice(index, 1);
            client.destroy();
            this.getSemaphore().release();
        }, this.config.idleTtlMs);

        if (entry.timer.unref) entry.timer.unref();

        entries.push(entry);
        this.idle.set(client.mailbox, entries);
    }

    async withMailbox(mailbox, fn) {
        if (!mailbox) throw new Error("A mailbox address is required");

        const client = await this.acquire(mailbox);
        let failed = false;

        try {
            return await fn(client);
        } catch (error) {
            failed = true;
            throw error;
        } finally {
            this.release(client, { discard: failed });
        }
    }

    stats() {
        let idleCount = 0;
        for (const entries of this.idle.values()) idleCount += entries.length;
        const semaphore = this.getSemaphore();
        return {
            active: semaphore.active,
            idle: idleCount,
            waiting: semaphore.waiters.length,
            max: semaphore.max,
        };
    }

    shutdown() {
        for (const entries of this.idle.values()) {
            for (const entry of entries) {
                clearTimeout(entry.timer);
                entry.client.destroy();
            }
        }
        this.idle.clear();
        this.semaphore = null;
    }
}

const pool = new ImapPool();

module.exports = {
    pool,
    ImapClient,
    Semaphore,
    withMailbox: (mailbox, fn) => pool.withMailbox(mailbox, fn),
    readConfig,
    resetConfigCache,
};
