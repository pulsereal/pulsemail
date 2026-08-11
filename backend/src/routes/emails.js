const express = require("express");
const multer = require("multer");
const {
    mailService,
    getEmailStats,
    useMockData,
} = require("../services/MailService");
const LLMService = require("../services/LLMService");
const SpamService = require("../services/SpamService");
const AutomationService = require("../services/AutomationService");
const LLMSettingsService = require("../services/LLMSettingsService");
const {
    ImportanceService,
    CATEGORIES,
} = require("../services/ImportanceService");
const { query } = require("../config/database");
const {
    authenticateToken,
    resolveMailboxScope,
    emailRateLimit,
    authenticateAppPassword,
} = require("../middleware/auth");

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 5, // Max 5 files
    },
});

// Mailbox-scoped routes operate on req.mailbox, which is the caller's own
// address unless an admin targeted another mailbox via the X-Mailbox header.
const scoped = [authenticateToken, resolveMailboxScope];

const emailService = mailService;
const llmService = new LLMService();
const spamService = new SpamService();
const automationService = AutomationService.shared();
const importanceService = ImportanceService.shared();
const llmSettings = LLMSettingsService.shared();

// Get emails with pagination and filtering
router.get("/", scoped, async (req, res) => {
    try {
        const email = req.mailbox;
        const {
            folder = "INBOX",
            limit = 50,
            offset = 0,
            search,
            category,
            unread_only,
            priority,
        } = req.query;

        const pageLimit = parseInt(limit);
        const pageOffset = parseInt(offset);

        const status = await emailService
            .getFolderStatus(email, folder)
            .catch(() => null);
        const uidvalidity = status?.uidvalidity ?? 0;

        let emails;
        // Total for the listing actually being returned. Null means "unknown",
        // which the client shows as an inexact count.
        let listingTotal = null;

        if (search) {
            const searchCriteria = [
                ["OR", ["SUBJECT", search], ["FROM", search], ["BODY", search]],
            ];
            emails = await emailService.searchEmails(
                email,
                searchCriteria,
                folder
            );
        } else if (priority === "true") {
            // The priority view is driven by stored scores rather than by
            // arrival order, so its UIDs come from the database and only those
            // messages are pulled from IMAP.
            const ranked = await importanceService.priorityUids(
                email,
                folder,
                uidvalidity,
                { limit: pageLimit, offset: pageOffset }
            );

            emails = await emailService.getEmailsByUids(
                email,
                folder,
                ranked.uids
            );

            const order = new Map(ranked.uids.map((uid, i) => [uid, i]));
            emails.sort((a, b) => order.get(a.uid) - order.get(b.uid));
            listingTotal = ranked.total;
        } else {
            emails = await emailService.getEmails(
                email,
                folder,
                pageLimit,
                pageOffset
            );
            listingTotal = status?.total ?? null;
        }

        // Scores are read, never computed here. Anything the background worker
        // has not reached yet simply comes back without an importance.
        await importanceService
            .attachStored(email, folder, emails, uidvalidity)
            .catch(() => emails);

        if (category && category !== "all") {
            emails = emails.filter((item) => item.category === category);
            listingTotal = null;
        }

        if (unread_only === "true") {
            emails = emails.filter(
                (item) => !(item.flags || []).includes("\\Seen")
            );
            listingTotal = null;
        }

        res.json({
            success: true,
            mailbox: email,
            impersonating: req.isImpersonating,
            emails,
            pagination: {
                limit: pageLimit,
                offset: pageOffset,
                total: listingTotal ?? emails.length,
                unseen: status?.unseen,
                exact: listingTotal !== null,
            },
        });
    } catch (error) {
        console.error("Get emails error:", error);
        res.status(500).json({ error: "Failed to fetch emails" });
    }
});

