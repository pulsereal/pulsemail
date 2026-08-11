const express = require("express");
const { authenticateToken, resolveMailboxScope } = require("../middleware/auth");
const { SieveService } = require("../services/SieveService");
const Mailbox = require("../models/Mailbox");
const { query } = require("../config/database");

const router = express.Router();

// These settings follow the mailbox being viewed, so admins can fix a user's
// filters or out-of-office while impersonating them.
const scoped = [authenticateToken, resolveMailboxScope];

const handle = (fn) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (error) {
        const status = error.status || 500;
        if (status >= 500) {
            console.error(`${req.method} ${req.originalUrl} failed:`, error);
        }
        res.status(status).json({
            error: status >= 500 ? "Request failed" : error.message,
        });
    }
};

// Sieve filters ---------------------------------------------------------------

router.get(
    "/filters",
    scoped,
    handle(async (req, res) => {
        const rules = await SieveService.getRules(req.mailbox);
        res.json({ success: true, mailbox: req.mailbox, rules });
    })
);

router.post(
    "/filters",
    scoped,
    handle(async (req, res) => {
        const id = await SieveService.saveRule(req.mailbox, req.body);
        const rules = await SieveService.getRules(req.mailbox);
        res.status(201).json({ success: true, id, rules });
    })
);

router.put(
    "/filters/:id",
    scoped,
    handle(async (req, res) => {
        await SieveService.saveRule(req.mailbox, {
            ...req.body,
            id: parseInt(req.params.id, 10),
        });
        const rules = await SieveService.getRules(req.mailbox);
        res.json({ success: true, rules });
    })
);

router.delete(
    "/filters/:id",
    scoped,
    handle(async (req, res) => {
        await SieveService.deleteRule(
            req.mailbox,
            parseInt(req.params.id, 10)
        );
        const rules = await SieveService.getRules(req.mailbox);
        res.json({ success: true, rules });
    })
);

// The generated script, so users can see exactly what runs on the server
router.get(
    "/filters/script",
    scoped,
    handle(async (req, res) => {
        const script = await SieveService.preview(req.mailbox);
        res.json({ success: true, script });
    })
);

// Vacation / out-of-office ----------------------------------------------------

router.get(
    "/vacation",
    scoped,
    handle(async (req, res) => {
        const vacation = await SieveService.getVacation(req.mailbox);
        res.json({ success: true, vacation });
    })
);

router.put(
    "/vacation",
    scoped,
    handle(async (req, res) => {
        const vacation = await SieveService.setVacation(req.mailbox, req.body);
        const result = await SieveService.publish(req.mailbox);

        res.json({
            success: true,
            vacation,
            // Surfaced so the UI can warn when Dovecot did not accept the script
            published: result.published,
            publishError: result.published ? null : result.reason,
        });
    })
);

// Forwarding, self-service ----------------------------------------------------

router.get(
    "/forwarding",
    scoped,
    handle(async (req, res) => {
        const forwarding = await Mailbox.getForwardings(req.mailbox);
        res.json({ success: true, forwarding });
    })
);

router.put(
    "/forwarding",
    scoped,
    handle(async (req, res) => {
        const forwarding = await Mailbox.setForwardings(
            req.mailbox,
            req.body.destinations || [],
            req.body.keepCopy !== false
        );
        res.json({ success: true, forwarding });
    })
);

// Identities and signatures ---------------------------------------------------

/**
 * Addresses a user may send as: their own mailbox plus any per-account alias
 * that resolves to it. Postfix's sender_login_maps only authorises the mailbox
 * itself, so aliases are offered as a display From, not a different envelope.
 */
router.get(
    "/identities",
    scoped,
    handle(async (req, res) => {
        const [stored, aliases] = await Promise.all([
            query(
                `SELECT id, from_address, display_name, signature, is_default
                   FROM user_identities
                  WHERE user_email = $1
                  ORDER BY is_default DESC, from_address`,
                [req.mailbox]
            ),
            Mailbox.getAliasAddresses(req.mailbox),
        ]);

        const known = new Set(stored.rows.map((row) => row.from_address));
        const available = [req.mailbox, ...aliases].filter(
            (address) => !known.has(address)
        );

        res.json({
            success: true,
            identities: stored.rows.map((row) => ({
                id: row.id,
                fromAddress: row.from_address,
                displayName: row.display_name,
                signature: row.signature,
                isDefault: row.is_default,
            })),
            availableAddresses: available,
        });
    })
);

router.put(
    "/identities",
    scoped,
    handle(async (req, res) => {
        const { fromAddress, displayName, signature, isDefault } = req.body;

        if (!fromAddress) {
            return res.status(400).json({ error: "fromAddress is required" });
        }

        const permitted = [
            req.mailbox,
            ...(await Mailbox.getAliasAddresses(req.mailbox)),
        ];
        if (!permitted.includes(fromAddress)) {
            return res.status(403).json({
                error: "You can only send as your own address or one of its aliases",
            });
        }

        if (isDefault) {
            await query(
                "UPDATE user_identities SET is_default = FALSE WHERE user_email = $1",
                [req.mailbox]
            );
        }

        await query(
            `INSERT INTO user_identities
                (user_email, from_address, display_name, signature, is_default)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (user_email, from_address) DO UPDATE
                SET display_name = $3, signature = $4, is_default = $5,
                    updated_at = NOW()`,
            [
                req.mailbox,
                fromAddress,
                displayName || "",
                signature || "",
                isDefault === true,
            ]
        );

        res.json({ success: true });
    })
);

router.delete(
    "/identities/:id",
    scoped,
    handle(async (req, res) => {
        await query(
            "DELETE FROM user_identities WHERE user_email = $1 AND id = $2",
            [req.mailbox, parseInt(req.params.id, 10)]
        );
        res.json({ success: true });
    })
);

module.exports = router;
