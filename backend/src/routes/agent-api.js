const express = require("express");
const validator = require("validator");
const { mailService } = require("../services/MailService");
const AgentService = require("../services/AgentService");
const { toAgentEmail, sentEmailPayload } = require("../services/AgentService");
const { buildSearchCriteria } = require("../utils/imapSearch");
const {
    authenticateAgent,
    requireAgentMailbox,
    requireAgentDirectory,
    requireAgentGlobalScope,
} = require("../middleware/agentAuth");
const {
    agentApiRateLimit,
    agentSendRateLimit,
    requireDomainAccess,
} = require("../middleware/auth");
const { buildProvisioningRouter } = require("./provisioning");
const { buildMailboxSettingsRouter } = require("./mailbox-settings");

// The API an agent calls back into with its key. Every mailbox route is
// gated on one permission (read, send, modify or settings) and on the agent's
// scope. Mail responses use the same snake_case shape as the webhook payloads;
// /admin and /mailboxes/:mailbox/settings reuse the admin panel's own routes
// and so return their shapes unchanged.

const router = express.Router();
const agents = AgentService.shared();

const read = requireAgentMailbox("read");
const send = requireAgentMailbox("send");
const modify = requireAgentMailbox("modify");

const MAX_RECIPIENTS = 50;
const MAX_PAGE = 100;

// Removing a special-use folder would break delivery and Sieve rules.
const SYSTEM_FOLDERS = ["inbox", "sent", "drafts", "trash", "junk"];

const MARK_FLAGS = {
    read: { flag: "\\Seen", add: true },
    unread: { flag: "\\Seen", add: false },
    flagged: { flag: "\\Flagged", add: true },
    unflagged: { flag: "\\Flagged", add: false },
    answered: { flag: "\\Answered", add: true },
};

const httpError = (status, message) =>
    Object.assign(new Error(message), { status });

const handle = (fn) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (error) {
        const status = error.status || 500;
        if (status >= 500) {
            console.error(
                `Agent API ${req.method} ${req.originalUrl} failed:`,
                error
            );
        }
        res.status(status).json({
            error: status >= 500 ? "Request failed" : error.message,
        });
    }
};

const folderOf = (req) =>
    String(req.query.folder || req.body?.folder || "INBOX");

const summary = (item) => ({
    uid: String(item.uid),
    folder: item.folder,
    message_id: item.messageId || null,
    from: { address: item.fromAddress || "", name: item.fromName || "" },
    to: item.to || "",
    subject: item.subject || "",
    date: item.date || null,
    flags: item.flags || [],
    size: item.size || 0,
    has_attachments: Boolean(item.hasAttachments),
    url: `/api/agent/mailboxes/${encodeURIComponent(item.mailbox)}/emails/${encodeURIComponent(item.uid)}?folder=${encodeURIComponent(item.folder)}`,
});

const recipients = (value, label, { required = false } = {}) => {
    const list = (Array.isArray(value) ? value : String(value || "").split(","))
        .map((address) => String(address).trim())
        .filter(Boolean);

    if (required && list.length === 0) {
        throw httpError(400, `At least one "${label}" recipient is required`);
    }
    const invalid = list.filter((address) => !validator.isEmail(address));
    if (invalid.length > 0) {
        throw httpError(400, `Invalid ${label} address: ${invalid.join(", ")}`);
    }
    return list;
};

const bodyOf = (body) => {
    const html = typeof body.html === "string" && body.html ? body.html : null;
    const text = typeof body.text === "string" && body.text ? body.text : null;
    if (!html && !text) {
        throw httpError(400, 'Provide "html" or "text" for the message body');
    }
    return { html, text };
};

