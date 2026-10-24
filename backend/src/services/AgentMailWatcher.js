const { query } = require("../config/database");
const { mailService } = require("./MailService");
const AgentService = require("./AgentService");
const { toAgentEmail, PAYLOAD_MAX_BODY_CHARS } = require("./AgentService");
const { mapWithConcurrency } = require("../utils/concurrency");

// Turns newly arrived INBOX mail into `email.received` deliveries for every
// agent whose scope covers the mailbox.
//
// Arrival is detected by comparing the folder's UIDNEXT with a stored cursor,
// so a quiet mailbox costs one SELECT per cycle and nothing else. A mailbox
// seen for the first time, or one whose UIDVALIDITY changed, has its cursor
// set to the present: agents receive mail from that point on, never a replay
// of history.

const intFromEnv = (name, fallback) => {
    const parsed = parseInt(process.env[name], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const CYCLE_MS = intFromEnv("AGENT_POLL_INTERVAL_MS", 60_000);
const MAILBOXES_PER_CYCLE = intFromEnv("AGENT_MAILBOXES_PER_CYCLE", 50);
const MAX_PER_MAILBOX = intFromEnv("AGENT_MAX_MESSAGES_PER_MAILBOX", 25);
const CONCURRENCY = 4;
const FOLDER = "INBOX";

class AgentMailWatcher {
    #timer = null;
    #running = false;
    #cursor = 0;
    #agents = AgentService.shared();
    #lastRun = null;
    #lastError = null;

    static shared() {
        if (!AgentMailWatcher.instance) {
            AgentMailWatcher.instance = new AgentMailWatcher();
        }
        return AgentMailWatcher.instance;
    }

    start() {
        if (this.#timer) return;

        this.#timer = setInterval(() => {
            this.runCycle().catch((error) => {
                this.#lastError = error.message;
                console.error("Agent mail watch cycle failed:", error.message);
            });
        }, CYCLE_MS);

        this.#timer.unref?.();
        console.log(
            `🤖 Agent mail watcher scheduled every ${Math.round(CYCLE_MS / 1000)}s`
        );
    }

    stop() {
        if (!this.#timer) return;
        clearInterval(this.#timer);
        this.#timer = null;
    }

    status() {
        return {
            scheduled: Boolean(this.#timer),
            running: this.#running,
            intervalMs: CYCLE_MS,
            lastRun: this.#lastRun,
            lastError: this.#lastError,
        };
    }

    async runCycle({ mailboxes: only = null } = {}) {
        if (this.#running) return { skipped: "already running" };
        this.#running = true;

        try {
            const all =
                only || (await this.#agents.watchedMailboxes("email.received"));
            if (all.length === 0) return { mailboxes: 0, queued: 0 };

            const slice = only
                ? all
                : Array.from(
                      { length: Math.min(MAILBOXES_PER_CYCLE, all.length) },
                      (_, i) => all[(this.#cursor + i) % all.length]
                  );
            if (!only)
                this.#cursor = (this.#cursor + slice.length) % all.length;

            const outcomes = await mapWithConcurrency(
                slice,
                CONCURRENCY,
                (mailbox) => this.#scanMailbox(mailbox)
            );

            const summary = { mailboxes: slice.length, queued: 0, errors: [] };
            outcomes.forEach((outcome, index) => {
                if (outcome.status === "ok") summary.queued += outcome.value;
                else
                    summary.errors.push({
                        mailbox: slice[index],
                        error: outcome.error,
                    });
            });

            this.#lastRun = new Date().toISOString();
            this.#lastError = summary.errors[0]?.error ?? null;
            return summary;
        } finally {
            this.#running = false;
        }
    }

    async #readCursor(mailbox) {
        const result = await query(
            `SELECT uidvalidity, last_uid FROM agent_mail_cursors
              WHERE mailbox = $1 AND folder = $2`,
            [mailbox, FOLDER]
        );
        const row = result.rows[0];
        return row
            ? {
                  uidvalidity: Number(row.uidvalidity),
                  lastUid: Number(row.last_uid),
              }
            : null;
    }

    async #writeCursor(mailbox, uidvalidity, lastUid) {
        await query(
            `INSERT INTO agent_mail_cursors (mailbox, folder, uidvalidity, last_uid, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (mailbox, folder) DO UPDATE
               SET uidvalidity = EXCLUDED.uidvalidity,
                   last_uid = EXCLUDED.last_uid,
                   updated_at = NOW()`,
            [mailbox, FOLDER, uidvalidity, lastUid]
        );
    }

    async #scanMailbox(mailbox) {
        const status = await mailService.getFolderStatus(mailbox, FOLDER);
        const uidvalidity = Number(status?.uidvalidity ?? 0);
        const uidnext = Number(status?.uidnext ?? 0);
        const cursor = await this.#readCursor(mailbox);

        if (!cursor || cursor.uidvalidity !== uidvalidity) {
            let present = uidnext > 0 ? uidnext - 1 : 0;
            if (uidnext <= 0) {
                const uids = await mailService.getUidsSince(mailbox, FOLDER, 0);
                present = uids.length ? uids[uids.length - 1] : 0;
            }
            await this.#writeCursor(mailbox, uidvalidity, present);
            return 0;
        }

        if (uidnext > 0 && uidnext - 1 <= cursor.lastUid) return 0;

        const uids = (
            await mailService.getUidsSince(mailbox, FOLDER, cursor.lastUid)
        ).slice(0, MAX_PER_MAILBOX);
        if (uids.length === 0) return 0;

        let queued = 0;
        for (const uid of uids) {
            const content = await mailService.getEmailContent(
                mailbox,
                String(uid),
                FOLDER
            );
            if (content) {
                queued += await this.#agents.publish(
                    "email.received",
                    mailbox,
                    {
                        email: toAgentEmail(content, {
                            maxBodyChars: PAYLOAD_MAX_BODY_CHARS,
                            uidvalidity,
                        }),
                    },
                    `${FOLDER}:${uidvalidity}:${uid}`
                );
            }
            await this.#writeCursor(mailbox, uidvalidity, uid);
        }

        return queued;
    }
}

module.exports = AgentMailWatcher;
