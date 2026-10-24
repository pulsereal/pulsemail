const crypto = require("crypto");
const { query } = require("../config/database");
const AgentService = require("./AgentService");
const { assertSafeWebhookUrl } = require("./AgentService");
const { mapWithConcurrency } = require("../utils/concurrency");

// Drains agent_deliveries into agents' webhook URLs.
//
// Every request is signed so the receiver can prove it came from us and is
// fresh: X-Pulsemail-Signature is "sha256=" + HMAC-SHA256(secret,
// "<X-Pulsemail-Timestamp>.<raw body>"). Receivers should recompute it over
// the raw bytes and reject timestamps more than a few minutes old.
//
// Any 2xx is success. Anything else, including a redirect (never followed, so
// a public URL cannot bounce us into the internal network), is retried on a
// widening backoff until AGENT_WEBHOOK_MAX_ATTEMPTS is reached.

const intFromEnv = (name, fallback) => {
    const parsed = parseInt(process.env[name], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const TICK_MS = 15_000;
const KICK_DELAY_MS = 250;
const BATCH_SIZE = 25;
const CONCURRENCY = 5;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const RETENTION_DAYS = 30;
const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000];
const MAX_ATTEMPTS = intFromEnv("AGENT_WEBHOOK_MAX_ATTEMPTS", 6);
const TIMEOUT_MS = intFromEnv("AGENT_WEBHOOK_TIMEOUT_MS", 10_000);
const USER_AGENT = "Pulsemail-Webhooks/1.0";

const sign = (secret, timestamp, body) =>
    crypto
        .createHmac("sha256", secret)
        .update(`${timestamp}.${body}`)
        .digest("hex");

/** Reads at most `limit` bytes of an error response, then drops the rest. */
const readSnippet = async (response, limit = 300) => {
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (size < limit) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(Buffer.from(value));
            size += value.length;
        }
    } catch {
        // A truncated snippet is still useful.
    } finally {
        reader.cancel().catch(() => {});
    }
    return Buffer.concat(chunks).toString("utf8").slice(0, limit).trim();
};

class WebhookDispatcher {
    #timer = null;
    #kick = null;
    #draining = false;
    #again = false;
    #lastPrune = 0;
    #agents = AgentService.shared();

    static shared() {
        if (!WebhookDispatcher.instance) {
            WebhookDispatcher.instance = new WebhookDispatcher();
        }
        return WebhookDispatcher.instance;
    }