const deliver = async (req, message) => {
    const total = message.to.length + message.cc.length + message.bcc.length;
    if (total > MAX_RECIPIENTS) {
        throw httpError(
            400,
            `At most ${MAX_RECIPIENTS} recipients per message`
        );
    }

    const result = await mailService.sendEmail(
        req.mailbox,
        message.to,
        message.subject,
        message.html ?? undefined,
        [],
        {
            cc: message.cc.length ? message.cc : undefined,
            bcc: message.bcc.length ? message.bcc : undefined,
            text: message.text ?? undefined,
            inReplyTo: message.inReplyTo,
            references: message.references,
        }
    );

    await agents.publish(
        "email.sent",
        req.mailbox,
        sentEmailPayload({
            mailbox: req.mailbox,
            ...message,
            messageId: result.messageId,
            via: "agent",
            agentId: req.agent.id,
        }),
        result.messageId
    );

    return result;
};

router.use(authenticateAgent, agentApiRateLimit);

router.use(
    "/admin",
    buildProvisioningRouter({
        admin: [requireAgentDirectory("provision")],
        globalAdmin: [
            requireAgentDirectory("provision"),
            requireAgentGlobalScope,
        ],
        scopedAdmin: [requireAgentDirectory("provision"), requireDomainAccess],
        grantAdmins: [requireAgentDirectory("admins"), requireDomainAccess],
    })
);

router.use(
    "/mailboxes/:mailbox/settings",
    buildMailboxSettingsRouter([requireAgentMailbox("settings")])
);

router.get(
    "/me",
    handle(async (req, res) => {
        const agent = req.agent;
        const directory = await agents.effectiveAdminInfo(agent);
        res.json({
            success: true,
            agent: {
                id: agent.id,
                name: agent.name,
                scope_all: agent.scope_all,
                domains: agent.domains || [],
                mailboxes: agent.mailboxes || [],
                events: agent.events || [],
                permissions: agent.permissions || [],
                webhook_configured: Boolean(agent.webhook_url),
                administers: directory.isAdmin
                    ? directory.adminType === "global"
                        ? "all"
                        : directory.domains
                    : [],
            },
        });
    })
);

router.get(
    "/mailboxes",
    handle(async (req, res) => {
        const mailboxes = await agents.mailboxesFor(req.agent);
        res.json({
            success: true,
            mailboxes: mailboxes.map((row) => ({
                address: row.email,
                name: row.name || "",
                domain: row.domain,
            })),
        });
    })
);

router.get(
    "/mailboxes/:mailbox/folders",
    read,
    handle(async (req, res) => {
        res.json({
            success: true,
            folders: await mailService.getFolders(req.mailbox),
        });
    })
);

router.get(
    "/mailboxes/:mailbox/emails",
    read,
    handle(async (req, res) => {
        const folder = folderOf(req);
        const limit = Math.min(
            MAX_PAGE,
            Math.max(1, parseInt(req.query.limit, 10) || 25)
        );
        const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

        const [status, emails] = await Promise.all([
            mailService.getFolderStatus(req.mailbox, folder),
            mailService.getEmails(req.mailbox, folder, limit, offset),
        ]);

        res.json({
            success: true,
            mailbox: req.mailbox,
            folder,
            emails: emails.map(summary),
            pagination: {
                limit,
                offset,
                total: status?.total ?? null,
                unseen: status?.unseen ?? null,
            },
        });
    })
);

router.post(
    "/mailboxes/:mailbox/search",
    read,
    handle(async (req, res) => {
        const folder = folderOf(req);
        const body = req.body || {};
        const limit = Math.min(
            MAX_PAGE,
            Math.max(1, parseInt(body.limit, 10) || 50)
        );

        const emails = await mailService.searchEmails(
            req.mailbox,
            buildSearchCriteria({
                query: body.query,
                sender: body.sender,
                subject: body.subject,
                dateFrom: body.date_from,
                dateTo: body.date_to,
                hasAttachments: body.has_attachments === true,
            }),
            folder,
            limit
        );

        res.json({
            success: true,
            mailbox: req.mailbox,
            folder,
            emails: emails.slice(0, limit).map(summary),
        });
    })
);

