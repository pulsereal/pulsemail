const MockDataManager = require("../config/mockData");

class MockEmailService {
    constructor() {
        this.mockData = new MockDataManager();
    }

    // Initialize transporter (mock)
    initializeTransporter() {
        console.log("📧 Mock SMTP transporter initialized");
        this.transporter = {
            sendMail: async (mailOptions) => {
                console.log("📤 Mock sending email:", {
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                });

                // Simulate email sending delay
                await new Promise((resolve) => setTimeout(resolve, 100));

                return {
                    messageId: `mock-${Date.now()}@localhost`,
                    response: "Mock email sent successfully",
                };
            },
        };
    }

    // Send email (mock)
    async sendEmail(from, to, subject, content, attachments = []) {
        try {
            if (!this.transporter) {
                this.initializeTransporter();
            }

            const mailOptions = {
                from,
                to: Array.isArray(to) ? to.join(",") : to,
                subject,
                html: content,
                attachments,
            };

            const result = await this.transporter.sendMail(mailOptions);

            // Log sent email to mock data
            await this.logSentEmail(
                from,
                to,
                subject,
                content,
                result.messageId
            );

            return result;
        } catch (error) {
            throw new Error(`Mock email sending failed: ${error.message}`);
        }
    }

    // Log sent email to mock data
    async logSentEmail(from, to, subject, content, messageId) {
        try {
            this.mockData.createSentEmail({
                from_email: from,
                to_email: to,
                subject,
                content,
                message_id: messageId,
            });
        } catch (error) {
            console.error("Error logging sent email:", error);
        }
    }

    // Shape a stored mock email like the IMAP-backed list item
    normalizeListItem(email, folder, mailbox) {
        const address = (raw) => {
            if (!raw) return "";
            const angled = raw.match(/<([^>]+)>/);
            return (angled ? angled[1] : raw).trim().toLowerCase();
        };

        return {
            uid: String(email.uid),
            seqno: Number(email.uid) || 0,
            mailbox,
            folder: email.folder || folder,
            from: email.from,
            fromName: email.from ? email.from.split("@")[0] : "",
            fromAddress: address(email.from),
            to: email.to,
            cc: email.cc || "",
            subject: email.subject || "(no subject)",
            date: email.date
                ? new Date(email.date).toISOString()
                : new Date().toISOString(),
            messageId: email.messageId || "",
            flags: email.flags || [],
            size: email.size || 0,
            hasAttachments:
                this.generateMockAttachments(email.subject || "").length > 0,
            category: email.category,
        };
    }

    // Get emails (mock)
    async getEmails(userEmail, folder = "INBOX", limit = 50, offset = 0) {
        try {
            const emails = this.mockData.getEmails(
                userEmail,
                folder,
                limit,
                offset
            );

            return emails
                .map((email) =>
                    this.normalizeListItem(email, folder, userEmail)
                )
                .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
        } catch (error) {
            throw new Error(`Mock email retrieval failed: ${error.message}`);
        }
    }

    async getFolderStatus(userEmail, folder = "INBOX") {
        return {
            ...this.mockData.countEmails(userEmail, folder),
            uidvalidity: 1,
        };
    }

    async getEmailsByUids(userEmail, folder, uids) {
        if (!uids || uids.length === 0) return [];

        const wanted = new Set(uids.map(String));
        return this.mockData
            .getEmails(userEmail, folder, 1000, 0)
            .filter((email) => wanted.has(String(email.uid)))
            .map((email) => this.normalizeListItem(email, folder, userEmail));
    }

    async getSnippets(userEmail, folder, uids, maxChars = 500) {
        const snippets = new Map();

        for (const uid of uids || []) {
            const email = this.mockData.getEmailByUid(userEmail, uid, folder);
            if (!email) continue;

            const text = (email.content || email.subject || "")
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            snippets.set(uid, text.slice(0, maxChars));
        }

        return snippets;
    }

