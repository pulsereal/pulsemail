const OpenAI = require("openai");
const { query } = require("../config/database");
const { encryptSecret, decryptSecret, secretHint } = require("../config/secrets");

// Single source of truth for the LLM endpoint. The administrator edits it in
// the admin panel and it lands in the llm_settings table; environment
// variables only seed the first row so existing installs keep working.
//
// Every provider we target speaks the OpenAI chat-completions API, so one
// client with a configurable baseURL covers OpenAI, Azure, OpenRouter, Groq,
// Together, and self-hosted Ollama or vLLM.

const CACHE_MS = 30_000;

const DEFAULTS = {
    enabled: false,
    base_url: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    classify_enabled: false,
    summaries_enabled: false,
    replies_enabled: false,
    importance_threshold: 70,
    snippet_chars: 500,
    batch_size: 10,
    daily_limit: 2000,
    lookback_days: 7,
    custom_instructions: null,
};

// Bounds keep an accidental value in the admin form from turning into a
// runaway bill or a request too large for the endpoint to accept.
const LIMITS = {
    importance_threshold: [0, 100],
    snippet_chars: [0, 4000],
    batch_size: [1, 25],
    daily_limit: [0, 100_000],
    lookback_days: [1, 90],
};

const clamp = (value, [min, max], fallback) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
};

class LLMSettingsService {
    #cache = null;
    #cachedAt = 0;
    #client = null;
    #clientKey = null;

    static shared() {
        if (!LLMSettingsService.instance) {
            LLMSettingsService.instance = new LLMSettingsService();
        }
        return LLMSettingsService.instance;
    }

    /** Creates the singleton row, seeding from the environment on first boot. */
    async ensureRow() {
        const existing = await query("SELECT id FROM llm_settings WHERE id = 1");
        if (existing.rows.length > 0) return;

        const envKey = process.env.OPENAI_API_KEY || null;

        await query(
            `INSERT INTO llm_settings
               (id, enabled, base_url, api_key_encrypted, model)
             VALUES (1, $1, $2, $3, $4)
             ON CONFLICT (id) DO NOTHING`,
            [
                Boolean(envKey),
                process.env.OPENAI_BASE_URL || DEFAULTS.base_url,
                envKey ? encryptSecret(envKey) : null,
                process.env.OPENAI_MODEL || DEFAULTS.model,
            ]
        );
    }

    invalidate() {
        this.#cache = null;
        this.#cachedAt = 0;
    }

    /**
     * Settings including the decrypted key. Never hand the result straight to
     * an HTTP response; use `redacted()` for that.
     */
    async get() {
        if (this.#cache && Date.now() - this.#cachedAt < CACHE_MS) {
            return this.#cache;
        }

        let row = null;
        try {
            const result = await query(
                "SELECT * FROM llm_settings WHERE id = 1"
            );
            row = result.rows[0] || null;
        } catch {
            // Before the schema bootstrap has run, behave as if disabled.
            row = null;
        }

        const settings = {
            ...DEFAULTS,
            ...(row || {}),
            apiKey: row ? decryptSecret(row.api_key_encrypted) : null,
        };
        delete settings.api_key_encrypted;

        this.#cache = settings;
        this.#cachedAt = Date.now();
        return settings;
    }

    /** The shape sent to the admin UI: key replaced by a hint. */
    async redacted() {
        const settings = await this.get();
        const { apiKey, ...rest } = settings;

        return {
            ...rest,
            hasApiKey: Boolean(apiKey),
            apiKeyHint: secretHint(apiKey),
            configured: await this.isConfigured(),
        };
    }

    async save(patch, actor) {
        const current = await this.get();

        const next = {
            enabled: patch.enabled ?? current.enabled,
            base_url: (patch.baseUrl ?? current.base_url ?? "").trim(),
            model: (patch.model ?? current.model ?? "").trim(),
            classify_enabled: patch.classifyEnabled ?? current.classify_enabled,
            summaries_enabled:
                patch.summariesEnabled ?? current.summaries_enabled,
            replies_enabled: patch.repliesEnabled ?? current.replies_enabled,
            importance_threshold: clamp(
                patch.importanceThreshold ?? current.importance_threshold,
                LIMITS.importance_threshold,
                DEFAULTS.importance_threshold
            ),
            snippet_chars: clamp(
                patch.snippetChars ?? current.snippet_chars,
                LIMITS.snippet_chars,
                DEFAULTS.snippet_chars
            ),
            batch_size: clamp(
                patch.batchSize ?? current.batch_size,
                LIMITS.batch_size,
                DEFAULTS.batch_size
            ),
            daily_limit: clamp(
                patch.dailyLimit ?? current.daily_limit,
                LIMITS.daily_limit,
                DEFAULTS.daily_limit
            ),
            lookback_days: clamp(
                patch.lookbackDays ?? current.lookback_days,
                LIMITS.lookback_days,
                DEFAULTS.lookback_days
            ),
            custom_instructions:
                patch.customInstructions ?? current.custom_instructions,
        };

        if (!/^https?:\/\//i.test(next.base_url)) {
            throw Object.assign(
                new Error("Base URL must start with http:// or https://"),
                { status: 400 }
            );
        }

        if (!next.model) {
            throw Object.assign(new Error("A model name is required"), {
                status: 400,
            });
        }

        // An absent apiKey means "leave the stored key alone"; an empty string
        // means "clear it". The UI never round-trips the real key.
        let encrypted;
        if (patch.apiKey === undefined) {
            encrypted = current.apiKey ? encryptSecret(current.apiKey) : null;
        } else {
            encrypted = patch.apiKey ? encryptSecret(patch.apiKey) : null;
        }

        // Upsert rather than update: the row is normally seeded at boot, but
        // saving must not silently do nothing if it is missing.
        await query(
            `INSERT INTO llm_settings
               (id, enabled, base_url, api_key_encrypted, model,
                classify_enabled, summaries_enabled, replies_enabled,
                importance_threshold, snippet_chars, batch_size,
                daily_limit, lookback_days, custom_instructions,
                updated_at, updated_by)
             VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                     NOW(), $14)
             ON CONFLICT (id) DO UPDATE SET
               enabled = EXCLUDED.enabled,
               base_url = EXCLUDED.base_url,
               api_key_encrypted = EXCLUDED.api_key_encrypted,
               model = EXCLUDED.model,
               classify_enabled = EXCLUDED.classify_enabled,
               summaries_enabled = EXCLUDED.summaries_enabled,
               replies_enabled = EXCLUDED.replies_enabled,
               importance_threshold = EXCLUDED.importance_threshold,
               snippet_chars = EXCLUDED.snippet_chars,
               batch_size = EXCLUDED.batch_size,
               daily_limit = EXCLUDED.daily_limit,
               lookback_days = EXCLUDED.lookback_days,
               custom_instructions = EXCLUDED.custom_instructions,
               updated_at = NOW(),
               updated_by = EXCLUDED.updated_by`,
            [
                next.enabled,
                next.base_url,
                encrypted,
                next.model,
                next.classify_enabled,
                next.summaries_enabled,
                next.replies_enabled,
                next.importance_threshold,
                next.snippet_chars,
                next.batch_size,
                next.daily_limit,
                next.lookback_days,
                next.custom_instructions,
                actor || null,
            ]
        );

        this.invalidate();
        this.#client = null;
        return this.redacted();
    }