router.get(
    "/mailboxes/:mailbox/emails/:uid",
    read,
    handle(async (req, res) => {
        const content = await mailService.getEmailContent(
            req.mailbox,
            req.params.uid,
            folderOf(req)
        );
        if (!content) throw httpError(404, "Email not found");

        res.json({
            success: true,
            mailbox: req.mailbox,
            email: toAgentEmail(content),
        });
    })
);

router.get(
    "/mailboxes/:mailbox/emails/:uid/attachments/:index",
    read,
    handle(async (req, res) => {
        const attachment = await mailService.getAttachment(
            req.mailbox,
            req.params.uid,
            req.params.index,
            folderOf(req)
        );
        if (!attachment) throw httpError(404, "Attachment not found");

        res.setHeader(
            "Content-Type",
            attachment.contentType || "application/octet-stream"
        );
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${encodeURIComponent(attachment.filename)}"`
        );
        res.send(attachment.content);
    })
);

router.post(
    "/mailboxes/:mailbox/send",
    send,
    agentSendRateLimit,
    handle(async (req, res) => {
        const body = req.body || {};
        const subject = String(body.subject || "").trim();
        if (!subject) throw httpError(400, "A subject is required");

        const message = {
            to: recipients(body.to, "to", { required: true }),
            cc: recipients(body.cc, "cc"),
            bcc: recipients(body.bcc, "bcc"),
            subject,
            ...bodyOf(body),
        };

        const result = await deliver(req, message);
        res.status(201).json({ success: true, message_id: result.messageId });
    })
);

router.post(
    "/mailboxes/:mailbox/emails/:uid/reply",
    send,
    agentSendRateLimit,
    handle(async (req, res) => {
        const body = req.body || {};
        const folder = folderOf(req);

        const original = await mailService.getEmailContent(
            req.mailbox,
            req.params.uid,
            folder
        );
        if (!original) throw httpError(404, "Email not found");

        const view = toAgentEmail(original);
        const self = req.mailbox;
        const addresses = (list) =>
            list.map((entry) => entry.address).filter(Boolean);

        const to = addresses(
            view.reply_to.length ? view.reply_to : [view.from].filter(Boolean)
        );
        if (to.length === 0) {
            throw httpError(
                422,
                "The original message has no address to reply to"
            );
        }

        const cc = body.reply_all
            ? [
                  ...new Set([...addresses(view.to), ...addresses(view.cc)]),
              ].filter((address) => address !== self && !to.includes(address))
            : [];

        const priorReferences = Array.isArray(original.references)
            ? original.references
            : original.references
              ? String(original.references).split(/\s+/)
              : [];

        const message = {
            to,
            cc: [...cc, ...recipients(body.cc, "cc")],
            bcc: recipients(body.bcc, "bcc"),
            subject: /^re:/i.test(view.subject)
                ? view.subject
                : `Re: ${view.subject}`,
            ...bodyOf(body),
            inReplyTo: view.message_id || undefined,
            references:
                [...priorReferences, view.message_id]
                    .filter(Boolean)
                    .join(" ") || undefined,
        };

        const result = await deliver(req, message);

        await mailService
            .markEmail(req.mailbox, req.params.uid, "\\Answered", true, folder)
            .catch(() => null);

        res.status(201).json({
            success: true,
            message_id: result.messageId,
            to: message.to,
            cc: message.cc,
            subject: message.subject,
        });
    })
);

router.patch(
    "/mailboxes/:mailbox/emails/:uid/mark",
    modify,
    handle(async (req, res) => {
        const mark = MARK_FLAGS[req.body?.action];
        if (!mark) {
            throw httpError(
                400,
                `Action must be one of: ${Object.keys(MARK_FLAGS).join(", ")}`
            );
        }

        await mailService.markEmail(
            req.mailbox,
            req.params.uid,
            mark.flag,
            mark.add,
            folderOf(req)
        );
        res.json({ success: true });
    })
);

