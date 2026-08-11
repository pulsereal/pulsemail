const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);

class SpamService {
    constructor() {
        this.spamassassinHost = process.env.SPAMASSASSIN_HOST || "localhost";
        this.spamassassinPort = process.env.SPAMASSASSIN_PORT || 783;
    }

    // Test email content for spam using SpamAssassin
    async testSpam(emailContent, sender, recipient) {
        try {
            // Create full email message for testing
            const fullMessage = this.createFullEmailMessage(
                emailContent,
                sender,
                recipient
            );

            // Test with SpamAssassin via spamc
            const spamResult = await this.testWithSpamAssassin(fullMessage);

            // Test with built-in heuristics
            const heuristicResult = await this.testWithHeuristics(
                emailContent,
                sender
            );

            // Combine results
            const combinedScore = Math.max(
                spamResult.score,
                heuristicResult.score
            );
            const isSpam = combinedScore >= 5.0; // SpamAssassin default threshold

            return {
                isSpam,
                score: combinedScore,
                threshold: 5.0,
                details: {
                    spamassassin: spamResult,
                    heuristics: heuristicResult,
                },
                recommendations: this.generateRecommendations(
                    spamResult,
                    heuristicResult
                ),
            };
        } catch (error) {
            throw new Error(`Spam testing failed: ${error.message}`);
        }
    }

    // Test with SpamAssassin
    async testWithSpamAssassin(emailMessage) {
        try {
            // Write email to temporary file
            const fs = require("fs");
            const path = require("path");
            const os = require("os");

            const tempFile = path.join(
                os.tmpdir(),
                `spam_test_${Date.now()}.eml`
            );
            fs.writeFileSync(tempFile, emailMessage);

            // Run SpamAssassin test
            const command = `spamc -c < "${tempFile}"`;
            const { stdout, stderr } = await execAsync(command);

            // Clean up temp file
            fs.unlinkSync(tempFile);

            // Parse SpamAssassin output
            const lines = stdout.split("\n");
            const scoreLine = lines.find((line) => line.includes("score="));

            let score = 0;
            let isSpam = false;
            let tests = [];

            if (scoreLine) {
                const scoreMatch = scoreLine.match(/score=([\d.-]+)/);
                const thresholdMatch = scoreLine.match(/required=([\d.-]+)/);

                if (scoreMatch) {
                    score = parseFloat(scoreMatch[1]);
                }

                if (thresholdMatch) {
                    const threshold = parseFloat(thresholdMatch[1]);
                    isSpam = score >= threshold;
                }

                // Extract individual test results
                const testLines = lines.filter((line) =>
                    line.match(/^\s*[\d.-]+\s+\w+/)
                );
                tests = testLines.map((line) => {
                    const parts = line.trim().split(/\s+/);
                    return {
                        name: parts[1],
                        score: parseFloat(parts[0]),
                        description: parts.slice(2).join(" "),
                    };
                });
            }

            return {
                score,
                isSpam,
                tests,
                method: "spamassassin",
            };
        } catch (error) {
            console.error("SpamAssassin test failed:", error);
            // Return neutral result if SpamAssassin fails
            return {
                score: 0,
                isSpam: false,
                tests: [],
                method: "spamassassin",
                error: error.message,
            };
        }
    }

