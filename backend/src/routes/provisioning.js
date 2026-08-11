const express = require("express");
const {
    authenticateToken,
    requireAdmin,
    requireGlobalAdmin,
    requireDomainAccess,
} = require("../middleware/auth");
const Domain = require("../models/Domain");
const Mailbox = require("../models/Mailbox");
const Alias = require("../models/Alias");
const User = require("../models/User");
const { SUPPORTED_SCHEMES } = require("../config/iredmail");

const router = express.Router();

const admin = [authenticateToken, requireAdmin];
const globalAdmin = [authenticateToken, requireGlobalAdmin];
const scopedAdmin = [authenticateToken, requireAdmin, requireDomainAccess];

/**
 * Domains a request may act on. Global admins get `null`, meaning unscoped;
 * domain admins get their explicit list, which the models turn into an
 * `IN (...)` filter.
 */
const domainScope = (req) =>
    req.adminInfo.adminType === "global" ? null : req.adminInfo.domains;

// A misconfigured vmail grant or a schema difference between iRedMail releases
// is otherwise indistinguishable from a bug, and costs a trip through the
// service logs to identify. These routes are admin-only, so naming the table
// and the privilege is safe and saves that trip.
const SCHEMA_ERRORS = {
    "42501": "the database refused the operation",
    "42P01": "a table the operation needs is missing",
    "42703": "a column the operation needs is missing",
};

const handle = (fn) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (error) {
        const status = error.status || 500;
        if (status >= 500) {
            console.error(`${req.method} ${req.originalUrl} failed:`, error);
        }

        const schemaError = SCHEMA_ERRORS[error.code];
        if (status >= 500 && schemaError) {
            return res.status(500).json({
                error: `Database permissions or schema problem: ${schemaError} (${error.message}). Re-run deploy/grants.sql to repair the grants.`,
                code: error.code,
            });
        }

        res.status(status).json({
            error: status >= 500 ? "Request failed" : error.message,
        });
    }
};

// Domains -------------------------------------------------------------------

router.get(
    "/domains",
    admin,
    handle(async (req, res) => {
        const domains = await Domain.list({
            domains: domainScope(req),
            search: req.query.search || "",
        });
        res.json({ success: true, domains });
    })
);

router.post(
    "/domains",
    globalAdmin,
    handle(async (req, res) => {
        const domain = await Domain.create(req.body);
        res.status(201).json({ success: true, domain });
    })
);

router.get(
    "/domains/:domain",
    scopedAdmin,
    handle(async (req, res) => {
        const domain = await Domain.findByName(req.params.domain);
        if (!domain) {
            return res.status(404).json({ error: "Domain not found" });
        }

        const [usage, admins, aliasDomains, catchAll] = await Promise.all([
            Domain.usage(req.params.domain),
            Domain.listAdmins(req.params.domain),
            Domain.listAliasDomains(req.params.domain),
            Domain.getCatchAll(req.params.domain),
        ]);

        res.json({
            success: true,
            domain: { ...domain, usage, admins, aliasDomains, catchAll },
        });
    })
);

router.put(
    "/domains/:domain",
    scopedAdmin,
    handle(async (req, res) => {
        const domain = await Domain.update(req.params.domain, req.body);
        res.json({ success: true, domain });
    })
);

router.delete(
    "/domains/:domain",
    globalAdmin,
    handle(async (req, res) => {
        await Domain.remove(req.params.domain);
        res.json({ success: true });
    })
);

router.get(
    "/domains/:domain/admins",
    scopedAdmin,
    handle(async (req, res) => {
        const admins = await Domain.listAdmins(req.params.domain);
        res.json({ success: true, admins });
    })
);

router.post(
    "/domains/:domain/admins",
    scopedAdmin,
    handle(async (req, res) => {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: "email is required" });
        }

        const target = await User.findByEmail(email);
        if (!target) {
            return res
                .status(404)
                .json({ error: "That mailbox does not exist" });
        }

        await Domain.addAdmin(req.params.domain, email);
        res.status(201).json({ success: true });
    })
);

router.delete(
    "/domains/:domain/admins/:email",
    scopedAdmin,
    handle(async (req, res) => {
        await Domain.removeAdmin(req.params.domain, req.params.email);
        res.json({ success: true });
    })
);

router.post(
    "/domains/:domain/alias-domains",
    scopedAdmin,
    handle(async (req, res) => {
        await Domain.addAliasDomain(req.params.domain, req.body.aliasDomain);
        const aliasDomains = await Domain.listAliasDomains(req.params.domain);
        res.status(201).json({ success: true, aliasDomains });
    })
);

router.delete(
    "/domains/:domain/alias-domains/:aliasDomain",
    scopedAdmin,
    handle(async (req, res) => {
        await Domain.removeAliasDomain(req.params.aliasDomain);
        res.json({ success: true });
    })
);

router.put(
    "/domains/:domain/catch-all",
    scopedAdmin,
    handle(async (req, res) => {
        const destinations = Array.isArray(req.body.destinations)
            ? req.body.destinations
            : [];
        await Domain.setCatchAll(req.params.domain, destinations);
        res.json({ success: true, catchAll: destinations });
    })
);

