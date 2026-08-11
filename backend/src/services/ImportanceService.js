const { query } = require("../config/database");
const { mailService } = require("../services/MailService");
const LLMSettingsService = require("./LLMSettingsService");

// Scores inbox mail for importance so the client can show a priority view.
//
// Classification never happens inside a user-facing request. The route reads
// whatever scores already exist and returns immediately; a background pass
// fills in the gaps in batches. That keeps page loads at IMAP speed and keeps
// the number of LLM calls proportional to new mail rather than to page views.

const CATEGORIES = [
    "important",
    "work",
    "personal",
    "promotional",
    "social",
    "automated",
    "spam",
    "other",
];

const FEATURE = "classification";

/** Stable across folder moves and UIDVALIDITY resets; falls back to a locator. */
const messageKey = (item, folder, uidvalidity) =>
    item.messageId
        ? item.messageId.slice(0, 512)
        : `loc:${folder}:${uidvalidity}:${item.uid}`;

const clampScore = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(100, Math.max(0, Math.round(number)));
};

const normalizeCategory = (value) => {
    const category = String(value || "")
        .trim()
        .toLowerCase();
    return CATEGORIES.includes(category) ? category : "other";
};

/**
 * Models wrap JSON in prose or fences often enough that a bare JSON.parse is
 * not dependable, so fall back to the outermost array or object in the reply.
 */
const parseJsonReply = (content) => {
    if (!content) return null;

    const cleaned = content
        .trim()
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/, "")
        .trim();

    try {
        return JSON.parse(cleaned);
    } catch {
        const match = cleaned.match(/[[{][\s\S]*[\]}]/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]);
        } catch {
            return null;
        }
    }
};

const buildSystemPrompt = (customInstructions) => {
    const base = `You triage a person's email inbox. For each message you receive, judge how much it needs that person's attention.

Score importance from 0 to 100:
  90-100  needs action now: outages, security alerts, hard deadlines today, a direct question from a manager or customer awaiting reply
  70-89   important: addressed personally, expects a response, money, contracts, travel, legal, account security
  40-69   useful but not urgent: team discussion the person is copied on, scheduled reports they rely on
  10-39   low: newsletters, marketing, social notifications, automated receipts
  0-9     noise: bulk advertising, obvious spam

Weigh these signals: is the person addressed directly or merely copied; does the sender appear to be a human colleague or an automated system; is a reply or a deadline requested; is money, access or security involved. Marketing language, unsubscribe links and no-reply senders push the score down however urgent the wording claims to be.

Assign one category from: ${CATEGORIES.join(", ")}.

Reply with a JSON array and nothing else. One object per message, in the order given:
[{"id": "<the id given>", "importance": <0-100>, "category": "<category>", "reason": "<at most 12 words>"}]`;

    return customInstructions?.trim()
        ? `${base}\n\nAdditional instructions from the administrator, which take precedence:\n${customInstructions.trim()}`
        : base;
};

const buildUserPrompt = (mailbox, entries) => {
    const messages = entries.map((entry, index) => ({
        id: String(index),
        from: entry.from || "",
        to: entry.to || "",
        cc: entry.cc || "",
        subject: entry.subject || "(no subject)",
        date: entry.date || "",
        body: entry.snippet || "",
    }));

    return `Inbox owner: ${mailbox}\n\nMessages:\n${JSON.stringify(messages, null, 1)}`;
};

class ImportanceService {
    #settings = LLMSettingsService.shared();

    static shared() {
        if (!ImportanceService.instance) {
            ImportanceService.instance = new ImportanceService();
        }
        return ImportanceService.instance;
    }

    /** Stored scores for a page of messages, keyed by uid. */
    async attachStored(mailbox, folder, items, uidvalidity = 0) {
        if (!items || items.length === 0) return items;

        const keys = items.map((item) => messageKey(item, folder, uidvalidity));

        let rows = [];
        try {
            const result = await query(
                `SELECT message_key, category, importance, reason, pinned
                   FROM email_classifications
                  WHERE user_email = $1 AND message_key = ANY($2::text[])`,
                [mailbox, keys]
            );
            rows = result.rows;
        } catch {
            return items;
        }

        const byKey = new Map(rows.map((row) => [row.message_key, row]));
        const threshold = (await this.#settings.get()).importance_threshold;

        items.forEach((item, index) => {
            const row = byKey.get(keys[index]);
            if (!row) return;

            item.category = row.category;
            item.importance = row.importance;
            item.importanceReason = row.reason;
            item.priority = row.importance >= threshold;
        });

        return items;
    }

    /** UIDs in a folder at or above the importance threshold, newest first. */
    async priorityUids(mailbox, folder, uidvalidity, { limit, offset }) {
        const settings = await this.#settings.get();

        const rows = await query(
            `SELECT uid FROM email_classifications
              WHERE user_email = $1 AND folder = $2 AND uidvalidity = $3
                AND importance >= $4
              ORDER BY message_date DESC NULLS LAST, uid DESC
              LIMIT $5 OFFSET $6`,
            [
                mailbox,
                folder,
                uidvalidity,
                settings.importance_threshold,
                limit,
                offset,
            ]
        );

        const total = await query(
            `SELECT COUNT(*)::int AS n FROM email_classifications
              WHERE user_email = $1 AND folder = $2 AND uidvalidity = $3
                AND importance >= $4`,
            [mailbox, folder, uidvalidity, settings.importance_threshold]
        );

        return {
            uids: rows.rows.map((row) => Number(row.uid)),
            total: total.rows[0]?.n ?? 0,
        };
    }

    /** Messages on this page that have never been scored. */
    async unscored(mailbox, folder, items, uidvalidity = 0) {
        if (!items || items.length === 0) return [];

        const keys = items.map((item) => messageKey(item, folder, uidvalidity));
        const result = await query(
            `SELECT message_key FROM email_classifications
              WHERE user_email = $1 AND message_key = ANY($2::text[])`,
            [mailbox, keys]
        );

        const known = new Set(result.rows.map((row) => row.message_key));
        return items.filter(
            (item, index) => !known.has(keys[index])
        );
    }

    /**
     * Scores a batch in one request and persists the result. Returns the number
     * of messages scored, which is zero whenever the feature is off, the cap is
     * spent, or the endpoint failed.
     */
    async classifyBatch(mailbox, folder, items, uidvalidity = 0) {
        if (!items || items.length === 0) return 0;

        const settings = await this.#settings.get();
        if (!settings.enabled || !settings.classify_enabled) return 0;

        const client = await this.#settings.client();
        if (!client) return 0;

        if (settings.daily_limit > 0) {
            const used = await this.#settings.messagesToday(FEATURE);
            if (used >= settings.daily_limit) return 0;
        }

        let snippets = new Map();
        if (settings.snippet_chars > 0) {
            snippets = await mailService
                .getSnippets(
                    mailbox,
                    folder,
                    items.map((item) => item.uid),
                    settings.snippet_chars
                )
                .catch(() => new Map());
        }

        const entries = items.map((item) => ({
            ...item,
            snippet: snippets.get(item.uid) || "",
        }));

        let response;
        try {
            response = await client.chat.completions.create({
                model: settings.model,
                messages: [
                    {
                        role: "system",
                        content: buildSystemPrompt(settings.custom_instructions),
                    },
                    { role: "user", content: buildUserPrompt(mailbox, entries) },
                ],
                temperature: 0,
                max_tokens: 60 * entries.length + 100,
            });
        } catch (error) {
            console.error("Importance classification failed:", error.message);
            await this.#settings.recordUsage(FEATURE, {
                requests: 1,
                errors: 1,
            });
            return 0;
        }

