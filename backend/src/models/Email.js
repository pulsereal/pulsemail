const { query } = require("../config/database");
const nodemailer = require("nodemailer");
const Imap = require("imap");
const { simpleParser } = require("mailparser");
const { pool: imapPool } = require("../services/ImapConnection");

const HEADER_FIELDS = "HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID)";

let decodeHeader;
try {
    const libmime = require("libmime");
    decodeHeader = (value) => {
        if (!value) return "";
        try {
            return libmime.decodeWords(value);
        } catch (error) {
            return value;
        }
    };
} catch (error) {
    decodeHeader = (value) => value || "";
}

const SPECIAL_USE_BY_ATTRIBUTE = {
    "\\Sent": "sent",
    "\\Drafts": "drafts",
    "\\Trash": "trash",
    "\\Junk": "junk",
    "\\Archive": "archive",
    "\\All": "all",
    "\\Flagged": "flagged",
};

const SPECIAL_USE_BY_NAME = {
    inbox: "inbox",
    sent: "sent",
    "sent items": "sent",
    drafts: "drafts",
    trash: "trash",
    deleted: "trash",
    "deleted items": "trash",
    junk: "junk",
    spam: "junk",
    archive: "archive",
};

const addressText = (raw) => {
    const decoded = decodeHeader(raw);
    return decoded.trim();
};

const addressOnly = (raw) => {
    if (!raw) return "";
    const angled = raw.match(/<([^>]+)>/);
    if (angled) return angled[1].trim().toLowerCase();
    return raw.trim().toLowerCase();
};

const displayName = (raw) => {
    if (!raw) return "";
    const decoded = decodeHeader(raw);
    const angled = decoded.match(/^\s*"?([^"<]*)"?\s*</);
    if (angled && angled[1].trim()) return angled[1].trim();
    return addressOnly(decoded);
};

const structHasAttachment = (struct) => {
    if (!Array.isArray(struct)) return false;

    for (const part of struct) {
        if (Array.isArray(part)) {
            if (structHasAttachment(part)) return true;
            continue;
        }
        if (!part || typeof part !== "object") continue;

        const disposition = part.disposition;
        if (
            disposition &&
            typeof disposition.type === "string" &&
            ["attachment", "inline"].includes(disposition.type.toLowerCase()) &&
            disposition.params &&
            disposition.params.filename
        ) {
            return true;
        }
    }

    return false;
};

