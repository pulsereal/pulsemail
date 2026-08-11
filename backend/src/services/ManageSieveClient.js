const net = require("net");
const tls = require("tls");

/**
 * Minimal ManageSieve client (RFC 5804) for Dovecot's Pigeonhole service.
 *
 * Authenticates with the same master-user credentials as IMAP: SASL PLAIN
 * carries the target mailbox as the authorization identity and the master user
 * as the authentication identity, so no per-user password is ever needed.
 */
class ManageSieveClient {
    constructor(config) {
        this.config = config;
        this.socket = null;
        this.buffer = "";
        this.pending = null;
    }

    static config() {
        const intFromEnv = (name, fallback) => {
            const parsed = parseInt(process.env[name], 10);
            return Number.isFinite(parsed) ? parsed : fallback;
        };

        return {
            host: process.env.SIEVE_HOST || process.env.IMAP_HOST || "localhost",
            port: intFromEnv("SIEVE_PORT", 4190),
            tls: process.env.SIEVE_SECURE === "true",
            startTls: process.env.SIEVE_STARTTLS !== "false",
            rejectUnauthorized:
                process.env.SIEVE_TLS_REJECT_UNAUTHORIZED !== "false",
            masterUser:
                process.env.SIEVE_MASTER_USER ||
                process.env.IMAP_MASTER_USER ||
                "",
            masterPass:
                process.env.SIEVE_MASTER_PASS ||
                process.env.IMAP_MASTER_PASS ||
                "",
            timeoutMs: intFromEnv("SIEVE_TIMEOUT_MS", 15000),
        };
    }

    #attach(socket) {
        this.socket = socket;
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => {
            this.buffer += chunk;
            this.#drain();
        });
        socket.on("error", (error) => this.#fail(error));
        socket.on("close", () =>
            this.#fail(new Error("ManageSieve connection closed"))
        );
    }

    #fail(error) {
        if (this.pending) {
            const { reject, timer } = this.pending;
            clearTimeout(timer);
            this.pending = null;
            reject(error);
        }
    }

    /**
     * A response ends with a line beginning OK, NO or BYE. Everything before it
     * is data (capabilities, script listings, or a literal script body).
     */
    #drain() {
        if (!this.pending) return;

        const match = this.buffer.match(/^(OK|NO|BYE)(?:[ \t].*)?\r\n/m);
        if (!match) return;

        const end = this.buffer.indexOf(match[0]) + match[0].length;
        const raw = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end);

        const { resolve, reject, timer } = this.pending;
        clearTimeout(timer);
        this.pending = null;

        if (match[1] === "OK") {
            resolve(raw);
        } else {
            const reason = raw.trim().replace(/^(NO|BYE)\s*/, "");
            reject(new Error(`ManageSieve rejected the command: ${reason}`));
        }
    }

    #send(command) {
        return new Promise((resolve, reject) => {
            if (this.pending) {
                reject(new Error("A ManageSieve command is already in flight"));
                return;
            }

            const timer = setTimeout(
                () =>
                    this.#fail(
                        new Error(
                            `ManageSieve timed out after ${this.config.timeoutMs}ms`
                        )
                    ),
                this.config.timeoutMs
            );

            this.pending = { resolve, reject, timer };
            if (command !== null) this.socket.write(command);
            this.#drain();
        });
    }

    async connect(mailbox) {
        const { host, port, timeoutMs } = this.config;

        const socket = await new Promise((resolve, reject) => {
            const connection = this.config.tls
                ? tls.connect({
                      host,
                      port,
                      rejectUnauthorized: this.config.rejectUnauthorized,
                  })
                : net.connect({ host, port });

            const onError = (error) => reject(error);
            connection.setTimeout(timeoutMs, () =>
                reject(new Error("ManageSieve connection timed out"))
            );
            connection.once("error", onError);
            connection.once(this.config.tls ? "secureConnect" : "connect", () => {
                connection.removeListener("error", onError);
                resolve(connection);
            });
        });

        this.#attach(socket);

        // Greeting arrives unprompted
        const greeting = await this.#send(null);

        if (!this.config.tls && this.config.startTls && /"STARTTLS"/i.test(greeting)) {
            await this.#send("STARTTLS\r\n");
            const secure = await new Promise((resolve, reject) => {
                const upgraded = tls.connect(
                    {
                        socket,
                        rejectUnauthorized: this.config.rejectUnauthorized,
                        servername: host,
                    },
                    () => resolve(upgraded)
                );
                upgraded.once("error", reject);
            });

            this.buffer = "";
            this.#attach(secure);
            await this.#send(null); // capabilities are re-sent after TLS
        }

        await this.#authenticate(mailbox);
        return this;
    }

    #authenticate(mailbox) {
        const { masterUser, masterPass } = this.config;

        if (!masterUser || !masterPass) {
            throw new Error(
                "Sieve master user is not configured. Set SIEVE_MASTER_USER/SIEVE_MASTER_PASS or reuse IMAP_MASTER_*."
            );
        }

        // authzid = who we act as, authcid = who proves the password
        const token = Buffer.from(
            `${mailbox}\0${masterUser}\0${masterPass}`,
            "utf8"
        ).toString("base64");

        return this.#send(`AUTHENTICATE "PLAIN" "${token}"\r\n`);
    }

    async listScripts() {
        const response = await this.#send("LISTSCRIPTS\r\n");

        return response
            .split("\r\n")
            .filter((line) => line.startsWith('"'))
            .map((line) => {
                const name = line.match(/^"((?:[^"\\]|\\.)*)"/)?.[1] || "";
                return { name, active: /\bACTIVE\b/i.test(line) };
            });
    }

    async getScript(name) {
        const response = await this.#send(`GETSCRIPT "${name}"\r\n`);
        const literal = response.match(/\{(\d+)\+?\}\r\n/);
        if (!literal) return "";

        const start = response.indexOf(literal[0]) + literal[0].length;
        return response.slice(start, start + parseInt(literal[1], 10));
    }

    putScript(name, content) {
        const payload = Buffer.byteLength(content, "utf8");
        return this.#send(
            `PUTSCRIPT "${name}" {${payload}+}\r\n${content}\r\n`
        );
    }

    setActive(name) {
        return this.#send(`SETACTIVE "${name}"\r\n`);
    }

    deleteScript(name) {
        return this.#send(`DELETESCRIPT "${name}"\r\n`);
    }

    async logout() {
        try {
            await this.#send("LOGOUT\r\n");
        } catch (error) {
            // The server closes the socket on LOGOUT; nothing to recover.
        } finally {
            this.socket?.destroy();
            this.socket = null;
        }
    }
}

/**
 * Run `fn` against an authenticated ManageSieve session for `mailbox`.
 */
const withSieve = async (mailbox, fn) => {
    const client = new ManageSieveClient(ManageSieveClient.config());
    await client.connect(mailbox);
    try {
        return await fn(client);
    } finally {
        await client.logout();
    }
};

module.exports = { ManageSieveClient, withSieve };