        const parsed = parseJsonReply(
            response.choices?.[0]?.message?.content || ""
        );
        const verdicts = Array.isArray(parsed) ? parsed : parsed?.messages;

        if (!Array.isArray(verdicts)) {
            console.error("Importance classifier returned unusable output");
            await this.#settings.recordUsage(FEATURE, {
                requests: 1,
                errors: 1,
                usage: response.usage,
            });
            return 0;
        }

        // Index by the id we handed out, falling back to position so a model
        // that drops the id field still produces usable results.
        const byId = new Map();
        verdicts.forEach((verdict, index) => {
            const id = verdict?.id !== undefined ? String(verdict.id) : String(index);
            byId.set(id, verdict);
        });

        let stored = 0;
        for (const [index, item] of entries.entries()) {
            const verdict = byId.get(String(index));
            if (!verdict) continue;

            await this.#store(mailbox, folder, uidvalidity, item, {
                importance: clampScore(verdict.importance),
                category: normalizeCategory(verdict.category),
                reason:
                    typeof verdict.reason === "string"
                        ? verdict.reason.slice(0, 200)
                        : null,
                model: settings.model,
                method: "llm",
            });
            stored += 1;
        }

        await this.#settings.recordUsage(FEATURE, {
            requests: 1,
            messages: stored,
            usage: response.usage,
        });

        return stored;
    }

    /**
     * A user correction. Pinned rows are never overwritten by the classifier,
     * so an explicit judgement survives a later re-scan.
     */
    async setManual(mailbox, folder, item, { importance, category }) {
        return this.#store(
            mailbox,
            folder,
            item.uidvalidity ?? 0,
            item,
            {
                importance: clampScore(importance),
                category: normalizeCategory(category || "other"),
                reason: "Set by the mailbox owner",
                model: null,
                method: "manual",
            },
            true
        );
    }

    async #store(mailbox, folder, uidvalidity, item, verdict, pinned = false) {
        await query(
            `INSERT INTO email_classifications
               (user_email, message_key, folder, uid, uidvalidity, category,
                importance, reason, model, method, pinned, message_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (user_email, message_key) DO UPDATE SET
               folder = EXCLUDED.folder,
               uid = EXCLUDED.uid,
               uidvalidity = EXCLUDED.uidvalidity,
               message_date = EXCLUDED.message_date,
               category = CASE WHEN email_classifications.pinned
                               THEN email_classifications.category
                               ELSE EXCLUDED.category END,
               importance = CASE WHEN email_classifications.pinned
                                 THEN email_classifications.importance
                                 ELSE EXCLUDED.importance END,
               reason = CASE WHEN email_classifications.pinned
                             THEN email_classifications.reason
                             ELSE EXCLUDED.reason END,
               model = EXCLUDED.model,
               method = CASE WHEN email_classifications.pinned
                             THEN email_classifications.method
                             ELSE EXCLUDED.method END,
               pinned = email_classifications.pinned OR EXCLUDED.pinned,
               updated_at = NOW()`,
            [
                mailbox,
                messageKey(item, folder, uidvalidity),
                folder,
                item.uid,
                uidvalidity,
                verdict.category,
                verdict.importance,
                verdict.reason,
                verdict.model,
                verdict.method,
                pinned,
                item.date || null,
            ]
        );
    }

    async stats(mailbox = null) {
        const scope = mailbox ? "WHERE user_email = $1" : "";
        const params = mailbox ? [mailbox] : [];

        const result = await query(
            `SELECT COUNT(*)::int AS classified,
                    COUNT(*) FILTER (WHERE importance >= 70)::int AS important,
                    COUNT(DISTINCT user_email)::int AS mailboxes,
                    MAX(updated_at) AS last_run
               FROM email_classifications ${scope}`,
            params
        );

        return result.rows[0];
    }
}

module.exports = { ImportanceService, CATEGORIES, messageKey };