// Get single email content
router.get("/:uid", scoped, async (req, res) => {
    try {
        const email = req.mailbox;
        const { uid } = req.params;
        const { folder = "INBOX" } = req.query;

        const emailContent = await emailService.getEmailContent(
            email,
            uid,
            folder
        );

        if (!emailContent) {
            return res.status(404).json({ error: "Email not found" });
        }

        // Summarising costs an LLM round trip on every message opened, so it
        // only happens when an administrator has explicitly turned it on.
        const settings = await llmSettings.get().catch(() => null);
        if (settings?.enabled && settings.summaries_enabled) {
            try {
                emailContent.summary = await llmService.summarizeEmail(
                    emailContent.text || emailContent.html || ""
                );
            } catch (error) {
                console.error("Error generating summary:", error);
            }
        }

        try {
            const stored = await query(
                `SELECT category, importance, reason FROM email_classifications
                  WHERE user_email = $1
                    AND message_key = COALESCE(NULLIF($2, ''), $3)`,
                [
                    email,
                    emailContent.messageId || "",
                    `loc:${folder}:${emailContent.uidvalidity ?? 0}:${uid}`,
                ]
            );

            if (stored.rows.length > 0) {
                emailContent.category = stored.rows[0].category;
                emailContent.importance = stored.rows[0].importance;
                emailContent.importanceReason = stored.rows[0].reason;
            }
        } catch (error) {
            console.error("Error reading classification:", error);
        }

        res.json({
            success: true,
            email: emailContent,
        });
    } catch (error) {
        console.error("Get email content error:", error);
        res.status(500).json({ error: "Failed to fetch email content" });
    }
});

// Send email
router.post(
    "/send",
    scoped,
    emailRateLimit,
    upload.array("attachments"),
    async (req, res) => {
        try {
            const email = req.mailbox;
            const {
                to,
                cc,
                bcc,
                subject,
                content,
                test_spam = false,
            } = req.body;

            if (!to || !subject || !content) {
                return res
                    .status(400)
                    .json({ error: "To, subject, and content are required" });
            }

            // Parse recipients
            const recipients = Array.isArray(to) ? to : [to];
            const ccRecipients = cc ? (Array.isArray(cc) ? cc : [cc]) : [];
            const bccRecipients = bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : [];

            // Process attachments
            const attachments = req.files
                ? req.files.map((file) => ({
                      filename: file.originalname,
                      content: file.buffer,
                      contentType: file.mimetype,
                  }))
                : [];

            // Test for spam if requested
            let spamResult = null;
            if (test_spam === "true" || test_spam === true) {
                try {
                    spamResult = await spamService.testSpam(
                        content,
                        email,
                        recipients[0]
                    );

                    if (spamResult.isSpam && spamResult.score > 7.0) {
                        return res.status(400).json({
                            error: "Email content appears to be spam",
                            spamResult,
                            recommendations: spamResult.recommendations,
                        });
                    }
                } catch (error) {
                    console.error("Spam test error:", error);
                    // Continue sending even if spam test fails
                }
            }

            // Send email to all recipients
            const results = [];
            const allRecipients = [
                ...recipients,
                ...ccRecipients,
                ...bccRecipients,
            ];

            for (const recipient of allRecipients) {
                try {
                    const result = await emailService.sendEmail(
                        email,
                        recipient,
                        subject,
                        content,
                        attachments
                    );
                    results.push({
                        recipient,
                        status: "sent",
                        messageId: result.messageId,
                    });
                } catch (error) {
                    results.push({
                        recipient,
                        status: "failed",
                        error: error.message,
                    });
                }
            }

            const failedCount = results.filter(
                (r) => r.status === "failed"
            ).length;
            const successCount = results.filter(
                (r) => r.status === "sent"
            ).length;

            res.json({
                success: successCount > 0,
                results,
                summary: {
                    sent: successCount,
                    failed: failedCount,
                    total: allRecipients.length,
                },
                spamResult,
            });
        } catch (error) {
            console.error("Send email error:", error);
            res.status(500).json({ error: "Failed to send email" });
        }
    }
);

// Generate AI reply
router.post("/:uid/reply", scoped, async (req, res) => {
    try {
        const email = req.mailbox;
        const { uid } = req.params;
        const {
            folder = "INBOX",
            tone = "professional",
            language = "en",
            custom_instructions = "",
        } = req.body;

        // Get original email content
        const originalEmail = await emailService.getEmailContent(
            email,
            uid,
            folder
        );

        if (!originalEmail) {
            return res.status(404).json({ error: "Original email not found" });
        }

        const senderAddress =
            originalEmail.from?.value?.[0]?.address ||
            originalEmail.from?.text ||
            "";

        // Generate reply using LLM
        const replyResult = await llmService.generateReply(
            originalEmail.text || originalEmail.html || "",
            senderAddress,
            email,
            {
                tone,
                language,
                customInstructions: custom_instructions,
            }
        );

        res.json({
            success: true,
            reply: replyResult.reply,
            analysis: replyResult.analysis,
            confidence: replyResult.confidence,
            suggestions: replyResult.suggestions,
            originalEmail: {
                from: originalEmail.from,
                subject: originalEmail.subject,
                date: originalEmail.date,
            },
        });
    } catch (error) {
        console.error("Generate reply error:", error);
        res.status(500).json({ error: "Failed to generate reply" });
    }
});