// Enough of a MIME body to judge what a message is about, without paying to
// parse it properly. Attachment payloads and boundary lines are dropped, tags
// are stripped, and only the leading window of the body is considered so a
// large message cannot dominate the work.
const textSnippet = (raw, maxChars) => {
    const window = raw.slice(0, 40_000);
    const lines = [];

    for (const line of window.split(/\r?\n/)) {
        if (/^--[-\w]/.test(line)) continue;
        if (/^[\w-]+:\s/.test(line) && lines.length === 0) continue;
        // Long unbroken runs are base64 or quoted-printable payload.
        if (/^[A-Za-z0-9+/=]{60,}$/.test(line.trim())) continue;
        if (line.trim().startsWith(">")) continue;
        lines.push(line);
    }

    return lines
        .join(" ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/=[0-9A-F]{2}/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxChars);
};

class Email {
    constructor() {
        this.transporter = null;
    }

    getTransporter() {
        if (this.transporter) return this.transporter;

        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || "localhost",
            port: parseInt(process.env.SMTP_PORT || "587", 10),
            secure: process.env.SMTP_SECURE === "true",
            requireTLS: process.env.SMTP_REQUIRE_TLS === "true",
            auth: process.env.SMTP_USER
                ? {
                      user: process.env.SMTP_USER,
                      pass: process.env.SMTP_PASS,
                  }
                : undefined,
            tls: {
                rejectUnauthorized:
                    process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
            },
        });

        return this.transporter;
    }

    async sendEmail(from, to, subject, content, attachments = []) {
        try {
            const recipients = Array.isArray(to) ? to.join(",") : to;

            const result = await this.getTransporter().sendMail({
                from,
                to: recipients,
                subject,
                html: content,
                attachments,
                // Keep the envelope sender aligned with the acting mailbox so
                // Postfix sender restrictions and SPF stay correct.
                envelope: { from, to: recipients },
            });

            await this.logSentEmail(
                from,
                to,
                subject,
                content,
                result.messageId
            );

            return result;
        } catch (error) {
            throw new Error(`Error sending email: ${error.message}`);
        }
    }

    async logSentEmail(from, to, subject, content, messageId) {
        try {
            await query(
                `
        INSERT INTO sent_emails (from_email, to_email, subject, content, message_id, sent_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
      `,
                [
                    from,
                    Array.isArray(to) ? to.join(",") : to,
                    subject,
                    content,
                    messageId,
                ]
            );
        } catch (error) {
            console.error("Error logging sent email:", error);
        }
    }

    normalizeListItem(record, folder, mailbox) {
        const attrs = record.attrs || {};
        const headerBuffer = record.bodies[HEADER_FIELDS];
        const parsed = headerBuffer
            ? Imap.parseHeader(headerBuffer.toString("utf8"))
            : {};

        const rawFrom = parsed.from?.[0] || "";
        const rawDate = parsed.date?.[0] || "";

        return {
            uid: String(attrs.uid ?? record.seqno ?? ""),
            seqno: record.seqno,
            mailbox,
            folder,
            from: addressText(rawFrom),
            fromName: displayName(rawFrom),
            fromAddress: addressOnly(rawFrom),
            to: addressText(parsed.to?.[0] || ""),
            cc: addressText(parsed.cc?.[0] || ""),
            subject: decodeHeader(parsed.subject?.[0] || "") || "(no subject)",
            date: rawDate ? new Date(rawDate).toISOString() : null,
            messageId: parsed["message-id"]?.[0] || "",
            flags: attrs.flags || [],
            size: attrs.size || 0,
            hasAttachments: structHasAttachment(attrs.struct),
        };
    }

    async getEmails(mailbox, folder = "INBOX", limit = 50, offset = 0) {
        return imapPool.withMailbox(mailbox, async (client) => {
            const box = await client.openBox(folder, true);
            const total = box.messages.total;

            if (!total) return [];

            const end = Math.max(1, total - offset);
            const start = Math.max(1, end - limit + 1);

            if (offset >= total) return [];

            const records = await client.fetch(
                `${start}:${end}`,
                { bodies: HEADER_FIELDS, struct: true },
                false
            );

            return records
                .map((record) =>
                    this.normalizeListItem(record, folder, mailbox)
                )
                .sort((a, b) => {
                    const left = a.date ? Date.parse(a.date) : 0;
                    const right = b.date ? Date.parse(b.date) : 0;
                    return right - left;
                });
        });
    }

    /** Message counts for a folder, so the client can page without guessing. */
    async getFolderStatus(mailbox, folder = "INBOX") {
        return imapPool.withMailbox(mailbox, async (client) => {
            const box = await client.openBox(folder, true);
            return {
                total: box.messages?.total ?? 0,
                unseen: box.messages?.unseen ?? 0,
                uidvalidity: box.uidvalidity ?? 0,
            };
        });
    }

    /**
     * Headers for an explicit UID set, in one round trip. The priority view
     * resolves its UIDs from the classification table and then asks for exactly
     * those messages rather than paging the folder.
     */
    async getEmailsByUids(mailbox, folder, uids) {
        if (!uids || uids.length === 0) return [];

        return imapPool.withMailbox(mailbox, async (client) => {
            await client.openBox(folder, true);

            const records = await client.fetch(
                uids.join(","),
                { bodies: HEADER_FIELDS, struct: true },
                true
            );

            return records.map((record) =>
                this.normalizeListItem(record, folder, mailbox)
            );
        });
    }

    /**
     * Leading plain text for a UID set, used to give the classifier something
     * to read beyond the subject line. One fetch covers the whole batch; the
     * body is truncated here rather than in IMAP because node-imap has no
     * partial-fetch option.
     */
    async getSnippets(mailbox, folder, uids, maxChars = 500) {
        if (!uids || uids.length === 0 || maxChars <= 0) return new Map();

        return imapPool.withMailbox(mailbox, async (client) => {
            await client.openBox(folder, true);

            const records = await client.fetch(
                uids.join(","),
                { bodies: "TEXT", struct: false },
                true
            );

            const snippets = new Map();
            for (const record of records) {
                const raw = record.bodies?.TEXT;
                if (!raw) continue;
                snippets.set(
                    record.attrs?.uid,
                    textSnippet(raw.toString("utf8"), maxChars)
                );
            }
            return snippets;
        });
    }

    async getEmailContent(mailbox, uid, folder = "INBOX") {
        return imapPool.withMailbox(mailbox, async (client) => {
            await client.openBox(folder, true);

            const records = await client.fetch(String(uid), { bodies: "" });
            if (records.length === 0) return null;

            const raw = records[0].bodies[""];
            if (!raw) return null;

            const parsed = await simpleParser(raw);
            const attrs = records[0].attrs || {};

            return {
                uid: String(uid),
                mailbox,
                folder,
                from: parsed.from,
                to: parsed.to,
                cc: parsed.cc,
                subject: parsed.subject || "(no subject)",
                date: parsed.date ? parsed.date.toISOString() : null,
                messageId: parsed.messageId,
                html: parsed.html || null,
                text: parsed.text || "",
                flags: attrs.flags || [],
                attachments: (parsed.attachments || []).map((attachment) => ({
                    filename: attachment.filename,
                    contentType: attachment.contentType,
                    size: attachment.size,
                    contentId: attachment.contentId,
                })),
            };
        });
    }

    async markEmail(mailbox, uid, flag, add = true, folder = "INBOX") {
        return imapPool.withMailbox(mailbox, async (client) => {
            await client.openBox(folder, false);
            if (add) await client.addFlags(String(uid), flag);
            else await client.delFlags(String(uid), flag);
            return true;
        });
    }

    normalizeFolders(boxes, parentPath = "", delimiter = ".") {
        return Object.keys(boxes || {}).map((name) => {
            const box = boxes[name] || {};
            const boxDelimiter = box.delimiter || delimiter;
            const path = parentPath
                ? `${parentPath}${boxDelimiter}${name}`
                : name;
            const attributes = box.attribs || [];

            let specialUse = null;
            for (const attribute of attributes) {
                if (SPECIAL_USE_BY_ATTRIBUTE[attribute]) {
                    specialUse = SPECIAL_USE_BY_ATTRIBUTE[attribute];
                    break;
                }
            }
            if (!specialUse) {
                specialUse = SPECIAL_USE_BY_NAME[name.toLowerCase()] || null;
            }

            const children = box.children
                ? this.normalizeFolders(box.children, path, boxDelimiter)
                : [];

            return {
                name,
                path,
                displayName: name === "INBOX" ? "Inbox" : name,
                delimiter: boxDelimiter,
                attributes,
                specialUse,
                selectable: !attributes.includes("\\Noselect"),
                hasChildren: children.length > 0,
                children,
            };
        });
    }

    async getFolders(mailbox) {
        return imapPool.withMailbox(mailbox, async (client) => {
            const boxes = await client.listBoxes();
            return this.normalizeFolders(boxes);
        });
    }

    async getUnreadCount(mailbox, folder = "INBOX") {
        return imapPool.withMailbox(mailbox, async (client) => {
            await client.openBox(folder, true);
            const unseen = await client.search(["UNSEEN"]);
            return unseen.length;
        });
    }

    async searchEmails(mailbox, criteria, folder = "INBOX", limit = 100) {
        return imapPool.withMailbox(mailbox, async (client) => {
            await client.openBox(folder, true);

            const uids = await client.search(criteria);
            if (uids.length === 0) return [];

            const recent = uids.slice(-limit);
            const records = await client.fetch(recent, {
                bodies: HEADER_FIELDS,
                struct: true,
            });

            return records
                .map((record) =>
                    this.normalizeListItem(record, folder, mailbox)
                )
                .sort((a, b) => {
                    const left = a.date ? Date.parse(a.date) : 0;
                    const right = b.date ? Date.parse(b.date) : 0;
                    return right - left;
                });
        });
    }

    /**
     * Locate a folder by its special-use role, falling back to the conventional
     * name. Dovecot advertises \Sent, \Drafts, \Trash and \Junk on the folders
     * iRedMail auto-creates, but the names differ across clients.
     */
    async resolveSpecialFolder(client, role, fallback) {
        const boxes = await client.listBoxes();
        const flat = [];

        const walk = (folders) => {
            for (const folder of folders) {
                flat.push(folder);
                if (folder.children?.length) walk(folder.children);
            }
        };
        walk(this.normalizeFolders(boxes));

        const match = flat.find((folder) => folder.specialUse === role);
        return match ? match.path : fallback;
    }

    /**
     * Delete means "move to Trash", matching every mail client's expectation.
     * Only a message already in Trash is expunged for real.
     */
    async deleteEmail(mailbox, uid, folder = "INBOX", { permanent } = {}) {
        return imapPool.withMailbox(mailbox, async (client) => {
            const trash = await this.resolveSpecialFolder(
                client,
                "trash",
                "Trash"
            );
            const inTrash = folder.toLowerCase() === trash.toLowerCase();

            await client.openBox(folder, false);

            if (permanent || inTrash) {
                await client.addFlags(String(uid), "\\Deleted");
                await client.expunge();
                return { expunged: true, movedTo: null };
            }

            await client.move(String(uid), trash);
            return { expunged: false, movedTo: trash };
        });
    }

    async moveEmail(mailbox, uid, targetFolder, sourceFolder = "INBOX") {
        return imapPool.withMailbox(mailbox, async (client) => {
            await client.openBox(sourceFolder, false);
            await client.move(String(uid), targetFolder);
            return true;
        });
    }

    /**
     * Move to Junk (or back to INBOX). Dovecot's imap_sieve plugin watches these
     * moves and retrains the spam filter, so no separate training call is needed.
     */
    async setSpam(mailbox, uid, isSpam, folder = "INBOX") {
        return imapPool.withMailbox(mailbox, async (client) => {
            const junk = await this.resolveSpecialFolder(client, "junk", "Junk");
            const target = isSpam ? junk : "INBOX";

            if (folder.toLowerCase() === target.toLowerCase()) return { target };

            await client.openBox(folder, false);
            await client.move(String(uid), target);
            return { target };
        });
    }

    async getAttachment(mailbox, uid, index, folder = "INBOX") {
        return imapPool.withMailbox(mailbox, async (client) => {
            await client.openBox(folder, true);

            const records = await client.fetch(String(uid), { bodies: "" });
            const raw = records[0]?.bodies[""];
            if (!raw) return null;

            const parsed = await simpleParser(raw);
            const attachment = (parsed.attachments || [])[Number(index)];
            if (!attachment) return null;

            return {
                filename: attachment.filename || `attachment-${index}`,
                contentType: attachment.contentType || "application/octet-stream",
                content: attachment.content,
                size: attachment.size,
            };
        });
    }

    /**
     * Fetch the full RFC822 source, used for "view source" and .eml export.
     */
    async getRawMessage(mailbox, uid, folder = "INBOX") {
        return imapPool.withMailbox(mailbox, async (client) => {
            await client.openBox(folder, true);
            const records = await client.fetch(String(uid), { bodies: "" });
            return records[0]?.bodies[""] || null;
        });
    }

    /**
     * Persist a draft to the Drafts folder. Editing an existing draft appends a
     * new message and expunges the old one, since IMAP has no in-place update.
     */
    async saveDraft(mailbox, draft, { replaceUid, folder } = {}) {
        const MailComposer = require("nodemailer/lib/mail-composer");

        const built = await new Promise((resolve, reject) => {
            new MailComposer({
                from: draft.from || mailbox,
                to: draft.to,
                cc: draft.cc,
                bcc: draft.bcc,
                subject: draft.subject,
                html: draft.html,
                text: draft.text,
                inReplyTo: draft.inReplyTo,
                references: draft.references,
                attachments: draft.attachments,
            })
                .compile()
                .build((err, message) =>
                    err ? reject(err) : resolve(message)
                );
        });

        return imapPool.withMailbox(mailbox, async (client) => {
            const drafts =
                folder ||
                (await this.resolveSpecialFolder(client, "drafts", "Drafts"));

            await client.append(built, {
                mailbox: drafts,
                flags: ["\\Draft", "\\Seen"],
                date: new Date(),
            });

            if (replaceUid) {
                await client.openBox(drafts, false);
                await client.addFlags(String(replaceUid), "\\Deleted");
                await client.expunge();
            }

            return { folder: drafts };
        });
    }

    async createFolder(mailbox, name) {
        return imapPool.withMailbox(mailbox, async (client) => {
            await client.addBox(name);
            await client.subscribeBox(name).catch(() => {});
            return true;
        });
    }

    async renameFolder(mailbox, from, to) {
        return imapPool.withMailbox(mailbox, async (client) => {
            await client.renameBox(from, to);
            await client.subscribeBox(to).catch(() => {});
            return true;
        });
    }

    async deleteFolder(mailbox, name) {
        return imapPool.withMailbox(mailbox, async (client) => {
            await client.unsubscribeBox(name).catch(() => {});
            await client.delBox(name);
            return true;
        });
    }

    static async getEmailStats(mailbox) {
        try {
            const result = await query(
                `
        SELECT 
          COUNT(*) as total_sent,
          COUNT(CASE WHEN sent_at >= NOW() - INTERVAL '7 days' THEN 1 END) as sent_this_week,
          COUNT(CASE WHEN sent_at >= NOW() - INTERVAL '30 days' THEN 1 END) as sent_this_month
        FROM sent_emails 
        WHERE from_email = $1
      `,
                [mailbox]
            );

            return (
                result.rows[0] || {
                    total_sent: 0,
                    sent_this_week: 0,
                    sent_this_month: 0,
                }
            );
        } catch (error) {
            return {
                total_sent: 0,
                sent_this_week: 0,
                sent_this_month: 0,
            };
        }
    }
}

module.exports = Email;
