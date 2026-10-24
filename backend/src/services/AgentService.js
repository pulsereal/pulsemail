const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const { EventEmitter } = require("events");
const { query, mailQuery } = require("../config/database");
const {
    encryptSecret,
    decryptSecret,
    secretHint,
} = require("../config/secrets");
const { canManageDomain } = require("../middleware/auth");
const User = require("../models/User");
const Domain = require("../models/Domain");

// Agents are external systems (LLM agents, n8n, Zapier, in-house bots) that an
// administrator grants access to a set of mailboxes. Each one has two halves
// that share a single scope: a webhook we push mail events to, and an API key
// it uses to call back into /api/agent.
//
// Scope is checked twice. When an admin saves an agent, every domain and
// mailbox must be one they can manage. At runtime the creator's rights are
// re-derived from domain_admins, so revoking a domain admin also cuts off the
// agents they created for that domain.

const EVENTS = ["email.received", "email.sent"];

// read, send and modify act on mail; settings on a mailbox's filters,
// vacation, forwarding and identities. provision and admins act on the
// directory itself and so need whole domains in scope, never single mailboxes.
const PERMISSIONS = [
    "read",
    "send",
    "modify",
    "settings",
    "provision",
    "admins",
];
const DIRECTORY_PERMISSIONS = ["provision", "admins"];
const NO_ADMIN = { isAdmin: false, adminType: null, domains: [] };

const KEY_PREFIX = "pm_agent_";
const SECRET_PREFIX = "whsec_";

const AGENT_CACHE_MS = 10_000;
const ADMIN_CACHE_MS = 60_000;
const LAST_USED_WRITE_MS = 60_000;

