const crypto = require("crypto");

// Secrets that an administrator types into the UI (currently the LLM API key)
// are stored encrypted rather than in plain text, so a database dump or a
// backup does not hand over a billable third-party credential.
//
// SECRET_ENCRYPTION_KEY is the key of record. It is derived once with scrypt so
// that a human-typed passphrase is acceptable. When it is unset we fall back to
// JWT_SECRET, which every deployment already has: that keeps existing installs
// working, at the cost of tying secret rotation to session invalidation.

const ALGORITHM = "aes-256-gcm";
const SALT = "pulsemail.settings.v1";

let cachedKey = null;

const derivedKey = () => {
    if (cachedKey) return cachedKey;

    const passphrase =
        process.env.SECRET_ENCRYPTION_KEY || process.env.JWT_SECRET;

    if (!passphrase) {
        throw new Error(
            "Set SECRET_ENCRYPTION_KEY (or JWT_SECRET) before storing secrets"
        );
    }

    cachedKey = crypto.scryptSync(passphrase, SALT, 32);
    return cachedKey;
};

/** Encrypts to "v1.<iv>.<tag>.<ciphertext>", all base64url. */
const encryptSecret = (plaintext) => {
    if (plaintext === null || plaintext === undefined || plaintext === "") {
        return null;
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, derivedKey(), iv);
    const ciphertext = Buffer.concat([
        cipher.update(String(plaintext), "utf8"),
        cipher.final(),
    ]);

    return [
        "v1",
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        ciphertext.toString("base64url"),
    ].join(".");
};

/**
 * Returns null rather than throwing when the payload cannot be read, which is
 * what happens after the encryption key changes. The caller treats that as "no
 * key configured" and the administrator re-enters it.
 */
const decryptSecret = (payload) => {
    if (!payload) return null;

    const [version, iv, tag, ciphertext] = String(payload).split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext) return null;

    try {
        const decipher = crypto.createDecipheriv(
            ALGORITHM,
            derivedKey(),
            Buffer.from(iv, "base64url")
        );
        decipher.setAuthTag(Buffer.from(tag, "base64url"));

        return Buffer.concat([
            decipher.update(Buffer.from(ciphertext, "base64url")),
            decipher.final(),
        ]).toString("utf8");
    } catch {
        return null;
    }
};

/** Last four characters, for showing which key is saved without revealing it. */
const secretHint = (plaintext) => {
    if (!plaintext) return null;
    const value = String(plaintext);
    return value.length <= 4 ? "****" : `****${value.slice(-4)}`;
};

module.exports = { encryptSecret, decryptSecret, secretHint };