router.patch(
    "/mailboxes/:mailbox/emails/:uid/move",
    modify,
    handle(async (req, res) => {
        const target = String(req.body?.target || "").trim();
        if (!target) throw httpError(400, 'A "target" folder is required');

        await mailService.moveEmail(
            req.mailbox,
            req.params.uid,
            target,
            folderOf(req)
        );
        res.json({ success: true });
    })
);

router.patch(
    "/mailboxes/:mailbox/emails/:uid/spam",
    modify,
    handle(async (req, res) => {
        const result = await mailService.setSpam(
            req.mailbox,
            req.params.uid,
            req.body?.spam !== false,
            folderOf(req)
        );
        res.json({ success: true, ...result });
    })
);

/** Moves to Trash; ?permanent=true, or deleting from Trash, expunges. */
router.delete(
    "/mailboxes/:mailbox/emails/:uid",
    modify,
    handle(async (req, res) => {
        const result = await mailService.deleteEmail(
            req.mailbox,
            req.params.uid,
            folderOf(req),
            { permanent: req.query.permanent === "true" }
        );
        res.json({ success: true, ...result });
    })
);

router.get(
    "/mailboxes/:mailbox/emails/:uid/source",
    read,
    handle(async (req, res) => {
        const raw = await mailService.getRawMessage(
            req.mailbox,
            req.params.uid,
            folderOf(req)
        );
        if (!raw) throw httpError(404, "Email not found");

        res.setHeader("Content-Type", "message/rfc822");
        res.send(raw);
    })
);

router.post(
    "/mailboxes/:mailbox/drafts",
    modify,
    handle(async (req, res) => {
        const body = req.body || {};
        const result = await mailService.saveDraft(
            req.mailbox,
            {
                from: req.mailbox,
                to: recipients(body.to, "to"),
                cc: recipients(body.cc, "cc"),
                bcc: recipients(body.bcc, "bcc"),
                subject: String(body.subject || ""),
                html: typeof body.html === "string" ? body.html : undefined,
                text: typeof body.text === "string" ? body.text : undefined,
                inReplyTo: body.in_reply_to || undefined,
                references: body.references || undefined,
            },
            { replaceUid: body.replace_uid || null }
        );
        res.status(201).json({ success: true, ...result });
    })
);

/** IMAP rejects bad names with a readable reason, so pass it through. */
const folderOperation = (operation) =>
    operation().catch((error) => {
        throw httpError(400, error.message || "Folder operation failed");
    });

router.post(
    "/mailboxes/:mailbox/folders",
    modify,
    handle(async (req, res) => {
        const name = String(req.body?.name || "").trim();
        if (!name) throw httpError(400, 'A folder "name" is required');

        await folderOperation(() =>
            mailService.createFolder(req.mailbox, name)
        );
        res.status(201).json({ success: true });
    })
);

router.put(
    "/mailboxes/:mailbox/folders/:name",
    modify,
    handle(async (req, res) => {
        const newName = String(req.body?.new_name || "").trim();
        if (!newName) throw httpError(400, 'A "new_name" is required');
        if (SYSTEM_FOLDERS.includes(req.params.name.toLowerCase())) {
            throw httpError(400, `${req.params.name} is a system folder`);
        }

        await folderOperation(() =>
            mailService.renameFolder(req.mailbox, req.params.name, newName)
        );
        res.json({ success: true });
    })
);

router.delete(
    "/mailboxes/:mailbox/folders/:name",
    modify,
    handle(async (req, res) => {
        if (SYSTEM_FOLDERS.includes(req.params.name.toLowerCase())) {
            throw httpError(
                400,
                `${req.params.name} is a system folder and cannot be deleted`
            );
        }

        await folderOperation(() =>
            mailService.deleteFolder(req.mailbox, req.params.name)
        );
        res.json({ success: true });
    })
);

module.exports = router;