    // Get single email content (mock)
    async getEmailContent(userEmail, uid, folder = "INBOX") {
        try {
            const email = this.mockData.getEmailByUid(userEmail, uid, folder);

            if (!email) {
                return null;
            }

            const html =
                email.content ||
                this.generateMockEmailHTML(email.subject, email.from);

            return {
                uid: String(email.uid),
                mailbox: userEmail,
                folder: email.folder || folder,
                from: {
                    text: email.from,
                    value: [{ address: email.from, name: "" }],
                },
                to: {
                    text: email.to,
                    value: [{ address: email.to, name: "" }],
                },
                cc: null,
                subject: email.subject,
                date: email.date,
                messageId: email.messageId,
                html,
                text: this.generateMockEmailText(email.subject, email.from),
                flags: email.flags || [],
                attachments: this.generateMockAttachments(email.subject),
            };
        } catch (error) {
            throw new Error(
                `Mock email content retrieval failed: ${error.message}`
            );
        }
    }

    // Unread count for a folder (mock)
    async getUnreadCount(userEmail, folder = "INBOX") {
        try {
            const emails = this.mockData
                .readData("emails.json")
                .filter(
                    (email) => email.to === userEmail && email.folder === folder
                );
            return emails.filter(
                (email) => !(email.flags || []).includes("\\Seen")
            ).length;
        } catch (error) {
            return 0;
        }
    }

    // Mark email as read/unread (mock)
    async markEmail(userEmail, uid, flag, add = true) {
        try {
            const emails = this.mockData.readData("emails.json");
            const emailIndex = emails.findIndex(
                (email) => email.to === userEmail && email.uid === uid
            );

            if (emailIndex !== -1) {
                if (add) {
                    if (!emails[emailIndex].flags.includes(flag)) {
                        emails[emailIndex].flags.push(flag);
                    }
                } else {
                    emails[emailIndex].flags = emails[emailIndex].flags.filter(
                        (f) => f !== flag
                    );
                }

                this.mockData.writeData("emails.json", emails);
                return true;
            }

            return false;
        } catch (error) {
            throw new Error(`Mock email marking failed: ${error.message}`);
        }
    }

    // Get folders (mock)
    async getFolders(userEmail) {
        try {
            const specialUse = {
                inbox: "inbox",
                sent: "sent",
                drafts: "drafts",
                trash: "trash",
                junk: "junk",
                spam: "junk",
                archive: "archive",
            };

            const folders = this.mockData.getFolders(userEmail);
            const fallback = ["INBOX", "Sent", "Drafts", "Trash"].map(
                (name) => ({ name, path: name, delimiter: "/", attributes: [] })
            );

            return (folders.length > 0 ? folders : fallback).map((folder) => ({
                name: folder.name,
                path: folder.path || folder.name,
                displayName: folder.name === "INBOX" ? "Inbox" : folder.name,
                delimiter: folder.delimiter || "/",
                attributes: folder.attributes || [],
                specialUse: specialUse[folder.name.toLowerCase()] || null,
                selectable: true,
                hasChildren: false,
                children: [],
                count: folder.count ?? 0,
                unseen: folder.unseen ?? 0,
            }));
        } catch (error) {
            throw new Error(`Mock folder retrieval failed: ${error.message}`);
        }
    }

    // Search emails (mock)
    async searchEmails(userEmail, criteria, folder = "INBOX") {
        try {
            // Pull the first string literal out of the IMAP-style criteria tree
            const findTerm = (node) => {
                if (typeof node === "string") {
                    const reserved = [
                        "OR",
                        "AND",
                        "ALL",
                        "SUBJECT",
                        "FROM",
                        "BODY",
                        "TO",
                        "SINCE",
                        "BEFORE",
                        "HEADER",
                        "UNSEEN",
                        "SEEN",
                    ];
                    return reserved.includes(node) ? "" : node;
                }
                if (Array.isArray(node)) {
                    for (const child of node) {
                        const found = findTerm(child);
                        if (found) return found;
                    }
                }
                return "";
            };

            const searchTerm = findTerm(criteria);
            const results = this.mockData.searchEmails(
                userEmail,
                searchTerm,
                folder
            );

            return results
                .map((email) =>
                    this.normalizeListItem(email, folder, userEmail)
                )
                .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
        } catch (error) {
            throw new Error(`Mock email search failed: ${error.message}`);
        }
    }

    // Delete email (mock) - mirrors the real move-to-Trash behaviour
    async deleteEmail(userEmail, uid, folder = "INBOX", { permanent } = {}) {
        try {
            if (permanent || folder.toLowerCase() === "trash") {
                this.mockData.deleteEmail(uid);
                return { expunged: true, movedTo: null };
            }

            await this.moveEmail(userEmail, uid, "Trash", folder);
            return { expunged: false, movedTo: "Trash" };
        } catch (error) {
            throw new Error(`Mock email deletion failed: ${error.message}`);
        }
    }