// IMAP flags a client is allowed to set, keyed by the action name
const MARK_FLAGS = {
    read: { flag: "\\Seen", add: true },
    unread: { flag: "\\Seen", add: false },
    flagged: { flag: "\\Flagged", add: true },
    unflagged: { flag: "\\Flagged", add: false },
    answered: { flag: "\\Answered", add: true },
};

// Mark email read/unread or set the star
router.patch("/:uid/mark", scoped, async (req, res) => {
    try {
        const email = req.mailbox;
        const { uid } = req.params;
        const { action, folder = "INBOX" } = req.body;

        const mark = MARK_FLAGS[action];
        if (!mark) {
            return res.status(400).json({
                error: `Action must be one of: ${Object.keys(MARK_FLAGS).join(", ")}`,
            });
        }

        await emailService.markEmail(email, uid, mark.flag, mark.add, folder);

        res.json({ success: true, message: `Email marked as ${action}` });
    } catch (error) {
        console.error("Mark email error:", error);
        res.status(500).json({ error: "Failed to mark email" });
    }
});

/**
 * Delete moves to Trash; pass ?permanent=true (or delete from Trash) to expunge.
 */
router.delete("/:uid", scoped, async (req, res) => {
    try {
        const email = req.mailbox;
        const { uid } = req.params;
        const { folder = "INBOX", permanent } = req.query;

        const result = await emailService.deleteEmail(email, uid, folder, {
            permanent: permanent === "true",
        });

        res.json({
            success: true,
            message: result?.expunged
                ? "Email permanently deleted"
                : `Email moved to ${result?.movedTo || "Trash"}`,
            ...result,
        });
    } catch (error) {
        console.error("Delete email error:", error);
        res.status(500).json({ error: "Failed to delete email" });
    }
});

// Report as spam / not spam by moving between Junk and INBOX
router.patch("/:uid/spam", scoped, async (req, res) => {
    try {
        const { uid } = req.params;
        const { folder = "INBOX", spam = true } = req.body;

        const result = await emailService.setSpam(
            req.mailbox,
            uid,
            spam !== false,
            folder
        );

        res.json({
            success: true,
            message: spam !== false ? "Reported as spam" : "Marked as not spam",
            ...result,
        });
    } catch (error) {
        console.error("Spam action error:", error);
        res.status(500).json({ error: "Failed to update spam status" });
    }
});

// Download a single attachment
router.get("/:uid/attachments/:index", scoped, async (req, res) => {
    try {
        const { uid, index } = req.params;
        const { folder = "INBOX" } = req.query;

        const attachment = await emailService.getAttachment(
            req.mailbox,
            uid,
            index,
            folder
        );

        if (!attachment) {
            return res.status(404).json({ error: "Attachment not found" });
        }

        // Never let the browser render an attachment inline
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${encodeURIComponent(attachment.filename)}"`
        );
        res.send(attachment.content);
    } catch (error) {
        console.error("Attachment download error:", error);
        res.status(500).json({ error: "Failed to download attachment" });
    }
});

