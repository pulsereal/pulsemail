const fs = require("fs");
const path = require("path");

class MockDataManager {
    constructor() {
        this.dataDir = path.join(__dirname, "../../data");
        this.ensureDataDirectory();
        this.initializeMockData();
    }

    // Ensure data directory exists
    ensureDataDirectory() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }

    // Initialize mock data if it doesn't exist
    initializeMockData() {
        const files = [
            { name: "users.json", data: this.getDefaultUsers() },
            { name: "emails.json", data: this.getDefaultEmails() },
            { name: "campaigns.json", data: this.getDefaultCampaigns() },
            { name: "automation.json", data: this.getDefaultAutomation() },
            { name: "preferences.json", data: this.getDefaultPreferences() },
            { name: "categories.json", data: this.getDefaultCategories() },
            { name: "folders.json", data: this.getDefaultFolders() },
            { name: "sent_emails.json", data: this.getDefaultSentEmails() },
        ];

        files.forEach((file) => {
            const filePath = path.join(this.dataDir, file.name);
            if (!fs.existsSync(filePath)) {
                this.writeData(file.name, file.data);
            }
        });
    }

    // Read data from file
    readData(filename) {
        try {
            const filePath = path.join(this.dataDir, filename);
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, "utf8");
                return JSON.parse(data);
            }
            return [];
        } catch (error) {
            console.error(`Error reading ${filename}:`, error);
            return [];
        }
    }

    // Write data to file
    writeData(filename, data) {
        try {
            const filePath = path.join(this.dataDir, filename);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error(`Error writing ${filename}:`, error);
        }
    }

    // Get default users
    getDefaultUsers() {
        return [
            {
                email: "test@localhost",
                password:
                    "$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi", // bcrypt hash for 'test'
                name: "Test User",
                domain: "localhost",
                active: 1,
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
            },
            {
                email: "admin@localhost",
                password:
                    "$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi", // bcrypt hash for 'test'
                name: "Admin User",
                domain: "localhost",
                active: 1,
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
            },
            ...[
                { email: "sarah@localhost", name: "Sarah Chen" },
                { email: "support@localhost", name: "Support Desk" },
                { email: "ceo@acme.test", name: "Dana Reyes" },
                { email: "ops@acme.test", name: "Acme Operations" },
            ].map((user) => ({
                email: user.email,
                password:
                    "$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi",
                name: user.name,
                domain: user.email.split("@")[1],
                active: 1,
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
            })),
        ];
    }

    // Get default admin users
    getDefaultAdmins() {
        return [
            {
                username: "admin@localhost",
                domain: "ALL",
                created: new Date().toISOString(),
            },
            {
                // Domain-scoped admin: can only reach acme.test mailboxes
                username: "ops@acme.test",
                domain: "acme.test",
                created: new Date().toISOString(),
            },
        ];
    }

    // Get default emails
    getDefaultEmails() {
        return [
            {
                uid: "1",
                from: "john.doe@company.com",
                to: "test@localhost",
                subject: "Project Update - Q4 Goals",
                date: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
                messageId: "msg1@example.com",
                flags: [],
                size: 2048,
                category: "work",
                folder: "INBOX",
                content:
                    "<h2>Project Update</h2><p>Hi there,</p><p>I wanted to update you on our Q4 project goals and milestones. We're making great progress on the new feature implementation.</p><p>Key highlights:</p><ul><li>User authentication system completed</li><li>Dashboard analytics in progress</li><li>Mobile app beta testing scheduled</li></ul><p>Let me know if you have any questions!</p><p>Best regards,<br>John</p>",
            },
            {
                uid: "2",
                from: "newsletter@techcompany.com",
                to: "test@localhost",
                subject: "Weekly Tech Newsletter - Latest Updates",
                date: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
                messageId: "msg2@example.com",
                flags: ["\\Seen"],
                size: 3072,
                category: "promotional",
                folder: "INBOX",
                content:
                    "<h1>Tech Weekly Newsletter</h1><p>Stay updated with the latest in technology!</p><h3>This Week's Highlights:</h3><ul><li>New AI developments in machine learning</li><li>Latest updates in cloud computing</li><li>Cybersecurity best practices</li></ul><p>Read more on our website!</p>",
            },
            {
                uid: "3",
                from: "support@service.com",
                to: "test@localhost",
                subject: "Your ticket #12345 has been resolved",
                date: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
                messageId: "msg3@example.com",
                flags: ["\\Seen"],
                size: 1536,
                category: "automated",
                folder: "INBOX",
                content:
                    "<p>Dear Customer,</p><p>Your support ticket #12345 regarding 'Login Issues' has been resolved.</p><p>Resolution: Updated authentication system to fix the login problem you were experiencing.</p><p>If you have any further questions, please don't hesitate to contact us.</p><p>Thank you for your patience!</p>",
            },
            {
                uid: "4",
                from: "sarah.friend@personal.com",
                to: "test@localhost",
                subject: "Lunch this weekend?",
                date: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
                messageId: "msg4@example.com",
                flags: ["\\Seen"],
                size: 512,
                category: "personal",
                folder: "INBOX",
                content:
                    "<p>Hey!</p><p>Are you free for lunch this weekend? I was thinking we could try that new Italian restaurant downtown.</p><p>Let me know what works for you!</p><p>Sarah</p>",
            },
            {
                uid: "5",
                from: "urgent@business.com",
                to: "test@localhost",
                subject: "URGENT: Project deadline moved up",
                date: new Date(Date.now() - 259200000).toISOString(), // 3 days ago
                messageId: "msg5@example.com",
                flags: ["\\Flagged"],
                size: 768,
                category: "important",
                folder: "INBOX",
                content:
                    "<p><strong>URGENT</strong></p><p>The project deadline has been moved up to next Friday due to client requirements.</p><p>Please review your current tasks and let me know if you need any additional resources.</p><p>Thanks,<br>Project Manager</p>",
            },
            {
                uid: "6",
                from: "hr@company.com",
                to: "test@localhost",
                subject: "Monthly Team Meeting - Tomorrow at 10 AM",
                date: new Date(Date.now() - 345600000).toISOString(), // 4 days ago
                messageId: "msg6@example.com",
                flags: ["\\Seen"],
                size: 1024,
                category: "work",
                folder: "INBOX",
                content:
                    "<p>Hello Team,</p><p>Just a reminder that our monthly team meeting is scheduled for tomorrow at 10 AM in the conference room.</p><p>Agenda:</p><ul><li>Project updates</li><li>New initiatives</li><li>Q&A session</li></ul><p>Please come prepared with your updates.</p>",
            },
            {
                uid: "7",
                from: "marketing@brand.com",
                to: "test@localhost",
                subject: "Special Offer - 50% Off This Week Only!",
                date: new Date(Date.now() - 432000000).toISOString(), // 5 days ago
                messageId: "msg7@example.com",
                flags: [],
                size: 2560,
                category: "promotional",
                folder: "INBOX",
                content:
                    "<h2>Special Offer!</h2><p>Don't miss out on our biggest sale of the year!</p><p>Get 50% off all premium products this week only.</p><p>Use code: <strong>SAVE50</strong></p><p>Hurry, offer ends soon!</p>",
            },
            {
                uid: "8",
                from: "system@company.com",
                to: "test@localhost",
                subject: "Password Reset Request",
                date: new Date(Date.now() - 518400000).toISOString(), // 6 days ago
                messageId: "msg8@example.com",
                flags: ["\\Seen"],
                size: 896,
                category: "automated",
                folder: "INBOX",
                content:
                    "<p>Hello,</p><p>We received a request to reset your password. If you didn't make this request, please ignore this email.</p><p>To reset your password, click the link below:</p><p><a href='#'>Reset Password</a></p><p>This link will expire in 24 hours.</p>",
            },
            {
                uid: "9",
                from: "client@external.com",
                to: "test@localhost",
                subject: "Re: Proposal for Q1 2024",
                date: new Date(Date.now() - 604800000).toISOString(), // 7 days ago
                messageId: "msg9@example.com",
                flags: ["\\Seen"],
                size: 1792,
                category: "work",
                folder: "INBOX",
                content:
                    "<p>Hi there,</p><p>Thanks for the proposal. I've reviewed it and have a few questions:</p><ol><li>Can we adjust the timeline?</li><li>What about the budget considerations?</li><li>Do you have any references from similar projects?</li></ol><p>Let's discuss this further.</p><p>Best regards,<br>Client</p>",
            },
            {
                uid: "10",
                from: "family@personal.com",
                to: "test@localhost",
                subject: "Family dinner this Sunday",
                date: new Date(Date.now() - 691200000).toISOString(), // 8 days ago
                messageId: "msg10@example.com",
                flags: ["\\Seen"],
                size: 640,
                category: "personal",
                folder: "INBOX",
                content:
                    "<p>Hi dear,</p><p>Just wanted to remind you about family dinner this Sunday at 6 PM.</p><p>Mom is making your favorite lasagna!</p><p>See you there!</p><p>Love,<br>Family</p>",
            },
            {
                uid: "11",
                from: "admin@localhost",
                to: "test@localhost",
                subject: "System Maintenance Notice",
                date: new Date(Date.now() - 777600000).toISOString(), // 9 days ago
                messageId: "msg11@example.com",
                flags: ["\\Seen"],
                size: 1152,
                category: "important",
                folder: "INBOX",
                content:
                    "<p>System Maintenance Notice</p><p>We will be performing scheduled maintenance on Sunday from 2 AM to 6 AM.</p><p>During this time, some services may be temporarily unavailable.</p><p>We apologize for any inconvenience.</p>",
            },
            {
                uid: "12",
                from: "developer@team.com",
                to: "test@localhost",
                subject: "Code Review Request - Feature Branch",
                date: new Date(Date.now() - 864000000).toISOString(), // 10 days ago
                messageId: "msg12@example.com",
                flags: [],
                size: 2048,
                category: "work",
                folder: "INBOX",
                content:
                    "<p>Hi,</p><p>I've completed the new feature implementation and would appreciate a code review.</p><p>Branch: feature/user-authentication</p><p>Key changes:</p><ul><li>Added OAuth integration</li><li>Updated user model</li><li>Enhanced security features</li></ul><p>Please review when you have time.</p>",
            },
            // Emails for admin@localhost
            {
                uid: "13",
                from: "system@company.com",
                to: "admin@localhost",
                subject: "Daily System Report - All Systems Operational",
                date: new Date(Date.now() - 1800000).toISOString(), // 30 minutes ago
                messageId: "msg13@example.com",
                flags: [],
                size: 1536,
                category: "automated",
                folder: "INBOX",
                content:
                    "<h2>Daily System Report</h2><p>All systems are operating normally.</p><p>Server uptime: 99.9%</p><p>Active users: 1,247</p><p>Storage usage: 67%</p><p>No critical issues detected.</p>",
            },
            {
                uid: "14",
                from: "security@company.com",
                to: "admin@localhost",
                subject: "Security Alert - New Login Attempts Detected",
                date: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
                messageId: "msg14@example.com",
                flags: ["\\Flagged"],
                size: 1024,
                category: "important",
                folder: "INBOX",
                content:
                    "<p><strong>Security Alert</strong></p><p>Multiple login attempts detected from IP: 192.168.1.100</p><p>Time: " +
                    new Date().toLocaleString() +
                    "</p><p>Please review and take appropriate action if necessary.</p>",
            },
            {
                uid: "15",
                from: "hr@company.com",
                to: "admin@localhost",
                subject: "New Employee Onboarding - John Smith",
                date: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
                messageId: "msg15@example.com",
                flags: ["\\Seen"],
                size: 2048,
                category: "work",
                folder: "INBOX",
                content:
                    "<p>Hello Admin,</p><p>New employee John Smith is starting next Monday.</p><p>Please set up the following:</p><ul><li>Email account: john.smith@company.com</li><li>Access to project management tools</li><li>VPN access</li><li>Security training completion</li></ul><p>Let me know if you need any additional information.</p>",
            },
            {
                uid: "16",
                from: "finance@company.com",
                to: "admin@localhost",
                subject: "Monthly Budget Review - IT Department",
                date: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
                messageId: "msg16@example.com",
                flags: ["\\Seen"],
                size: 3072,
                category: "work",
                folder: "INBOX",
                content:
                    "<h2>Monthly Budget Review</h2><p>IT Department Budget Summary:</p><ul><li>Hardware: $15,000</li><li>Software licenses: $8,500</li><li>Cloud services: $12,000</li><li>Maintenance: $5,200</li></ul><p>Total: $40,700 (95% of allocated budget)</p><p>Please review and approve for next month.</p>",
            },
            {
                uid: "17",
                from: "vendor@techsupplier.com",
                to: "admin@localhost",
                subject: "Quote Request - Server Upgrade",
                date: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
                messageId: "msg17@example.com",
                flags: [],
                size: 1792,
                category: "work",
                folder: "INBOX",
                content:
                    "<p>Dear Admin,</p><p>As requested, here's the quote for the server upgrade:</p><p>Server Specifications:</p><ul><li>CPU: Intel Xeon E5-2680 v4</li><li>RAM: 64GB DDR4</li><li>Storage: 2TB SSD</li><li>Network: 10Gbps</li></ul><p>Total Cost: $12,500</p><p>Please let me know if you need any modifications.</p>",
            },
            ...this.getAdditionalMailboxEmails(18),
        ];
    }

    /**
     * Inbox content for the secondary mailboxes, so the admin unified view and
     * domain-scoped access have something meaningful to show.
     */
    getAdditionalMailboxEmails(startingUid) {
        const seeds = [
            {
                to: "sarah@localhost",
                items: [
                    {
                        from: "design@studio.com",
                        subject: "Brand refresh — final mockups attached",
                        category: "work",
                        minutesAgo: 45,
                        unread: true,
                    },
                    {
                        from: "test@localhost",
                        subject: "Re: Lunch this weekend?",
                        category: "personal",
                        minutesAgo: 240,
                        unread: false,
                    },
                    {
                        from: "billing@saasvendor.com",
                        subject: "Invoice #4471 is due in 3 days",
                        category: "automated",
                        minutesAgo: 1500,
                        unread: true,
                    },
                ],
            },
            {
                to: "support@localhost",
                items: [
                    {
                        from: "angry.customer@example.com",
                        subject: "Still waiting on ticket #98120",
                        category: "important",
                        minutesAgo: 12,
                        unread: true,
                    },
                    {
                        from: "noreply@statuspage.io",
                        subject: "Incident resolved: API latency",
                        category: "automated",
                        minutesAgo: 320,
                        unread: false,
                    },
                    {
                        from: "newuser@example.com",
                        subject: "How do I enable two-factor auth?",
                        category: "work",
                        minutesAgo: 900,
                        unread: true,
                    },
                ],
            },
            {
                to: "ceo@acme.test",
                items: [
                    {
                        from: "board@acme.test",
                        subject: "Q3 board pack for review",
                        category: "important",
                        minutesAgo: 90,
                        unread: true,
                    },
                    {
                        from: "press@techjournal.com",
                        subject: "Interview request for next issue",
                        category: "work",
                        minutesAgo: 600,
                        unread: false,
                    },
                ],
            },
            {
                to: "ops@acme.test",
                items: [
                    {
                        from: "monitoring@acme.test",
                        subject: "Disk usage above 85% on db-primary",
                        category: "important",
                        minutesAgo: 25,
                        unread: true,
                    },
                    {
                        from: "ceo@acme.test",
                        subject: "Can we get the deploy window moved?",
                        category: "work",
                        minutesAgo: 400,
                        unread: false,
                    },
                ],
            },
        ];

        let uid = startingUid;

        return seeds.flatMap((seed) =>
            seed.items.map((item) => {
                const current = uid++;
                return {
                    uid: String(current),
                    from: item.from,
                    to: seed.to,
                    subject: item.subject,
                    date: new Date(
                        Date.now() - item.minutesAgo * 60000
                    ).toISOString(),
                    messageId: `msg${current}@example.com`,
                    flags: item.unread ? [] : ["\\Seen"],
                    size: 1024 + current * 37,
                    category: item.category,
                    folder: "INBOX",
                    content: `<p>Hi,</p><p>${item.subject}</p><p>Sent to ${seed.to} for review.</p><p>Regards,<br>${item.from}</p>`,
                };
            })
        );
    }

    // Get default campaigns
    getDefaultCampaigns() {
        return [
            {
                id: 1,
                user_email: "test@localhost",
                name: "Welcome Campaign",
                subject: "Welcome to our platform!",
                content: "<h1>Welcome!</h1><p>Thank you for joining us.</p>",
                recipients: [
                    { email: "user1@example.com", name: "User One" },
                    { email: "user2@example.com", name: "User Two" },
                ],
                status: "draft",
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
            },
            {
                id: 2,
                user_email: "test@localhost",
                name: "Product Launch",
                subject: "New Product Available Now!",
                content:
                    "<h1>New Product</h1><p>Check out our latest offering.</p>",
                recipients: [
                    { email: "customer1@example.com", name: "Customer One" },
                ],
                status: "sent",
                sent_at: new Date(Date.now() - 86400000).toISOString(),
                created: new Date(Date.now() - 172800000).toISOString(),
                updated: new Date(Date.now() - 86400000).toISOString(),
            },
        ];
    }

    // Get default automation rules
    getDefaultAutomation() {
        return [
            {
                id: 1,
                user_email: "test@localhost",
                name: "Auto Reply to Support",
                trigger_type: "email_received",
                trigger_conditions: {
                    from_domain: "support.com",
                    subject_contains: "ticket",
                },
                actions: [
                    {
                        type: "send_reply",
                        template: "support_auto_reply",
                        delay: 0,
                    },
                ],
                active: true,
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
            },
        ];
    }

    // Get default preferences
    getDefaultPreferences() {
        return [
            {
                email: "test@localhost",
                preferences: {
                    signature: "Best regards,\nTest User",
                    autoResponses: {
                        out_of_office:
                            "I am currently out of office and will return on Monday.",
                        thank_you:
                            "Thank you for your email. I will get back to you soon.",
                    },
                    defaultTone: "professional",
                    language: "en",
                    theme: "light",
                    notifications: {
                        email: true,
                        desktop: true,
                    },
                },
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
            },
        ];
    }

    // Get default categories
    getDefaultCategories() {
        return [
            {
                user_email: "test@localhost",
                email_uid: "1",
                category: "work",
                confidence: 0.9,
                method: "llm",
                created: new Date().toISOString(),
            },
            {
                user_email: "test@localhost",
                email_uid: "2",
                category: "promotional",
                confidence: 0.8,
                method: "llm",
                created: new Date().toISOString(),
            },
        ];
    }

    // Get default folders
    getDefaultFolders() {
        const emails = this.getDefaultEmails();

        return this.getDefaultUsers().flatMap((user) =>
            ["INBOX", "Sent", "Drafts", "Trash"].map((name) => {
                const inFolder = emails.filter(
                    (email) => email.to === user.email && email.folder === name
                );
                return {
                    user_email: user.email,
                    name,
                    path: name,
                    delimiter: "/",
                    attributes: ["\\HasNoChildren"],
                    count: inFolder.length,
                    unseen: inFolder.filter(
                        (email) => !email.flags.includes("\\Seen")
                    ).length,
                };
            })
        );
    }

    // Get default sent emails
    getDefaultSentEmails() {
        return [
            {
                id: 1,
                from_email: "test@localhost",
                to_email: "recipient@example.com",
                subject: "Test Email",
                content: "<p>This is a test email.</p>",
                message_id: "test-msg-1@localhost",
                sent_at: new Date(Date.now() - 86400000).toISOString(),
            },
            {
                id: 2,
                from_email: "test@localhost",
                to_email: "another@example.com",
                subject: "Follow up",
                content: "<p>Following up on our conversation.</p>",
                message_id: "test-msg-2@localhost",
                sent_at: new Date(Date.now() - 172800000).toISOString(),
            },
        ];
    }

    // CRUD operations for users
    getUsers() {
        return this.readData("users.json");
    }

    getUserByEmail(email) {
        const users = this.getUsers();
        return users.find((user) => user.email === email);
    }

    createUser(userData) {
        const users = this.getUsers();
        const newUser = {
            ...userData,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
        };
        users.push(newUser);
        this.writeData("users.json", users);
        return newUser;
    }

    updateUser(email, updates) {
        const users = this.getUsers();
        const index = users.findIndex((user) => user.email === email);
        if (index !== -1) {
            users[index] = {
                ...users[index],
                ...updates,
                updated: new Date().toISOString(),
            };
            this.writeData("users.json", users);
            return users[index];
        }
        return null;
    }

    // CRUD operations for emails
    getEmails(userEmail, folder = "INBOX", limit = 50, offset = 0) {
        const emails = this.readData("emails.json");
        const userEmails = emails.filter(
            (email) => email.to === userEmail && email.folder === folder
        );
        return userEmails.slice(offset, offset + limit);
    }

    countEmails(userEmail, folder = "INBOX") {
        const emails = this.readData("emails.json").filter(
            (email) => email.to === userEmail && email.folder === folder
        );

        return {
            total: emails.length,
            unseen: emails.filter(
                (email) => !(email.flags || []).includes("\\Seen")
            ).length,
        };
    }

    getEmailByUid(userEmail, uid, folder = "INBOX") {
        const emails = this.readData("emails.json");
        return emails.find(
            (email) =>
                email.to === userEmail &&
                email.uid === uid &&
                email.folder === folder
        );
    }

    createEmail(emailData) {
        const emails = this.readData("emails.json");
        const newEmail = {
            ...emailData,
            uid: (emails.length + 1).toString(),
            date: new Date().toISOString(),
        };
        emails.push(newEmail);
        this.writeData("emails.json", emails);
        return newEmail;
    }

    updateEmail(uid, updates) {
        const emails = this.readData("emails.json");
        const index = emails.findIndex((email) => email.uid === uid);
        if (index !== -1) {
            emails[index] = { ...emails[index], ...updates };
            this.writeData("emails.json", emails);
            return emails[index];
        }
        return null;
    }

    deleteEmail(uid) {
        const emails = this.readData("emails.json");
        const filteredEmails = emails.filter((email) => email.uid !== uid);
        this.writeData("emails.json", filteredEmails);
        return true;
    }

    // CRUD operations for campaigns
    getCampaigns(userEmail) {
        const campaigns = this.readData("campaigns.json");
        return campaigns.filter(
            (campaign) => campaign.user_email === userEmail
        );
    }

    getCampaignById(id) {
        const campaigns = this.readData("campaigns.json");
        return campaigns.find((campaign) => campaign.id === parseInt(id));
    }

    createCampaign(campaignData) {
        const campaigns = this.readData("campaigns.json");
        const newCampaign = {
            ...campaignData,
            id: campaigns.length + 1,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
        };
        campaigns.push(newCampaign);
        this.writeData("campaigns.json", campaigns);
        return newCampaign;
    }

    updateCampaign(id, updates) {
        const campaigns = this.readData("campaigns.json");
        const index = campaigns.findIndex(
            (campaign) => campaign.id === parseInt(id)
        );
        if (index !== -1) {
            campaigns[index] = {
                ...campaigns[index],
                ...updates,
                updated: new Date().toISOString(),
            };
            this.writeData("campaigns.json", campaigns);
            return campaigns[index];
        }
        return null;
    }

    // CRUD operations for preferences
    getUserPreferences(userEmail) {
        const preferences = this.readData("preferences.json");
        const userPrefs = preferences.find((pref) => pref.email === userEmail);
        return userPrefs ? userPrefs.preferences : {};
    }

    updateUserPreferences(userEmail, newPreferences) {
        const preferences = this.readData("preferences.json");
        const index = preferences.findIndex((pref) => pref.email === userEmail);

        if (index !== -1) {
            preferences[index].preferences = {
                ...preferences[index].preferences,
                ...newPreferences,
            };
            preferences[index].updated = new Date().toISOString();
        } else {
            preferences.push({
                email: userEmail,
                preferences: newPreferences,
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
            });
        }

        this.writeData("preferences.json", preferences);
        return preferences[index] || preferences[preferences.length - 1];
    }

    // CRUD operations for sent emails
    getSentEmails(userEmail) {
        const sentEmails = this.readData("sent_emails.json");
        return sentEmails.filter((email) => email.from_email === userEmail);
    }

    createSentEmail(emailData) {
        const sentEmails = this.readData("sent_emails.json");
        const newSentEmail = {
            ...emailData,
            id: sentEmails.length + 1,
            sent_at: new Date().toISOString(),
        };
        sentEmails.push(newSentEmail);
        this.writeData("sent_emails.json", sentEmails);
        return newSentEmail;
    }

    // Search functionality
    searchEmails(userEmail, searchTerm, folder = "INBOX") {
        const emails = this.readData("emails.json");
        const userEmails = emails.filter(
            (email) => email.to === userEmail && email.folder === folder
        );

        return userEmails.filter(
            (email) =>
                email.subject
                    .toLowerCase()
                    .includes(searchTerm.toLowerCase()) ||
                email.from.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (email.content &&
                    email.content
                        .toLowerCase()
                        .includes(searchTerm.toLowerCase()))
        );
    }

    // Get email statistics
    getEmailStats(userEmail) {
        const emails = this.readData("emails.json");
        const sentEmails = this.readData("sent_emails.json");

        const userEmails = emails.filter((email) => email.to === userEmail);
        const userSentEmails = sentEmails.filter(
            (email) => email.from_email === userEmail
        );

        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        return {
            total_received: userEmails.length,
            total_sent: userSentEmails.length,
            received_this_week: userEmails.filter(
                (email) => new Date(email.date) >= weekAgo
            ).length,
            received_this_month: userEmails.filter(
                (email) => new Date(email.date) >= monthAgo
            ).length,
            sent_this_week: userSentEmails.filter(
                (email) => new Date(email.sent_at) >= weekAgo
            ).length,
            sent_this_month: userSentEmails.filter(
                (email) => new Date(email.sent_at) >= monthAgo
            ).length,
        };
    }

    // Get folders for user
    getFolders(userEmail) {
        const folders = this.readData("folders.json");
        return folders.filter((folder) => folder.user_email === userEmail);
    }

    // Reset all data to defaults
    resetData() {
        this.initializeMockData();
        console.log("Mock data reset to defaults");
    }

    // Export data for backup
    exportData() {
        const data = {};
        const files = [
            "users.json",
            "emails.json",
            "campaigns.json",
            "automation.json",
            "preferences.json",
            "categories.json",
            "folders.json",
            "sent_emails.json",
        ];

        files.forEach((filename) => {
            data[filename.replace(".json", "")] = this.readData(filename);
        });

        return data;
    }

    // Import data from backup
    importData(data) {
        Object.keys(data).forEach((key) => {
            this.writeData(`${key}.json`, data[key]);
        });
        console.log("Data imported successfully");
    }
}

module.exports = MockDataManager;