    async setSpam(userEmail, uid, isSpam, folder = "INBOX") {
        const target = isSpam ? "Junk" : "INBOX";
        await this.moveEmail(userEmail, uid, target, folder);
        return { target };
    }

    async getAttachment(userEmail, uid, index, folder = "INBOX") {
        const email = this.mockData.getEmailByUid(userEmail, uid, folder);
        if (!email) return null;

        const attachment = this.generateMockAttachments(email.subject || "")[
            Number(index)
        ];
        if (!attachment) return null;

        return {
            ...attachment,
            content: Buffer.from(
                `Mock attachment "${attachment.filename}" for message ${uid}`,
                "utf8"
            ),
        };
    }

    async getRawMessage(userEmail, uid, folder = "INBOX") {
        const email = this.mockData.getEmailByUid(userEmail, uid, folder);
        if (!email) return null;

        return Buffer.from(
            [
                `From: ${email.from}`,
                `To: ${email.to}`,
                `Subject: ${email.subject}`,
                `Date: ${email.date}`,
                `Message-ID: ${email.messageId}`,
                "Content-Type: text/html; charset=utf-8",
                "",
                email.content || "",
            ].join("\r\n"),
            "utf8"
        );
    }

    async saveDraft(userEmail, draft, { replaceUid } = {}) {
        const emails = this.mockData.readData("emails.json");

        if (replaceUid) {
            const index = emails.findIndex(
                (email) => email.uid === String(replaceUid)
            );
            if (index !== -1) emails.splice(index, 1);
        }

        const uid = String(
            emails.reduce((max, email) => Math.max(max, Number(email.uid) || 0), 0) + 1
        );

        emails.push({
            uid,
            from: draft.from || userEmail,
            to: userEmail,
            recipients: draft.to,
            subject: draft.subject || "(no subject)",
            date: new Date().toISOString(),
            messageId: `draft-${uid}@localhost`,
            flags: ["\\Draft", "\\Seen"],
            size: (draft.html || draft.text || "").length,
            category: "draft",
            folder: "Drafts",
            content: draft.html || draft.text || "",
        });

        this.mockData.writeData("emails.json", emails);
        return { folder: "Drafts", uid };
    }

    async createFolder(userEmail, name) {
        const folders = this.mockData.readData("folders.json");
        if (
            folders.some(
                (folder) =>
                    folder.user_email === userEmail && folder.name === name
            )
        ) {
            throw new Error("Folder already exists");
        }

        folders.push({
            user_email: userEmail,
            name,
            path: name,
            delimiter: "/",
            attributes: ["\\HasNoChildren"],
            count: 0,
            unseen: 0,
        });
        this.mockData.writeData("folders.json", folders);
        return true;
    }

    async renameFolder(userEmail, from, to) {
        const folders = this.mockData.readData("folders.json");
        const folder = folders.find(
            (item) => item.user_email === userEmail && item.name === from
        );
        if (!folder) throw new Error("Folder not found");

        folder.name = to;
        folder.path = to;
        this.mockData.writeData("folders.json", folders);

        const emails = this.mockData.readData("emails.json");
        for (const email of emails) {
            if (email.to === userEmail && email.folder === from) {
                email.folder = to;
            }
        }
        this.mockData.writeData("emails.json", emails);
        return true;
    }

    async deleteFolder(userEmail, name) {
        const folders = this.mockData.readData("folders.json");
        this.mockData.writeData(
            "folders.json",
            folders.filter(
                (folder) =>
                    !(folder.user_email === userEmail && folder.name === name)
            )
        );
        return true;
    }

    // Move email (mock)
    async moveEmail(userEmail, uid, targetFolder, sourceFolder = "INBOX") {
        try {
            const emails = this.mockData.readData("emails.json");
            const emailIndex = emails.findIndex(
                (email) =>
                    email.to === userEmail &&
                    email.uid === uid &&
                    email.folder === sourceFolder
            );

            if (emailIndex !== -1) {
                emails[emailIndex].folder = targetFolder;
                this.mockData.writeData("emails.json", emails);
                return true;
            }

            return false;
        } catch (error) {
            throw new Error(`Mock email move failed: ${error.message}`);
        }
    }