    // Test with built-in heuristics
    async testWithHeuristics(content, sender) {
        let score = 0;
        const tests = [];

        // Check for suspicious keywords
        const spamKeywords = [
            "free money",
            "click here",
            "limited time",
            "act now",
            "guarantee",
            "no risk",
            "winner",
            "congratulations",
            "urgent",
            "immediate",
            "cash",
            "profit",
            "income",
            "viagra",
            "cialis",
            "pharmacy",
            "pills",
        ];

        const suspiciousCount = spamKeywords.filter((keyword) =>
            content.toLowerCase().includes(keyword.toLowerCase())
        ).length;

        if (suspiciousCount > 0) {
            const keywordScore = Math.min(suspiciousCount * 0.5, 3.0);
            score += keywordScore;
            tests.push({
                name: "SUSPICIOUS_KEYWORDS",
                score: keywordScore,
                description: `Contains ${suspiciousCount} suspicious keywords`,
            });
        }

        // Check for excessive capitalization
        const capsCount = (content.match(/[A-Z]/g) || []).length;
        const totalChars = content.replace(/\s/g, "").length;
        const capsRatio = totalChars > 0 ? capsCount / totalChars : 0;

        if (capsRatio > 0.3) {
            const capsScore = Math.min((capsRatio - 0.3) * 5, 2.0);
            score += capsScore;
            tests.push({
                name: "EXCESSIVE_CAPS",
                score: capsScore,
                description: `${(capsRatio * 100).toFixed(1)}% uppercase characters`,
            });
        }

        // Check for excessive exclamation marks
        const exclamationCount = (content.match(/!/g) || []).length;
        if (exclamationCount > 3) {
            const exclamationScore = Math.min(
                (exclamationCount - 3) * 0.3,
                1.5
            );
            score += exclamationScore;
            tests.push({
                name: "EXCESSIVE_EXCLAMATION",
                score: exclamationScore,
                description: `${exclamationCount} exclamation marks`,
            });
        }

        // Check for suspicious URLs
        const urlPattern = /https?:\/\/[^\s]+/gi;
        const urls = content.match(urlPattern) || [];
        const suspiciousUrls = urls.filter(
            (url) =>
                url.includes("bit.ly") ||
                url.includes("tinyurl") ||
                url.includes("t.co") ||
                url.match(/\d+\.\d+\.\d+\.\d+/) // IP addresses
        );

        if (suspiciousUrls.length > 0) {
            const urlScore = Math.min(suspiciousUrls.length * 1.0, 2.5);
            score += urlScore;
            tests.push({
                name: "SUSPICIOUS_URLS",
                score: urlScore,
                description: `${suspiciousUrls.length} suspicious URLs found`,
            });
        }

        // Check for missing sender reputation
        if (!sender || !sender.includes("@")) {
            score += 1.0;
            tests.push({
                name: "INVALID_SENDER",
                score: 1.0,
                description: "Invalid or missing sender address",
            });
        }

        // Check for HTML to text ratio
        const htmlTags = (content.match(/<[^>]+>/g) || []).length;
        const textLength = content
            .replace(/<[^>]+>/g, "")
            .replace(/\s+/g, " ")
            .trim().length;

        if (htmlTags > 0 && textLength < 100) {
            const ratioScore = Math.min(htmlTags / 10, 1.5);
            score += ratioScore;
            tests.push({
                name: "HIGH_HTML_RATIO",
                score: ratioScore,
                description: "High HTML tag to text ratio",
            });
        }

        return {
            score,
            isSpam: score >= 3.0,
            tests,
            method: "heuristics",
        };
    }

    // Create full email message for testing
    createFullEmailMessage(content, sender, recipient) {
        const now = new Date().toUTCString();
        const messageId = `<${Date.now()}.${Math.random().toString(36).substr(2, 9)}@${sender.split("@")[1]}>`;

        return `From: ${sender}
To: ${recipient}
Date: ${now}
Message-ID: ${messageId}
Subject: Test Message
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

${content}`;
    }

