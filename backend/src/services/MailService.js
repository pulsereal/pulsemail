const Email = require("../models/Email");
const MockEmailService = require("./MockEmailService");

const useMockData =
    process.env.NODE_ENV === "development" &&
    process.env.USE_MOCK_DATA === "true";

let instance;

if (useMockData) {
    console.log("📧 Using mock email service for development");
    instance = new MockEmailService();
} else {
    console.log("📮 Using IMAP/SMTP email service");
    instance = new Email();
}

module.exports = {
    mailService: instance,
    useMockData,
    getEmailStats: (mailbox) =>
        useMockData
            ? MockEmailService.getEmailStats(mailbox)
            : Email.getEmailStats(mailbox),
};