    // Generate mock email content based on subject
    generateMockEmailContent(subject, from) {
        const templates = {
            welcome: `
        <h1>Welcome to our service!</h1>
        <p>Dear User,</p>
        <p>Thank you for joining our platform. We're excited to have you on board!</p>
        <p>Here are some things you can do:</p>
        <ul>
          <li>Send and receive emails</li>
          <li>Create email campaigns</li>
          <li>Set up automation rules</li>
          <li>Use AI-powered features</li>
        </ul>
        <p>Best regards,<br>The Team</p>
      `,
            newsletter: `
        <h1>Weekly Newsletter</h1>
        <p>Hello there!</p>
        <p>Here's what's happening this week:</p>
        <ul>
          <li>New features released</li>
          <li>Upcoming events</li>
          <li>Community highlights</li>
        </ul>
        <p>Stay tuned for more updates!</p>
        <p>Best regards,<br>Newsletter Team</p>
      `,
            support: `
        <h1>Support Ticket Update</h1>
        <p>Hello,</p>
        <p>Your support ticket has been resolved. Thank you for your patience.</p>
        <p>If you have any further questions, please don't hesitate to contact us.</p>
        <p>Best regards,<br>Support Team</p>
      `,
            personal: `
        <h1>Personal Message</h1>
        <p>Hi there!</p>
        <p>Just wanted to check in and see how you're doing.</p>
        <p>Let's catch up soon!</p>
        <p>Best regards,<br>Your Friend</p>
      `,
            urgent: `
        <h1>URGENT: Important Update</h1>
        <p>Hello,</p>
        <p>This is an urgent message that requires your immediate attention.</p>
        <p>Please review and respond as soon as possible.</p>
        <p>Best regards,<br>Management</p>
      `,
        };

        const subjectLower = subject.toLowerCase();
        if (subjectLower.includes("welcome")) return templates.welcome;
        if (subjectLower.includes("newsletter")) return templates.newsletter;
        if (subjectLower.includes("support") || subjectLower.includes("ticket"))
            return templates.support;
        if (subjectLower.includes("personal") || subjectLower.includes("lunch"))
            return templates.personal;
        if (subjectLower.includes("urgent")) return templates.urgent;

        // Default template
        return `
      <h1>${subject}</h1>
      <p>Hello,</p>
      <p>This is a mock email content for: ${subject}</p>
      <p>From: ${from}</p>
      <p>Best regards,<br>Sender</p>
    `;
    }

    // Generate mock HTML content
    generateMockEmailHTML(subject, from) {
        return this.generateMockEmailContent(subject, from);
    }

    // Generate mock text content
    generateMockEmailText(subject, from) {
        const html = this.generateMockEmailContent(subject, from);
        return html
            .replace(/<[^>]*>/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    // Generate mock attachments
    generateMockAttachments(subject) {
        const attachments = [];

        // Add attachments based on subject
        if (subject.toLowerCase().includes("report")) {
            attachments.push({
                filename: "monthly_report.pdf",
                contentType: "application/pdf",
                size: 1024000,
            });
        }

        if (subject.toLowerCase().includes("image")) {
            attachments.push({
                filename: "image.jpg",
                contentType: "image/jpeg",
                size: 512000,
            });
        }

        return attachments;
    }

    // Get email statistics (mock)
    static async getEmailStats(userEmail) {
        try {
            const mockData = new MockDataManager();
            return mockData.getEmailStats(userEmail);
        } catch (error) {
            return {
                total_received: 0,
                total_sent: 0,
                received_this_week: 0,
                received_this_month: 0,
                sent_this_week: 0,
                sent_this_month: 0,
            };
        }
    }

    // Add mock email for testing
    addMockEmail(emailData) {
        try {
            return this.mockData.createEmail(emailData);
        } catch (error) {
            throw new Error(`Failed to add mock email: ${error.message}`);
        }
    }

    // Get all emails for a user
    getAllEmails(userEmail) {
        try {
            return this.mockData
                .readData("emails.json")
                .filter((email) => email.to === userEmail);
        } catch (error) {
            return [];
        }
    }

    // Clear all emails for a user
    clearUserEmails(userEmail) {
        try {
            const emails = this.mockData.readData("emails.json");
            const filteredEmails = emails.filter(
                (email) => email.to !== userEmail
            );
            this.mockData.writeData("emails.json", filteredEmails);
            return true;
        } catch (error) {
            return false;
        }
    }
}

module.exports = MockEmailService;