// Mailboxes -----------------------------------------------------------------

router.get(
    "/mailboxes",
    admin,
    handle(async (req, res) => {
        const { rows, total } = await Mailbox.list({
            domains: domainScope(req),
            search: req.query.search || "",
            limit: Math.min(parseInt(req.query.limit, 10) || 50, 200),
            offset: parseInt(req.query.offset, 10) || 0,
        });

        res.json({ success: true, mailboxes: rows, total });
    })
);

router.post(
    "/mailboxes",
    scopedAdmin,
    handle(async (req, res) => {
        const mailbox = await Mailbox.create(req.body);
        res.status(201).json({ success: true, mailbox });
    })
);

router.get(
    "/mailboxes/:email",
    scopedAdmin,
    handle(async (req, res) => {
        const mailbox = await Mailbox.findByEmail(req.params.email);
        if (!mailbox) {
            return res.status(404).json({ error: "Mailbox not found" });
        }

        const [forwardings, aliases, bcc, lastLogin] = await Promise.all([
            Mailbox.getForwardings(req.params.email),
            Mailbox.getAliasAddresses(req.params.email),
            Mailbox.getBcc(req.params.email),
            User.getLastLogin(req.params.email),
        ]);

        res.json({
            success: true,
            mailbox: { ...mailbox, forwardings, aliases, bcc, lastLogin },
        });
    })
);

router.put(
    "/mailboxes/:email",
    scopedAdmin,
    handle(async (req, res) => {
        const mailbox = await Mailbox.update(req.params.email, req.body);
        res.json({ success: true, mailbox });
    })
);

router.delete(
    "/mailboxes/:email",
    scopedAdmin,
    handle(async (req, res) => {
        if (req.params.email === req.user.email) {
            return res
                .status(400)
                .json({ error: "You cannot delete your own mailbox" });
        }

        const result = await Mailbox.remove(req.params.email, {
            deletedBy: req.user.email,
            keepMaildirDays: parseInt(
                process.env.DELETED_MAILDIR_KEEP_DAYS || "7",
                10
            ),
        });

        res.json({ success: true, ...result });
    })
);

router.put(
    "/mailboxes/:email/password",
    scopedAdmin,
    handle(async (req, res) => {
        const { password, scheme } = req.body;

        if (!password || password.length < 8) {
            return res
                .status(400)
                .json({ error: "Password must be at least 8 characters" });
        }
        if (scheme && !SUPPORTED_SCHEMES.includes(String(scheme).toUpperCase())) {
            return res.status(400).json({
                error: `Unsupported scheme. Use one of: ${SUPPORTED_SCHEMES.join(", ")}`,
            });
        }

        await User.changePassword(req.params.email, password, scheme);
        res.json({ success: true });
    })
);

router.get(
    "/mailboxes/:email/forwardings",
    scopedAdmin,
    handle(async (req, res) => {
        const forwardings = await Mailbox.getForwardings(req.params.email);
        res.json({ success: true, forwardings });
    })
);

router.put(
    "/mailboxes/:email/forwardings",
    scopedAdmin,
    handle(async (req, res) => {
        const forwardings = await Mailbox.setForwardings(
            req.params.email,
            req.body.destinations || [],
            req.body.keepCopy !== false
        );
        res.json({ success: true, forwardings });
    })
);

router.put(
    "/mailboxes/:email/aliases",
    scopedAdmin,
    handle(async (req, res) => {
        const aliases = await Mailbox.setAliasAddresses(
            req.params.email,
            req.body.addresses || []
        );
        res.json({ success: true, aliases });
    })
);

router.put(
    "/mailboxes/:email/bcc",
    scopedAdmin,
    handle(async (req, res) => {
        const bcc = await Mailbox.setBcc(req.params.email, {
            sender: req.body.sender,
            recipient: req.body.recipient,
        });
        res.json({ success: true, bcc });
    })
);

// Standalone aliases --------------------------------------------------------

router.get(
    "/aliases",
    admin,
    handle(async (req, res) => {
        const aliases = await Alias.list({
            domains: domainScope(req),
            search: req.query.search || "",
        });
        res.json({ success: true, aliases });
    })
);

router.post(
    "/aliases",
    scopedAdmin,
    handle(async (req, res) => {
        const alias = await Alias.create(req.body);
        res.status(201).json({ success: true, alias });
    })
);

router.get(
    "/aliases/:address",
    scopedAdmin,
    handle(async (req, res) => {
        const alias = await Alias.findByAddress(req.params.address);
        if (!alias) {
            return res.status(404).json({ error: "Alias not found" });
        }
        res.json({ success: true, alias });
    })
);

router.put(
    "/aliases/:address",
    scopedAdmin,
    handle(async (req, res) => {
        const alias = await Alias.update(req.params.address, req.body);
        res.json({ success: true, alias });
    })
);

router.delete(
    "/aliases/:address",
    scopedAdmin,
    handle(async (req, res) => {
        await Alias.remove(req.params.address);
        res.json({ success: true });
    })
);

module.exports = router;
