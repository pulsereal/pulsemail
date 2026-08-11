require("dotenv").config();

/**
 * Boot-time configuration checks.
 *
 * A mail client that starts with a missing JWT secret or no Dovecot master
 * credentials looks healthy and then fails on the first real request, which is
 * the worst possible time to find out. Everything that must be present for the
 * process to be useful is asserted here instead, before the port is bound.
 */

const isProduction = () => process.env.NODE_ENV === "production";

const useMockData = () =>
    process.env.NODE_ENV === "development" &&
    process.env.USE_MOCK_DATA === "true";

const PLACEHOLDERS = [
    "your_super_secret_jwt_key_here",
    "your_super_secret_jwt_key_minimum_32_characters",
    "your_vmail_password",
    "your_vmail_password_here",
    "your_master_password",
    "your_admin_password",
    "change_me",
    "changeme",
];

const isPlaceholder = (value) =>
    Boolean(value) && PLACEHOLDERS.includes(value.trim().toLowerCase());

const describe = () => {
    const errors = [];
    const warnings = [];

    const require_ = (name, hint) => {
        const value = process.env[name];
        if (!value || !value.trim()) {
            errors.push(`${name} is not set. ${hint}`);
            return null;
        }
        if (isPlaceholder(value)) {
            errors.push(`${name} still holds the example placeholder. ${hint}`);
            return null;
        }
        return value;
    };

    // Authentication ---------------------------------------------------------

    const secret = require_(
        "JWT_SECRET",
        "Generate one with: openssl rand -base64 48"
    );

    if (secret && secret.length < 32) {
        errors.push(
            `JWT_SECRET is only ${secret.length} characters. Use at least 32; ` +
                "a short secret is brute-forceable and every session token depends on it."
        );
    }

    // Database ---------------------------------------------------------------

    if (!useMockData()) {
        require_(
            "DB_PASSWORD",
            "This is the password for iRedMail's vmail database user."
        );

        if (process.env.APP_DB_NAME && !process.env.APP_DB_PASSWORD) {
            warnings.push(
                "APP_DB_NAME is set but APP_DB_PASSWORD is not, so the vmail password will be reused."
            );
        }

        if (!process.env.APP_DB_NAME) {
            warnings.push(
                "APP_DB_NAME is not set, so application tables are created inside iRedMail's " +
                    "vmail database. Point APP_DB_* at a separate database to keep them apart."
            );
        }
    }

    // Mail servers -----------------------------------------------------------

    if (!useMockData()) {
        require_(
            "IMAP_MASTER_USER",
            "Cross-mailbox access needs a Dovecot master user; see DEPLOYMENT.md."
        );
        require_(
            "IMAP_MASTER_PASS",
            "This is the password for the Dovecot master passdb entry."
        );

        if (!process.env.SIEVE_MASTER_USER && !process.env.IMAP_MASTER_USER) {
            warnings.push(
                "No ManageSieve credentials; filters and vacation replies will not reach Dovecot."
            );
        }
    }

    // Production-only expectations -------------------------------------------

    if (isProduction()) {
        if (process.env.USE_MOCK_DATA === "true") {
            warnings.push(
                "USE_MOCK_DATA is set but has no effect outside development."
            );
        }

        if (!process.env.CORS_ORIGINS) {
            warnings.push(
                "CORS_ORIGINS is not set. Only same-origin requests will work, " +
                    "which is correct when nginx serves the frontend and proxies /api."
            );
        }

        if (!process.env.TRUST_PROXY) {
            warnings.push(
                "TRUST_PROXY is not set. Behind a reverse proxy this makes every " +
                    "client look like the proxy and rate limits apply to all users at once."
            );
        }

        for (const name of [
            "IMAP_TLS_REJECT_UNAUTHORIZED",
            "SMTP_TLS_REJECT_UNAUTHORIZED",
            "SIEVE_TLS_REJECT_UNAUTHORIZED",
        ]) {
            if (process.env[name] === "false") {
                warnings.push(
                    `${name}=false disables certificate verification. Only acceptable ` +
                        "for a self-signed certificate on localhost."
                );
            }
        }
    }

    return { errors, warnings };
};

/**
 * Print findings and, in production, refuse to start when anything is missing.
 * Development keeps running so a partially configured checkout is still usable.
 */
const validateEnvironment = ({ exitOnError = isProduction() } = {}) => {
    const { errors, warnings } = describe();

    for (const warning of warnings) {
        console.warn(`⚠️  ${warning}`);
    }

    if (errors.length === 0) return true;

    console.error(
        `\n❌ Configuration ${errors.length === 1 ? "problem" : "problems"}:`
    );
    for (const error of errors) {
        console.error(`   • ${error}`);
    }
    console.error("\nSee backend/.env.example and DEPLOYMENT.md.\n");

    if (exitOnError) process.exit(1);
    return false;
};

module.exports = { validateEnvironment, describe, isProduction, useMockData };
