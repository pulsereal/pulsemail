const { mailQuery } = require("../config/database");
const { mailService } = require("./MailService");
const LLMSettingsService = require("./LLMSettingsService");
const { ImportanceService } = require("./ImportanceService");

// Walks active mailboxes in the background and scores whatever recent inbox
// mail has not been seen yet. Runs on an interval rather than in request
// handlers, so a slow or unreachable LLM endpoint can never delay the UI.
//
// Two things bound the work: the administrator's daily message cap, and a
// per-cycle mailbox budget. Mailboxes are visited round-robin so a single busy
// inbox cannot starve the rest.

const CYCLE_MS = Number(process.env.CLASSIFY_INTERVAL_MS || 5 * 60 * 1000);
const MAILBOXES_PER_CYCLE = Number(process.env.CLASSIFY_MAILBOXES_PER_CYCLE || 5);
const SCAN_DEPTH = Number(process.env.CLASSIFY_SCAN_DEPTH || 100);

class ClassificationWorker {
    #timer = null;
    #running = false;
    #cursor = 0;
    #settings = LLMSettingsService.shared();
    #importance = ImportanceService.shared();
    #lastRun = null;
    #lastError = null;

    static shared() {
        if (!ClassificationWorker.instance) {
            ClassificationWorker.instance = new ClassificationWorker();
        }
        return ClassificationWorker.instance;
    }

    start() {
        if (this.#timer) return;

        this.#timer = setInterval(() => {
            this.runCycle().catch((error) => {
                this.#lastError = error.message;
                console.error("Classification cycle failed:", error.message);
            });
        }, CYCLE_MS);

        this.#timer.unref?.();
        console.log(
            `🧠 Importance classifier scheduled every ${Math.round(CYCLE_MS / 1000)}s`
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

    async #activeMailboxes() {
        const result = await mailQuery(
            `SELECT username FROM mailbox
              WHERE active = 1 AND enablesieve = 1
              ORDER BY username`
        ).catch(() =>
            mailQuery(`SELECT username FROM mailbox WHERE active = 1 ORDER BY username`)
        );

        return result.rows.map((row) => row.username);
    }

    /**
     * One pass. Returns a summary so the admin panel can show what happened
     * and so a manual "run now" can report back.
     */
    async runCycle({ mailboxes: only = null, force = false } = {}) {
        if (this.#running) return { skipped: "already running" };

        const settings = await this.#settings.get();
        if (!force && !(settings.enabled && settings.classify_enabled)) {
            return { skipped: "classification is disabled" };
        }

        let budget = Infinity;
        if (settings.daily_limit > 0) {
            const used = await this.#settings.messagesToday("classification");
            budget = settings.daily_limit - used;
            if (budget <= 0) return { skipped: "daily limit reached" };
        }

        this.#running = true;
        const summary = { mailboxes: 0, scored: 0, skipped: null };

        try {
            const all = only || (await this.#activeMailboxes());
            if (all.length === 0) return { ...summary, skipped: "no mailboxes" };

            const slice = only
                ? all
                : Array.from({ length: Math.min(MAILBOXES_PER_CYCLE, all.length) }, (_, i) =>
                      all[(this.#cursor + i) % all.length]
                  );

            if (!only) {
                this.#cursor = (this.#cursor + slice.length) % all.length;
            }

            for (const mailbox of slice) {
                if (budget <= 0) break;

                const scored = await this.#scanMailbox(
                    mailbox,
                    settings,
                    budget
                ).catch((error) => {
                    console.error(
                        `Classification failed for ${mailbox}:`,
                        error.message
                    );
                    return 0;
                });

                budget -= scored;
                summary.scored += scored;
                summary.mailboxes += 1;
            }

            this.#lastRun = new Date().toISOString();
            this.#lastError = null;
            return summary;
        } finally {
            this.#running = false;
        }
    }

    async #scanMailbox(mailbox, settings, budget) {
        const status = await mailService.getFolderStatus(mailbox, "INBOX");
        const uidvalidity = status?.uidvalidity ?? 0;

        const recent = await mailService.getEmails(
            mailbox,
            "INBOX",
            SCAN_DEPTH,
            0
        );
        if (recent.length === 0) return 0;

        const cutoff = Date.now() - settings.lookback_days * 86_400_000;
        const candidates = recent.filter(
            (item) => !item.date || Date.parse(item.date) >= cutoff
        );

        const pending = await this.#importance.unscored(
            mailbox,
            "INBOX",
            candidates,
            uidvalidity
        );
        if (pending.length === 0) return 0;

        let scored = 0;
        for (let i = 0; i < pending.length; i += settings.batch_size) {
            if (scored >= budget) break;

            const batch = pending.slice(i, i + settings.batch_size);
            scored += await this.#importance.classifyBatch(
                mailbox,
                "INBOX",
                batch,
                uidvalidity
            );
        }

        return scored;
    }
}

module.exports = ClassificationWorker;