    async isConfigured() {
        const settings = await this.get();
        return Boolean(settings.enabled && settings.base_url && settings.model);
    }

    /**
     * Returns null when the feature is switched off, so callers can degrade
     * instead of throwing. Self-hosted endpoints often need no key, so a
     * missing key is not by itself disqualifying.
     */
    async client() {
        const settings = await this.get();
        if (!settings.enabled || !settings.base_url) return null;

        const key = `${settings.base_url}|${settings.apiKey || ""}`;
        if (this.#client && this.#clientKey === key) return this.#client;

        this.#client = new OpenAI({
            apiKey: settings.apiKey || "not-required",
            baseURL: settings.base_url,
            timeout: 30_000,
            maxRetries: 1,
        });
        this.#clientKey = key;
        return this.#client;
    }

    /** One cheap round trip, used by the "Test connection" button. */
    async test(override = {}) {
        const settings = await this.get();

        const baseURL = (override.baseUrl || settings.base_url || "").trim();
        const model = (override.model || settings.model || "").trim();
        const apiKey =
            override.apiKey !== undefined && override.apiKey !== ""
                ? override.apiKey
                : settings.apiKey;

        if (!baseURL || !model) {
            return { ok: false, error: "Base URL and model are both required" };
        }

        const probe = new OpenAI({
            apiKey: apiKey || "not-required",
            baseURL,
            timeout: 15_000,
            maxRetries: 0,
        });

        const startedAt = Date.now();
        try {
            const response = await probe.chat.completions.create({
                model,
                messages: [{ role: "user", content: "Reply with: ok" }],
                max_tokens: 5,
                temperature: 0,
            });

            return {
                ok: true,
                model: response.model || model,
                latencyMs: Date.now() - startedAt,
                reply: response.choices?.[0]?.message?.content?.trim() || "",
            };
        } catch (error) {
            return {
                ok: false,
                latencyMs: Date.now() - startedAt,
                status: error?.status ?? null,
                error: error?.message || "Request failed",
            };
        }
    }

    async recordUsage(feature, { requests = 0, messages = 0, usage, errors = 0 }) {
        try {
            await query(
                `INSERT INTO llm_usage
                   (day, feature, requests, messages, prompt_tokens, completion_tokens, errors)
                 VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6)
                 ON CONFLICT (day, feature) DO UPDATE SET
                   requests = llm_usage.requests + EXCLUDED.requests,
                   messages = llm_usage.messages + EXCLUDED.messages,
                   prompt_tokens = llm_usage.prompt_tokens + EXCLUDED.prompt_tokens,
                   completion_tokens = llm_usage.completion_tokens + EXCLUDED.completion_tokens,
                   errors = llm_usage.errors + EXCLUDED.errors`,
                [
                    feature,
                    requests,
                    messages,
                    usage?.prompt_tokens || 0,
                    usage?.completion_tokens || 0,
                    errors,
                ]
            );
        } catch {
            // Usage accounting must never break the feature it measures.
        }
    }

    /** Messages classified today, against which the daily cap is applied. */
    async messagesToday(feature = "classification") {
        try {
            const result = await query(
                `SELECT messages FROM llm_usage
                  WHERE day = CURRENT_DATE AND feature = $1`,
                [feature]
            );
            return result.rows[0]?.messages ?? 0;
        } catch {
            return 0;
        }
    }

    async usageSummary(days = 14) {
        try {
            const result = await query(
                `SELECT day, feature, requests, messages,
                        prompt_tokens, completion_tokens, errors
                   FROM llm_usage
                  WHERE day > CURRENT_DATE - $1::integer
                  ORDER BY day DESC, feature`,
                [days]
            );
            return result.rows;
        } catch {
            return [];
        }
    }
}

module.exports = LLMSettingsService;
