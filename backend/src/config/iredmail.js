/**
 * iRedMail `vmail` schema conventions.
 *
 * Everything in here mirrors what iRedAdmin/iRedMail themselves do, so rows we
 * write are indistinguishable from rows written by the stock tooling. The
 * reference points are:
 *   - samples/iredmail/iredmail.pgsql              (table definitions)
 *   - samples/dovecot/dovecot-*-pgsql.conf         (quota unit, maildir layout)
 *   - samples/postfix/pgsql/*.cf                   (which columns Postfix reads)
 *   - iRedAdmin libs/iredutils.py                  (maildir + password hashing)
 */

const crypto = require("crypto");
const bcrypt = require("bcryptjs");

/**
 * Dovecot's user_query multiplies `mailbox.quota` by 1048576, so the column is
 * megabytes while every byte-denominated value we surface to the UI is bytes.
 */
const QUOTA_UNIT_BYTES = 1048576;

const bytesToQuotaMb = (bytes) =>
    Math.max(0, Math.round(Number(bytes || 0) / QUOTA_UNIT_BYTES));

const quotaMbToBytes = (mb) => Math.max(0, Number(mb || 0)) * QUOTA_UNIT_BYTES;

const boolFromEnv = (name, fallback) => {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return fallback;
    return raw === "true" || raw === "1" || raw === "yes";
};

const maildirOptions = () => ({
    hashed: boolFromEnv("MAILDIR_HASHED", true),
    prependDomain: boolFromEnv("MAILDIR_PREPEND_DOMAIN", true),
    appendTimestamp: boolFromEnv("MAILDIR_APPEND_TIMESTAMP", true),
    domainHashed: boolFromEnv("MAILDIR_DOMAIN_HASHED", false),
});

const pad = (value) => String(value).padStart(2, "0");

/**
 * Port of iRedAdmin's `generate_maildir_path()`. With stock settings this
 * yields `example.com/u/s/e/user-2026.08.06.20.42.13/`.
 */