const PAYLOAD_MAX_BODY_CHARS = (() => {
    const parsed = parseInt(process.env.AGENT_PAYLOAD_MAX_BODY_CHARS, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 20_000;
})();

const httpError = (status, message) =>
    Object.assign(new Error(message), { status });

const hashKey = (key) => crypto.createHash("sha256").update(key).digest("hex");
const generateKey = () =>
    `${KEY_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
const generateSecret = () =>
    `${SECRET_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;

const domainOf = (address) => String(address).split("@")[1] || "";

const normalizeList = (value) =>
    [
        ...new Set(
            (Array.isArray(value) ? value : [])
                .map((item) => String(item).trim().toLowerCase())
                .filter(Boolean)
        ),
    ].sort();

const pickKnown = (value, known, label) => {
    const list = normalizeList(value);
    const unknown = list.filter((item) => !known.includes(item));
    if (unknown.length > 0) {
        throw httpError(
            400,
            `Unknown ${label}: ${unknown.join(", ")}. Expected one of ${known.join(", ")}`
        );
    }
    return list;
};

const PRIVATE_RANGES = (() => {
    const list = new net.BlockList();
    list.addSubnet("0.0.0.0", 8);
    list.addSubnet("10.0.0.0", 8);
    list.addSubnet("100.64.0.0", 10);
    list.addSubnet("127.0.0.0", 8);
    list.addSubnet("169.254.0.0", 16);
    list.addSubnet("172.16.0.0", 12);
    list.addSubnet("192.0.0.0", 24);
    list.addSubnet("192.168.0.0", 16);
    list.addSubnet("198.18.0.0", 15);
    // Multicast, reserved and broadcast.
    list.addSubnet("224.0.0.0", 3);
    list.addAddress("::", "ipv6");
    list.addAddress("::1", "ipv6");
    list.addSubnet("fc00::", 7, "ipv6");
    list.addSubnet("fe80::", 10, "ipv6");
    list.addSubnet("ff00::", 8, "ipv6");
    return list;
})();

// BlockList matches IPv4-mapped IPv6 (::ffff:a.b.c.d) against the IPv4 rules.
const isPrivateAddress = (address) =>
    PRIVATE_RANGES.check(address, net.isIPv6(address) ? "ipv6" : "ipv4");

const allowPrivateTargets = () =>
    process.env.AGENT_WEBHOOK_ALLOW_PRIVATE === "true";

/**
 * Rejects URLs that would let an admin point the server at itself or the
 * internal network. Checked on save and again before every delivery, since
 * the DNS answer can change in between.
 */
const assertSafeWebhookUrl = async (raw) => {
    let url;
    try {
        url = new URL(String(raw));
    } catch {
        throw httpError(400, "Webhook URL is not a valid URL");
    }

    const allowPrivate = allowPrivateTargets();
    const insecureAllowed =
        process.env.NODE_ENV !== "production" || allowPrivate;

    if (
        url.protocol !== "https:" &&
        !(url.protocol === "http:" && insecureAllowed)
    ) {
        throw httpError(400, "Webhook URL must use https://");
    }

    if (allowPrivate) return url;

    const host = url.hostname.replace(/^\[|\]$/g, "");
    let addresses;
    if (net.isIP(host)) {
        addresses = [host];
    } else {
        try {
            addresses = (await dns.lookup(host, { all: true })).map(
                (entry) => entry.address
            );
        } catch {
            throw httpError(400, `Webhook host ${host} does not resolve`);
        }
    }

    if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
        throw httpError(
            400,
            "Webhook URL resolves to a private or loopback address. Set AGENT_WEBHOOK_ALLOW_PRIVATE=true to allow agents on the internal network."
        );
    }

    return url;
};

const truncate = (value, max) => {
    if (typeof value !== "string") return { value: value ?? null, cut: false };
    if (max <= 0 || value.length <= max) return { value, cut: false };
    return { value: value.slice(0, max), cut: true };
};

const addressList = (field) =>
    (Array.isArray(field) ? field : field ? [field] : [])
        .flatMap((entry) => entry?.value || [])
        .map(({ address, name }) => ({
            address: (address || "").toLowerCase(),
            name: name || "",
        }));

const emailPath = (mailbox, uid, folder, suffix = "") =>
    `/api/agent/mailboxes/${encodeURIComponent(mailbox)}/emails/${encodeURIComponent(uid)}${suffix}?folder=${encodeURIComponent(folder)}`;

/**
 * The message shape agents see, both in webhook payloads and from the agent
 * API. `maxBodyChars` of 0 means no truncation.
 */
const toAgentEmail = (content, { maxBodyChars = 0, uidvalidity } = {}) => {
    const text = truncate(content.text || "", maxBodyChars);
    const html = truncate(content.html || null, maxBodyChars);
    const folder = content.folder || "INBOX";

    return {
        uid: String(content.uid),
        folder,
        uidvalidity: uidvalidity ?? content.uidvalidity ?? null,
        message_id: content.messageId || null,
        from: addressList(content.from)[0] || null,
        reply_to: addressList(content.replyTo),
        to: addressList(content.to),
        cc: addressList(content.cc),
        subject: content.subject || "",
        date: content.date || null,
        flags: content.flags || [],
        text: text.value,
        html: html.value,
        truncated: text.cut || html.cut,
        attachments: (content.attachments || []).map((attachment, index) => ({
            index,
            filename: attachment.filename || `attachment-${index}`,
            content_type: attachment.contentType || "application/octet-stream",
            size: attachment.size || 0,
            url: emailPath(
                content.mailbox,
                content.uid,
                folder,
                `/attachments/${index}`
            ),
        })),
        url: emailPath(content.mailbox, content.uid, folder),
    };
};

const recipientList = (value) =>
    (Array.isArray(value) ? value : String(value || "").split(","))
        .map((address) => String(address).trim().toLowerCase())
        .filter(Boolean)
        .map((address) => ({ address, name: "" }));

/** Payload for `email.sent`, whichever path the message left through. */
const sentEmailPayload = ({
    mailbox,
    to,
    cc,
    bcc,
    subject,
    html,
    text,
    messageId,
    inReplyTo,
    via,
    agentId = null,
}) => {
    const body = {
        text: truncate(text || "", PAYLOAD_MAX_BODY_CHARS),
        html: truncate(html || null, PAYLOAD_MAX_BODY_CHARS),
    };

    return {
        via,
        sent_by_agent: agentId,
        email: {
            message_id: messageId || null,
            in_reply_to: inReplyTo || null,
            from: { address: mailbox, name: "" },
            to: recipientList(to),
            cc: recipientList(cc),
            bcc: recipientList(bcc),
            subject: subject || "",
            date: new Date().toISOString(),
            text: body.text.value,
            html: body.html.value,
            truncated: body.text.cut || body.html.cut,
        },
    };
};

class AgentService extends EventEmitter {
    #agents = null;
    #agentsAt = 0;
    #adminCache = new Map();
    #lastUsedWrites = new Map();

    static shared() {
        if (!AgentService.instance) {
            AgentService.instance = new AgentService();
        }
        return AgentService.instance;
    }

    // Presentation ---------------------------------------------------------

    #present(row) {
        if (!row) return null;
        return {
            id: row.id,
            name: row.name,
            description: row.description || "",
            webhookUrl: row.webhook_url || null,
            apiKeyPrefix: row.api_key_prefix,
            signingSecretHint: secretHint(
                decryptSecret(row.signing_secret_encrypted)
            ),
            scopeAll: Boolean(row.scope_all),
            domains: row.domains || [],
            mailboxes: row.mailboxes || [],
            events: row.events || [],
            permissions: row.permissions || [],
            active: Boolean(row.active),
            createdBy: row.created_by,
            lastUsedAt: row.last_used_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            ...(row.last_delivery_status !== undefined
                ? {
                      lastDelivery: row.last_delivery_status
                          ? {
                                status: row.last_delivery_status,
                                statusCode: row.last_delivery_code,
                                at: row.last_delivery_at,
                            }
                          : null,
                      pendingDeliveries: parseInt(row.pending_count || 0, 10),
                      failedDeliveries: parseInt(row.failed_count || 0, 10),
                  }
                : {}),
        };
    }

    // Admin-facing scope rules --------------------------------------------

    /** Whether `adminInfo` may see and change an agent with this scope. */
    canManage(adminInfo, agent) {
        if (!adminInfo?.isAdmin) return false;
        if (adminInfo.adminType === "global") return true;
        if (agent.scope_all ?? agent.scopeAll) return false;

        return [
            ...(agent.domains || []),
            ...(agent.mailboxes || []).map(domainOf),
        ].every((domain) => canManageDomain(adminInfo, domain));
    }

    async #validateScope(adminInfo, { scopeAll, domains, mailboxes }) {
        if (scopeAll) {
            if (adminInfo.adminType !== "global") {
                throw httpError(
                    403,
                    "Only a global admin can grant an agent every mailbox"
                );
            }
            return;
        }

        if (domains.length === 0 && mailboxes.length === 0) {
            throw httpError(
                400,
                "Choose at least one domain or mailbox for the agent"
            );
        }

        for (const domain of domains) {
            if (!canManageDomain(adminInfo, domain)) {
                throw httpError(403, `Access denied for domain ${domain}`);
            }
            if (!(await Domain.findByName(domain))) {
                throw httpError(400, `Domain ${domain} does not exist`);
            }
        }

        for (const mailbox of mailboxes) {
            if (!canManageDomain(adminInfo, domainOf(mailbox))) {
                throw httpError(403, `Access denied for mailbox ${mailbox}`);
            }
            if (!(await User.findByEmail(mailbox))) {
                throw httpError(400, `Mailbox ${mailbox} does not exist`);
            }
        }
    }

    async #normalizeInput(input, current, adminInfo) {
        const pick = (camel, snake) =>
            input[camel] !== undefined ? input[camel] : current?.[snake];

        const name = String(pick("name", "name") ?? "").trim();
        if (!name) throw httpError(400, "Agent name is required");
        if (name.length > 255) throw httpError(400, "Agent name is too long");

        const rawUrl = pick("webhookUrl", "webhook_url");
        const webhookUrl = rawUrl ? String(rawUrl).trim() : null;
        if (webhookUrl && webhookUrl !== current?.webhook_url) {
            await assertSafeWebhookUrl(webhookUrl);
        }

        const scope = {
            scopeAll: Boolean(pick("scopeAll", "scope_all")),
            domains: normalizeList(pick("domains", "domains")),
            mailboxes: normalizeList(pick("mailboxes", "mailboxes")),
        };
        if (scope.scopeAll) {
            scope.domains = [];
            scope.mailboxes = [];
        }
        await this.#validateScope(adminInfo, scope);

        const events = pickKnown(pick("events", "events"), EVENTS, "events");
        if (events.length > 0 && !webhookUrl) {
            throw httpError(400, "A webhook URL is required to receive events");
        }

        const permissions = pickKnown(
            pick("permissions", "permissions"),
            PERMISSIONS,
            "permissions"
        );
        const directory = permissions.filter((permission) =>
            DIRECTORY_PERMISSIONS.includes(permission)
        );
        if (
            directory.length > 0 &&
            !scope.scopeAll &&
            scope.domains.length === 0
        ) {
            throw httpError(
                400,
                `The ${directory.join(" and ")} permission needs whole domains in scope, not individual mailboxes`
            );
        }

        return {
            name,
            description: String(
                pick("description", "description") ?? ""
            ).trim(),
            webhookUrl,
            ...scope,
            events,
            permissions,
            active: pick("active", "active") ?? true,
        };
    }

    // CRUD ------------------------------------------------------------------

    invalidate() {
        this.#agents = null;
        this.#agentsAt = 0;
        this.#adminCache.clear();
    }

    async #row(id) {
        const result = await query("SELECT * FROM agents WHERE id = $1", [
            parseInt(id, 10) || 0,
        ]);
        return result.rows[0] || null;
    }

    /** The raw row, or a 404 when missing or outside the admin's scope. */
    async managedRow(id, adminInfo) {
        const row = await this.#row(id);
        if (!row || !this.canManage(adminInfo, row)) {
            throw httpError(404, "Agent not found");
        }
        return row;
    }

    async list(adminInfo) {
        const result = await query(
            `SELECT a.*,
                    last.status AS last_delivery_status,
                    last.last_status_code AS last_delivery_code,
                    COALESCE(last.delivered_at, last.created_at) AS last_delivery_at,
                    (SELECT COUNT(*) FROM agent_deliveries p
                      WHERE p.agent_id = a.id AND p.status = 'pending') AS pending_count,
                    (SELECT COUNT(*) FROM agent_deliveries f
                      WHERE f.agent_id = a.id AND f.status = 'failed') AS failed_count
               FROM agents a
               LEFT JOIN LATERAL (
                    SELECT status, last_status_code, delivered_at, created_at
                      FROM agent_deliveries d
                     WHERE d.agent_id = a.id AND d.attempts > 0
                     ORDER BY d.id DESC
                     LIMIT 1
               ) last ON TRUE
              ORDER BY a.name, a.id`
        );

        return result.rows
            .filter((row) => this.canManage(adminInfo, row))
            .map((row) => this.#present(row));
    }

    async get(id, adminInfo) {
        return this.#present(await this.managedRow(id, adminInfo));
    }

    async create(input, adminInfo, actor) {
        const values = await this.#normalizeInput(input || {}, null, adminInfo);
        const apiKey = generateKey();
        const signingSecret = generateSecret();

        const result = await query(
            `INSERT INTO agents
               (name, description, webhook_url, signing_secret_encrypted,
                api_key_hash, api_key_prefix, scope_all, domains, mailboxes,
                events, permissions, active, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             RETURNING *`,
            [
                values.name,
                values.description,
                values.webhookUrl,
                encryptSecret(signingSecret),
                hashKey(apiKey),
                apiKey.slice(0, KEY_PREFIX.length + 6),
                values.scopeAll,
                JSON.stringify(values.domains),
                JSON.stringify(values.mailboxes),
                JSON.stringify(values.events),
                JSON.stringify(values.permissions),
                Boolean(values.active),
                actor,
            ]
        );

        this.invalidate();
        return { agent: this.#present(result.rows[0]), apiKey, signingSecret };
    }

    async update(id, input, adminInfo) {
        const current = await this.managedRow(id, adminInfo);
        const values = await this.#normalizeInput(
            input || {},
            current,
            adminInfo
        );

        const result = await query(
            `UPDATE agents
                SET name = $2, description = $3, webhook_url = $4,
                    scope_all = $5, domains = $6, mailboxes = $7, events = $8,
                    permissions = $9, active = $10, updated_at = NOW()
              WHERE id = $1
              RETURNING *`,
            [
                current.id,
                values.name,
                values.description,
                values.webhookUrl,
                values.scopeAll,
                JSON.stringify(values.domains),
                JSON.stringify(values.mailboxes),
                JSON.stringify(values.events),
                JSON.stringify(values.permissions),
                Boolean(values.active),
            ]
        );

        this.invalidate();
        return this.#present(result.rows[0]);
    }

    async remove(id, adminInfo) {
        const current = await this.managedRow(id, adminInfo);
        await query("DELETE FROM agents WHERE id = $1", [current.id]);
        this.invalidate();
        return true;
    }

    async rotateKey(id, adminInfo) {
        const current = await this.managedRow(id, adminInfo);
        const apiKey = generateKey();

        const result = await query(
            `UPDATE agents
                SET api_key_hash = $2, api_key_prefix = $3, updated_at = NOW()
              WHERE id = $1
              RETURNING *`,
            [
                current.id,
                hashKey(apiKey),
                apiKey.slice(0, KEY_PREFIX.length + 6),
            ]
        );

        this.invalidate();
        return { agent: this.#present(result.rows[0]), apiKey };
    }

    async rotateSecret(id, adminInfo) {
        const current = await this.managedRow(id, adminInfo);
        const signingSecret = generateSecret();

        const result = await query(
            `UPDATE agents
                SET signing_secret_encrypted = $2, updated_at = NOW()
              WHERE id = $1
              RETURNING *`,
            [current.id, encryptSecret(signingSecret)]
        );

        this.invalidate();
        return { agent: this.#present(result.rows[0]), signingSecret };
    }

    signingSecret(row) {
        return decryptSecret(row.signing_secret_encrypted);
    }

    // Deliveries -------------------------------------------------------------

    async deliveries(id, adminInfo, { limit = 50, status } = {}) {
        const agent = await this.managedRow(id, adminInfo);
        const params = [
            agent.id,
            Math.min(200, Math.max(1, Number(limit) || 50)),
        ];
        const statusFilter = status ? "AND status = $3" : "";
        if (status) params.push(String(status));

        const result = await query(
            `SELECT id, event, mailbox, message_key, status, attempts,
                    next_attempt_at, last_status_code, last_error,
                    created_at, delivered_at,
                    payload->'email'->>'subject' AS subject
               FROM agent_deliveries
              WHERE agent_id = $1 ${statusFilter}
              ORDER BY id DESC
              LIMIT $2`,
            params
        );

        return result.rows.map((row) => ({
            id: row.id,
            event: row.event,
            mailbox: row.mailbox,
            messageKey: row.message_key,
            subject: row.subject,
            status: row.status,
            attempts: row.attempts,
            nextAttemptAt: row.next_attempt_at,
            lastStatusCode: row.last_status_code,
            lastError: row.last_error,
            createdAt: row.created_at,
            deliveredAt: row.delivered_at,
        }));
    }

    async redeliver(id, deliveryId, adminInfo) {
        const agent = await this.managedRow(id, adminInfo);
        const result = await query(
            `UPDATE agent_deliveries
                SET status = 'pending', attempts = 0, next_attempt_at = NOW(),
                    last_error = NULL
              WHERE id = $1 AND agent_id = $2
              RETURNING id`,
            [parseInt(deliveryId, 10) || 0, agent.id]
        );

        if (result.rows.length === 0) {
            throw httpError(404, "Delivery not found");
        }

        this.emit("enqueued");
        return true;
    }

    // Runtime scope ----------------------------------------------------------

    async #activeAgents() {
        if (this.#agents && Date.now() - this.#agentsAt < AGENT_CACHE_MS) {
            return this.#agents;
        }
        const result = await query("SELECT * FROM agents WHERE active = TRUE");
        this.#agents = result.rows;
        this.#agentsAt = Date.now();
        return this.#agents;
    }

    async #creatorInfo(email) {
        const cached = this.#adminCache.get(email);
        if (cached && Date.now() - cached.at < ADMIN_CACHE_MS)
            return cached.info;

        const info = await User.isAdmin(email);
        this.#adminCache.set(email, { info, at: Date.now() });
        return info;
    }

    /** Whether an agent may act on `mailbox` right now. */
    async covers(agent, mailbox) {
        if (!agent?.active) return false;

        const address = String(mailbox).toLowerCase();
        const domain = domainOf(address);
        const inScope =
            agent.scope_all ||
            (agent.domains || []).includes(domain) ||
            (agent.mailboxes || []).includes(address);
        if (!inScope) return false;

        const creator = await this.#creatorInfo(agent.created_by);
        if (agent.scope_all) {
            return creator.isAdmin && creator.adminType === "global";
        }
        return canManageDomain(creator, domain);
    }

    /**
     * The admin rights an agent acts with on the directory: its domain scope
     * narrowed to what its creator can still manage. Shaped like
     * User.isAdmin() so the provisioning routes can treat it the same way.
     * Individually granted mailboxes never confer directory rights.
     */
    async effectiveAdminInfo(agent) {
        if (!agent?.active) return NO_ADMIN;

        const creator = await this.#creatorInfo(agent.created_by);
        if (!creator.isAdmin) return NO_ADMIN;

        if (agent.scope_all) {
            return creator.adminType === "global" ? creator : NO_ADMIN;
        }

        const domains = (agent.domains || []).filter((domain) =>
            canManageDomain(creator, domain)
        );
        return domains.length > 0
            ? { isAdmin: true, adminType: "domain", domains }
            : NO_ADMIN;
    }

    async findByApiKey(key) {
        if (typeof key !== "string" || !key.startsWith(KEY_PREFIX)) return null;

        const result = await query(
            "SELECT * FROM agents WHERE api_key_hash = $1 AND active = TRUE",
            [hashKey(key)]
        );
        const agent = result.rows[0] || null;
        if (agent) this.#touch(agent.id);
        return agent;
    }

    #touch(id) {
        const last = this.#lastUsedWrites.get(id) || 0;
        if (Date.now() - last < LAST_USED_WRITE_MS) return;
        this.#lastUsedWrites.set(id, Date.now());

        query("UPDATE agents SET last_used_at = NOW() WHERE id = $1", [
            id,
        ]).catch((error) =>
            console.error("Failed to record agent use:", error.message)
        );
    }

    /** Active mailboxes the agent can reach, for GET /api/agent/mailboxes. */
    async mailboxesFor(agent) {
        const rows = await this.#candidateMailboxes([agent]);
        const reachable = [];
        for (const row of rows) {
            if (await this.covers(agent, row.email)) reachable.push(row);
        }
        return reachable;
    }

    async #candidateMailboxes(agents) {
        if (agents.length === 0) return [];

        const select = `SELECT username AS email, name, domain FROM mailbox WHERE active = 1`;
        if (agents.some((agent) => agent.scope_all)) {
            return (await mailQuery(`${select} ORDER BY domain, username`))
                .rows;
        }

        const domains = [
            ...new Set(agents.flatMap((agent) => agent.domains || [])),
        ];
        const mailboxes = [
            ...new Set(agents.flatMap((agent) => agent.mailboxes || [])),
        ];
        if (domains.length === 0 && mailboxes.length === 0) return [];

        const result = await mailQuery(
            `${select}
               AND (domain = ANY($1::text[]) OR username = ANY($2::text[]))
             ORDER BY domain, username`,
            [domains, mailboxes]
        );
        return result.rows;
    }

    /** Mailboxes at least one webhook agent wants `event` for. */
    async watchedMailboxes(event) {
        const agents = (await this.#activeAgents()).filter(
            (agent) => agent.webhook_url && (agent.events || []).includes(event)
        );

        const rows = await this.#candidateMailboxes(agents);
        const watched = [];
        for (const row of rows) {
            for (const agent of agents) {
                if (await this.covers(agent, row.email)) {
                    watched.push(row.email);
                    break;
                }
            }
        }
        return watched;
    }

    async agentsFor(mailbox, event) {
        const matches = [];
        for (const agent of await this.#activeAgents()) {
            if (!agent.webhook_url || !(agent.events || []).includes(event))
                continue;
            if (await this.covers(agent, mailbox)) matches.push(agent);
        }
        return matches;
    }

    /**
     * Queues `event` for every agent subscribed to it on `mailbox`. The unique
     * key on (agent, event, mailbox, messageKey) makes this safe to repeat.
     */
    async publish(event, mailbox, payload, messageKey) {
        if (!EVENTS.includes(event)) return 0;

        try {
            const agents = await this.agentsFor(mailbox, event);
            if (agents.length === 0) return 0;

            const key = messageKey || crypto.randomUUID();
            let queued = 0;
            for (const agent of agents) {
                const result = await query(
                    `INSERT INTO agent_deliveries
                       (agent_id, event, mailbox, message_key, payload)
                     VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (agent_id, event, mailbox, message_key) DO NOTHING
                     RETURNING id`,
                    [agent.id, event, mailbox, key, JSON.stringify(payload)]
                );
                queued += result.rows.length;
            }

            if (queued > 0) this.emit("enqueued");
            return queued;
        } catch (error) {
            console.error(
                `Failed to queue ${event} for ${mailbox}:`,
                error.message
            );
            return 0;
        }
    }
}

module.exports = AgentService;
module.exports.EVENTS = EVENTS;
module.exports.PERMISSIONS = PERMISSIONS;
module.exports.KEY_PREFIX = KEY_PREFIX;
module.exports.PAYLOAD_MAX_BODY_CHARS = PAYLOAD_MAX_BODY_CHARS;
module.exports.assertSafeWebhookUrl = assertSafeWebhookUrl;
module.exports.toAgentEmail = toAgentEmail;
module.exports.sentEmailPayload = sentEmailPayload;