    #onEnqueued = () => {
        if (this.#kick) return;
        this.#kick = setTimeout(() => {
            this.#kick = null;
            this.drain().catch((error) =>
                console.error("Webhook drain failed:", error.message)
            );
        }, KICK_DELAY_MS);
        this.#kick.unref?.();
    };

    start() {
        if (this.#timer) return;

        this.#agents.on("enqueued", this.#onEnqueued);
        this.#timer = setInterval(() => {
            this.drain().catch((error) =>
                console.error("Webhook drain failed:", error.message)
            );
        }, TICK_MS);
        this.#timer.unref?.();
    }

    stop() {
        if (!this.#timer) return;
        clearInterval(this.#timer);
        this.#timer = null;
        this.#agents.off("enqueued", this.#onEnqueued);
    }

    async drain() {
        if (this.#draining) {
            this.#again = true;
            return { skipped: "already draining" };
        }

        this.#draining = true;
        const summary = { delivered: 0, failed: 0 };

        try {
            do {
                this.#again = false;
                const due = await query(
                    `SELECT d.*, a.webhook_url, a.signing_secret_encrypted,
                            a.active AS agent_active
                       FROM agent_deliveries d
                       JOIN agents a ON a.id = d.agent_id
                      WHERE d.status = 'pending' AND d.next_attempt_at <= NOW()
                      ORDER BY d.next_attempt_at, d.id
                      LIMIT $1`,
                    [BATCH_SIZE]
                );

                const outcomes = await mapWithConcurrency(
                    due.rows,
                    CONCURRENCY,
                    (row) => this.#attempt(row)
                );
                for (const outcome of outcomes) {
                    if (outcome.status === "ok" && outcome.value)
                        summary.delivered += 1;
                    else summary.failed += 1;
                }

                if (due.rows.length === BATCH_SIZE) this.#again = true;
            } while (this.#again);

            await this.#prune();
            return summary;
        } finally {
            this.#draining = false;
        }
    }

    async #prune() {
        if (Date.now() - this.#lastPrune < PRUNE_EVERY_MS) return;
        this.#lastPrune = Date.now();
        await query(
            `DELETE FROM agent_deliveries
              WHERE status <> 'pending'
                AND created_at < NOW() - ($1::int * INTERVAL '1 day')`,
            [RETENTION_DAYS]
        ).catch((error) =>
            console.error("Failed to prune webhook deliveries:", error.message)
        );
    }

    #envelope(row) {
        return {
            id: `dlv_${row.id}`,
            event: row.event,
            created_at: new Date(row.created_at).toISOString(),
            agent_id: row.agent_id,
            mailbox: row.mailbox || null,
            domain: row.mailbox ? row.mailbox.split("@")[1] : null,
            ...(row.payload || {}),
        };
    }

    async #attempt(row) {
        const attempts = row.attempts + 1;

        const result =
            row.agent_active && row.webhook_url
                ? await this.#post({
                      url: row.webhook_url,
                      secret: this.#agents.signingSecret(row),
                      event: row.event,
                      deliveryId: `dlv_${row.id}`,
                      envelope: this.#envelope(row),
                  })
                : {
                      ok: false,
                      final: true,
                      statusCode: null,
                      error: "Agent is disabled or has no webhook URL",
                  };

        if (result.ok) {
            await query(
                `UPDATE agent_deliveries
                    SET status = 'delivered', attempts = $2, delivered_at = NOW(),
                        last_status_code = $3, last_error = NULL
                  WHERE id = $1`,
                [row.id, attempts, result.statusCode]
            );
            return true;
        }

        const exhausted = result.final || attempts >= MAX_ATTEMPTS;
        const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];

        await query(
            `UPDATE agent_deliveries
                SET status = $2, attempts = $3,
                    next_attempt_at = NOW() + ($4::int * INTERVAL '1 millisecond'),
                    last_status_code = $5, last_error = $6
              WHERE id = $1`,
            [
                row.id,
                exhausted ? "failed" : "pending",
                attempts,
                delay,
                result.statusCode,
                String(result.error || "").slice(0, 500),
            ]
        );
        return false;
    }

    async #post({ url, secret, event, deliveryId, envelope }) {
        const started = Date.now();
        const done = (fields) => ({
            durationMs: Date.now() - started,
            ...fields,
        });

        if (!secret) {
            return done({
                ok: false,
                final: true,
                statusCode: null,
                error: "Signing secret cannot be decrypted; rotate it in the admin panel",
            });
        }

        try {
            await assertSafeWebhookUrl(url);

            const body = JSON.stringify(envelope);
            const timestamp = Math.floor(Date.now() / 1000);

            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": USER_AGENT,
                    "X-Pulsemail-Event": event,
                    "X-Pulsemail-Delivery": deliveryId,
                    "X-Pulsemail-Timestamp": String(timestamp),
                    "X-Pulsemail-Signature": `sha256=${sign(secret, timestamp, body)}`,
                },
                body,
                redirect: "manual",
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });

            if (response.status >= 200 && response.status < 300) {
                response.body?.cancel().catch(() => {});
                return done({
                    ok: true,
                    statusCode: response.status,
                    error: null,
                });
            }

            const snippet = await readSnippet(response);
            const redirect =
                response.status >= 300 && response.status < 400
                    ? " (redirects are not followed)"
                    : "";
            return done({
                ok: false,
                statusCode: response.status,
                error: `HTTP ${response.status}${redirect}${snippet ? `: ${snippet}` : ""}`,
            });
        } catch (error) {
            return done({
                ok: false,
                statusCode: null,
                error:
                    error.name === "TimeoutError"
                        ? `Timed out after ${TIMEOUT_MS}ms`
                        : error.cause?.message || error.message,
            });
        }
    }

    /** One synchronous, unrecorded request so an admin can check the endpoint. */
    async ping(agentRow) {
        if (!agentRow.webhook_url) {
            return {
                ok: false,
                statusCode: null,
                error: "No webhook URL configured",
            };
        }

        const id = `ping_${crypto.randomBytes(6).toString("hex")}`;
        const { final, ...result } = await this.#post({
            url: agentRow.webhook_url,
            secret: this.#agents.signingSecret(agentRow),
            event: "ping",
            deliveryId: id,
            envelope: {
                id,
                event: "ping",
                created_at: new Date().toISOString(),
                agent_id: agentRow.id,
                mailbox: null,
                domain: null,
                message: `Test delivery for agent "${agentRow.name}"`,
            },
        });
        return result;
    }
}

module.exports = WebhookDispatcher;
module.exports.sign = sign;