const generateMaildir = (email, options = {}) => {
    const opts = { ...maildirOptions(), ...options };
    const [localPart, domain] = String(email).toLowerCase().split("@");

    if (!localPart || !domain) {
        throw new Error(`Cannot build a maildir path from "${email}"`);
    }

    let timestamp = "";
    if (opts.appendTimestamp) {
        const now = opts.now ? new Date(opts.now) : new Date();
        timestamp =
            `-${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}` +
            `.${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
    }

    let maildir;
    if (opts.hashed) {
        const chars = [localPart[0]];
        if (localPart.length === 1) chars.push("_", "_");
        else if (localPart.length === 2) chars.push(localPart[1], "_");
        else chars.push(localPart[1], localPart[2]);

        const safe = chars.map((char) =>
            char === "." || char === "~" ? "_" : char
        );
        maildir = `${safe[0]}/${safe[1]}/${safe[2]}/${localPart}${timestamp}/`;
    } else {
        maildir = `${localPart}${timestamp}/`;
    }

    if (!opts.prependDomain) return maildir;

    if (opts.domainHashed) {
        const head = domain.split(".")[0];
        const char1 = head[0];
        let char2 = head.length === 1 ? "_" : head[1];
        if (!/[a-z0-9]/i.test(char2)) char2 = "_";
        return `${char1}/${char2}/${domain}/${maildir}`;
    }

    return `${domain}/${maildir}`;
};

/**
 * iRedMail splits a mailbox home across three columns; Dovecot concatenates
 * them and Postfix reads `storagenode/maildir`. Keep the split consistent.
 */
const storageDefaults = () => ({
    storageBaseDirectory:
        process.env.MAILDIR_BASE_DIRECTORY || "/var/vmail/vmail1",
    storageNode: process.env.MAILDIR_STORAGE_NODE || "",
});

/**
 * Split `/var/vmail/vmail1` into the base directory + node the schema expects.
 */
const splitStorage = () => {
    const { storageBaseDirectory, storageNode } = storageDefaults();
    if (storageNode) {
        return { base: storageBaseDirectory, node: storageNode };
    }

    const trimmed = storageBaseDirectory.replace(/\/+$/, "");
    const index = trimmed.lastIndexOf("/");
    if (index <= 0) return { base: trimmed, node: "" };

    return { base: trimmed.slice(0, index), node: trimmed.slice(index + 1) };
};

const SUPPORTED_SCHEMES = ["SSHA512", "SSHA256", "SSHA", "BCRYPT", "PLAIN"];

const defaultScheme = () => {
    const scheme = (
        process.env.DEFAULT_PASSWORD_SCHEME || "SSHA512"
    ).toUpperCase();
    return SUPPORTED_SCHEMES.includes(scheme) ? scheme : "SSHA512";
};

const SSHA_DIGESTS = {
    SSHA: { algorithm: "sha1", length: 20, saltBytes: 8 },
    SSHA256: { algorithm: "sha256", length: 32, saltBytes: 8 },
    SSHA512: { algorithm: "sha512", length: 64, saltBytes: 8 },
};

/**
 * Dovecot hashes the raw password bytes followed by the raw salt bytes. The
 * salt must stay a Buffer throughout — coercing it to a string corrupts any
 * byte that is not valid UTF-8 and silently breaks verification.
 */
const sshaDigest = (algorithm, password, salt) =>
    crypto
        .createHash(algorithm)
        .update(Buffer.concat([Buffer.from(String(password), "utf8"), salt]))
        .digest();

const hashPassword = async (plainPassword, scheme = defaultScheme()) => {
    const normalized = String(scheme).toUpperCase();

    if (normalized === "BCRYPT") {
        return bcrypt.hash(plainPassword, 12);
    }

    if (normalized === "PLAIN") {
        return `{PLAIN}${plainPassword}`;
    }

    const spec = SSHA_DIGESTS[normalized];
    if (!spec) {
        throw new Error(`Unsupported password scheme: ${scheme}`);
    }

    const salt = crypto.randomBytes(spec.saltBytes);
    const digest = sshaDigest(spec.algorithm, plainPassword, salt);
    return `{${normalized}}${Buffer.concat([digest, salt]).toString("base64")}`;
};

const verifyPassword = async (plainPassword, storedHash) => {
    if (!storedHash) return false;

    for (const [name, spec] of Object.entries(SSHA_DIGESTS)) {
        const prefix = `{${name}}`;
        if (!storedHash.startsWith(prefix)) continue;

        const decoded = Buffer.from(storedHash.slice(prefix.length), "base64");
        if (decoded.length <= spec.length) return false;

        const expected = decoded.subarray(0, spec.length);
        const salt = decoded.subarray(spec.length);
        return crypto.timingSafeEqual(
            sshaDigest(spec.algorithm, plainPassword, salt),
            expected
        );
    }

    if (storedHash.startsWith("{PLAIN}")) {
        return storedHash.slice(7) === plainPassword;
    }

    if (/^\{?(\$2[aby]\$)/.test(storedHash)) {
        return bcrypt.compare(
            plainPassword,
            storedHash.replace(/^\{BCRYPT\}/i, "")
        );
    }

    if (storedHash.startsWith("{CRYPT}")) {
        throw new Error(
            "Password scheme {CRYPT} is not supported. Re-hash the account with SSHA512."
        );
    }

    return false;
};

/**
 * iRedMail stores per-object settings as a flat `key:value;` string in the
 * `settings` column of `domain`, `mailbox` and `maillists`.
 */
const parseSettings = (raw) => {
    const settings = {};
    if (!raw) return settings;

    for (const chunk of String(raw).split(";")) {
        const entry = chunk.trim();
        if (!entry) continue;
        const index = entry.indexOf(":");
        if (index === -1) continue;
        settings[entry.slice(0, index)] = entry.slice(index + 1);
    }

    return settings;
};

const serializeSettings = (settings = {}) =>
    Object.entries(settings)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${key}:${value}`)
        .join(";") + (Object.keys(settings).length ? ";" : "");

/**
 * Per-protocol switches Dovecot resolves as `enable<protocol><secured>`.
 * `enablelib-storage` and friends are quoted because of the hyphen.
 */
const SERVICE_COLUMNS = [
    "enablesmtp",
    "enablesmtpsecured",
    "enablepop3",
    "enablepop3secured",
    "enablepop3tls",
    "enableimap",
    "enableimapsecured",
    "enableimaptls",
    "enabledeliver",
    "enablelda",
    "enablemanagesieve",
    "enablemanagesievesecured",
    "enablesieve",
    "enablesievesecured",
    "enablesievetls",
    "enableinternal",
    "enabledoveadm",
    "enablelib-storage",
    "enablequota-status",
    "enableindexer-worker",
    "enablelmtp",
    "enabledsync",
    "enablesogo",
];

const quoteColumn = (column) =>
    column.includes("-") ? `"${column}"` : column;

/**
 * User-facing service groups. Toggling one flips every Dovecot/Postfix column
 * that governs it, which is what iRedAdmin's checkboxes do.
 */
const SERVICE_GROUPS = {
    smtp: ["enablesmtp", "enablesmtpsecured"],
    pop3: ["enablepop3", "enablepop3secured", "enablepop3tls"],
    imap: ["enableimap", "enableimapsecured", "enableimaptls"],
    managesieve: [
        "enablemanagesieve",
        "enablemanagesievesecured",
        "enablesieve",
        "enablesievesecured",
        "enablesievetls",
    ],
    deliver: ["enabledeliver", "enablelda", "enablelmtp"],
    sogo: ["enablesogo"],
};

const DOMAIN_TRANSPORT = process.env.DEFAULT_TRANSPORT || "dovecot";

// A global admin is recorded against the reserved "ALL" domain.
const GLOBAL_ADMIN_DOMAIN = "ALL";

const isValidEmail = (value) =>
    typeof value === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) &&
    value.length <= 255;

const isValidDomain = (value) =>
    typeof value === "string" &&
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(
        value
    ) &&
    value.length <= 255;

module.exports = {
    QUOTA_UNIT_BYTES,
    bytesToQuotaMb,
    quotaMbToBytes,
    generateMaildir,
    storageDefaults,
    splitStorage,
    hashPassword,
    verifyPassword,
    defaultScheme,
    SUPPORTED_SCHEMES,
    parseSettings,
    serializeSettings,
    SERVICE_COLUMNS,
    SERVICE_GROUPS,
    quoteColumn,
    DOMAIN_TRANSPORT,
    GLOBAL_ADMIN_DOMAIN,
    isValidEmail,
    isValidDomain,
};