    // Generate recommendations based on test results
    generateRecommendations(spamResult, heuristicResult) {
        const recommendations = [];

        // Analyze SpamAssassin tests
        if (spamResult.tests) {
            spamResult.tests.forEach((test) => {
                if (test.score > 1.0) {
                    switch (test.name) {
                        case "BAYES_99":
                        case "BAYES_95":
                            recommendations.push(
                                "Content matches known spam patterns. Consider revising the message text."
                            );
                            break;
                        case "URIBL_BLACK":
                            recommendations.push(
                                "Contains URLs from blacklisted domains. Remove or replace suspicious links."
                            );
                            break;
                        case "RAZOR2_CHECK":
                            recommendations.push(
                                "Content matches known spam signatures. Rewrite the message content."
                            );
                            break;
                        case "DCC_CHECK":
                            recommendations.push(
                                "Similar content has been sent in bulk. Make the message more unique."
                            );
                            break;
                    }
                }
            });
        }

        // Analyze heuristic tests
        if (heuristicResult.tests) {
            heuristicResult.tests.forEach((test) => {
                switch (test.name) {
                    case "SUSPICIOUS_KEYWORDS":
                        recommendations.push(
                            "Remove or replace suspicious keywords that trigger spam filters."
                        );
                        break;
                    case "EXCESSIVE_CAPS":
                        recommendations.push(
                            "Reduce the use of capital letters. Use normal sentence case."
                        );
                        break;
                    case "EXCESSIVE_EXCLAMATION":
                        recommendations.push(
                            "Reduce the number of exclamation marks for a more professional tone."
                        );
                        break;
                    case "SUSPICIOUS_URLS":
                        recommendations.push(
                            "Replace shortened URLs with full domain names from reputable sources."
                        );
                        break;
                    case "HIGH_HTML_RATIO":
                        recommendations.push(
                            "Add more text content relative to HTML markup."
                        );
                        break;
                }
            });
        }

        // General recommendations
        if (spamResult.score > 3.0 || heuristicResult.score > 2.0) {
            recommendations.push(
                "Consider adding a plain text version of your email."
            );
            recommendations.push(
                "Ensure your sending domain has proper SPF, DKIM, and DMARC records."
            );
            recommendations.push(
                "Use a consistent sender name and email address."
            );
            recommendations.push(
                "Include an unsubscribe link for marketing emails."
            );
        }

        return [...new Set(recommendations)]; // Remove duplicates
    }

    // Test sender reputation
    async testSenderReputation(senderDomain, senderIP) {
        const results = {
            domain: senderDomain,
            ip: senderIP,
            checks: [],
        };

        try {
            // Check domain reputation (simplified)
            const domainCheck = await this.checkDomainReputation(senderDomain);
            results.checks.push(domainCheck);

            // Check IP reputation
            if (senderIP) {
                const ipCheck = await this.checkIPReputation(senderIP);
                results.checks.push(ipCheck);
            }

            // Calculate overall reputation score
            const avgScore =
                results.checks.reduce((sum, check) => sum + check.score, 0) /
                results.checks.length;
            results.overallScore = avgScore;
            results.reputation =
                avgScore >= 7 ? "good" : avgScore >= 4 ? "neutral" : "poor";

            return results;
        } catch (error) {
            throw new Error(`Reputation check failed: ${error.message}`);
        }
    }

    // Check domain reputation (simplified implementation)
    async checkDomainReputation(domain) {
        // In a real implementation, you would query reputation services
        // This is a simplified version
        const commonSpamDomains = [
            "tempmail.org",
            "10minutemail.com",
            "guerrillamail.com",
            "mailinator.com",
            "yopmail.com",
        ];

        const isSpamDomain = commonSpamDomains.some((spamDomain) =>
            domain.toLowerCase().includes(spamDomain)
        );

        return {
            type: "domain",
            value: domain,
            score: isSpamDomain ? 2 : 8,
            status: isSpamDomain ? "blacklisted" : "clean",
            details: isSpamDomain
                ? "Domain is known for temporary/spam emails"
                : "Domain appears clean",
        };
    }

    // Check IP reputation (simplified implementation)
    async checkIPReputation(ip) {
        // In a real implementation, you would query RBL services
        // This is a simplified version
        return {
            type: "ip",
            value: ip,
            score: 7,
            status: "clean",
            details: "IP address appears clean",
        };
    }

    // Batch test multiple emails
    async batchTest(emails) {
        const results = [];

        for (const email of emails) {
            try {
                const testResult = await this.testSpam(
                    email.content,
                    email.sender,
                    email.recipient
                );

                results.push({
                    id: email.id,
                    subject: email.subject,
                    ...testResult,
                });
            } catch (error) {
                results.push({
                    id: email.id,
                    subject: email.subject,
                    error: error.message,
                    isSpam: null,
                    score: null,
                });
            }
        }

        return results;
    }
}

module.exports = SpamService;