// Raw RFC822 source, for "view source" and .eml export
router.get("/:uid/source", scoped, async (req, res) => {
    try {
        const { uid } = req.params;
        const { folder = "INBOX", download } = req.query;

        const raw = await emailService.getRawMessage(req.mailbox, uid, folder);
        if (!raw) return res.status(404).json({ error: "Message not found" });

        if (download === "true") {
            res.setHeader("Content-Type", "message/rfc822");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="message-${uid}.eml"`
            );
        } else {
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
        }

        res.send(raw);
    } catch (error) {
        console.error("Message source error:", error);
        res.status(500).json({ error: "Failed to load message source" });
    }
});

// Save (or replace) a draft in the Drafts folder
router.post("/drafts", scoped, upload.array("attachments", 5), async (req, res) => {
    try {
        const { to, cc, bcc, subject, content, inReplyTo, references, replaceUid } =
            req.body;

        const result = await emailService.saveDraft(
            req.mailbox,
            {
                from: req.mailbox,
                to,
                cc,
                bcc,
                subject,
                html: content,
                inReplyTo,
                references,
                attachments: (req.files || []).map((file) => ({
                    filename: file.originalname,
                    content: file.buffer,
                    contentType: file.mimetype,
                })),
            },
            { replaceUid: replaceUid || null }
        );

        res.json({ success: true, message: "Draft saved", ...result });
    } catch (error) {
        console.error("Save draft error:", error);
        res.status(500).json({ error: "Failed to save draft" });
    }
});

// Folder management
router.post("/folders", scoped, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: "Folder name is required" });
        }

        await emailService.createFolder(req.mailbox, name.trim());
        res.status(201).json({ success: true, message: "Folder created" });
    } catch (error) {
        console.error("Create folder error:", error);
        res.status(400).json({
            error: error.message || "Failed to create folder",
        });
    }
});

router.put("/folders/:name", scoped, async (req, res) => {
    try {
        const { newName } = req.body;
        if (!newName || !newName.trim()) {
            return res.status(400).json({ error: "New name is required" });
        }

        await emailService.renameFolder(
            req.mailbox,
            req.params.name,
            newName.trim()
        );
        res.json({ success: true, message: "Folder renamed" });
    } catch (error) {
        console.error("Rename folder error:", error);
        res.status(400).json({
            error: error.message || "Failed to rename folder",
        });
    }
});

router.delete("/folders/:name", scoped, async (req, res) => {
    try {
        const name = req.params.name;

        // Removing a special-use folder would break delivery and Sieve rules
        if (["inbox", "sent", "drafts", "trash", "junk"].includes(name.toLowerCase())) {
            return res
                .status(400)
                .json({ error: `${name} is a system folder and cannot be deleted` });
        }

        await emailService.deleteFolder(req.mailbox, name);
        res.json({ success: true, message: "Folder deleted" });
    } catch (error) {
        console.error("Delete folder error:", error);
        res.status(400).json({
            error: error.message || "Failed to delete folder",
        });
    }
});

// Move email to folder
router.patch("/:uid/move", scoped, async (req, res) => {
    try {
        const email = req.mailbox;
        const { uid } = req.params;
        const { target_folder, source_folder = "INBOX" } = req.body;

        if (!target_folder) {
            return res.status(400).json({ error: "Target folder is required" });
        }

        await emailService.moveEmail(email, uid, target_folder, source_folder);

        res.json({
            success: true,
            message: `Email moved to ${target_folder}`,
        });
    } catch (error) {
        console.error("Move email error:", error);
        res.status(500).json({ error: "Failed to move email" });
    }
});

// Get email folders
router.get("/folders/list", scoped, async (req, res) => {
    try {
        const folders = await emailService.getFolders(req.mailbox);

        res.json({
            success: true,
            mailbox: req.mailbox,
            folders,
        });
    } catch (error) {
        console.error("Get folders error:", error);
        res.status(500).json({ error: "Failed to get folders" });
    }
});

// Test spam for email content
router.post("/test-spam", scoped, async (req, res) => {
    try {
        const { content, recipient } = req.body;

        if (!content) {
            return res.status(400).json({ error: "Content is required" });
        }

        const spamResult = await spamService.testSpam(
            content,
            req.mailbox,
            recipient || "test@example.com"
        );

        res.json({
            success: true,
            spamResult,
        });
    } catch (error) {
        console.error("Test spam error:", error);
        res.status(500).json({ error: "Failed to test spam" });
    }
});

// Get email statistics
router.get("/stats/dashboard", scoped, async (req, res) => {
    try {
        const email = req.mailbox;

        // Get email statistics
        const emailStats = await getEmailStats(email);

        // Get LLM reply statistics
        const llmStats = await llmService.getReplyStats(email);

        // Get automation statistics
        const automationStats = automationService
            ? await automationService.getAutomationStats(email)
            : { total_rules: 0, active_rules: 0, total_executions: 0 };

        res.json({
            success: true,
            stats: {
                emails: emailStats,
                llm: llmStats,
                automation: automationStats,
            },
        });
    } catch (error) {
        console.error("Get stats error:", error);
        res.status(500).json({ error: "Failed to get statistics" });
    }
});

// Search emails with advanced filters
router.post("/search", scoped, async (req, res) => {
    try {
        const email = req.mailbox;
        const {
            query: searchQuery,
            folder = "INBOX",
            sender,
            subject,
            date_from,
            date_to,
            has_attachments,
            category,
        } = req.body;

        let searchCriteria = [];

        // Build search criteria
        if (searchQuery) {
            searchCriteria.push([
                "OR",
                ["SUBJECT", searchQuery],
                ["FROM", searchQuery],
                ["BODY", searchQuery],
            ]);
        }

        if (sender) {
            searchCriteria.push(["FROM", sender]);
        }

        if (subject) {
            searchCriteria.push(["SUBJECT", subject]);
        }

        if (date_from) {
            searchCriteria.push(["SINCE", new Date(date_from)]);
        }

        if (date_to) {
            searchCriteria.push(["BEFORE", new Date(date_to)]);
        }

        if (has_attachments === true) {
            searchCriteria.push(["HEADER", "CONTENT-TYPE", "MULTIPART"]);
        }

        // Combine all criteria with AND
        const finalCriteria =
            searchCriteria.length > 1
                ? ["AND", ...searchCriteria]
                : searchCriteria[0] || ["ALL"];

        let emails = await emailService.searchEmails(
            email,
            finalCriteria,
            folder
        );

        await importanceService
            .attachStored(email, folder, emails)
            .catch(() => emails);

        if (category && category !== "all") {
            emails = emails.filter((item) => item.category === category);
        }

        res.json({
            success: true,
            mailbox: email,
            emails,
            total: emails.length,
        });
    } catch (error) {
        console.error("Search emails error:", error);
        res.status(500).json({ error: "Failed to search emails" });
    }
});

// Correct the classifier. A manual verdict is pinned, so the background pass
// will not overwrite it later.
router.patch("/:uid/categorize", scoped, async (req, res) => {
    try {
        const email = req.mailbox;
        const { uid } = req.params;
        const { category, importance, folder = "INBOX" } = req.body;

        if (category && !CATEGORIES.includes(category)) {
            return res.status(400).json({
                error: "Invalid category",
                validCategories: CATEGORIES,
            });
        }

        const status = await emailService
            .getFolderStatus(email, folder)
            .catch(() => null);

        const [item] = await emailService.getEmailsByUids(email, folder, [
            Number(uid),
        ]);

        if (!item) {
            return res.status(404).json({ error: "Email not found" });
        }

        await importanceService.setManual(
            email,
            folder,
            { ...item, uidvalidity: status?.uidvalidity ?? 0 },
            {
                category: category || "other",
                importance:
                    importance ?? (category === "important" ? 90 : 20),
            }
        );

        res.json({
            success: true,
            message: `Email categorized as ${category}`,
        });
    } catch (error) {
        console.error("Categorize email error:", error);
        res.status(500).json({ error: "Failed to categorize email" });
    }
});

// Provide feedback on LLM generated reply
router.post("/llm-feedback", authenticateToken, async (req, res) => {
    try {
        const { log_id, rating, feedback = "" } = req.body;

        if (!log_id || !rating) {
            return res
                .status(400)
                .json({ error: "Log ID and rating are required" });
        }

        if (rating < 1 || rating > 5) {
            return res
                .status(400)
                .json({ error: "Rating must be between 1 and 5" });
        }

        await llmService.provideFeedback(log_id, rating, feedback);

        res.json({
            success: true,
            message: "Feedback provided successfully",
        });
    } catch (error) {
        console.error("LLM feedback error:", error);
        res.status(500).json({ error: "Failed to provide feedback" });
    }
});

// Email endpoint for external integrations (using app passwords)
router.post(
    "/external/send",
    authenticateAppPassword,
    emailRateLimit,
    async (req, res) => {
        try {
            const { email } = req.user;
            const { to, subject, content, attachments = [] } = req.body;

            if (!to || !subject || !content) {
                return res
                    .status(400)
                    .json({ error: "To, subject, and content are required" });
            }

            const result = await emailService.sendEmail(
                email,
                to,
                subject,
                content,
                attachments
            );

            res.json({
                success: true,
                messageId: result.messageId,
                message: "Email sent successfully",
            });
        } catch (error) {
            console.error("External send email error:", error);
            res.status(500).json({ error: "Failed to send email" });
        }
    }
);

module.exports = router;
