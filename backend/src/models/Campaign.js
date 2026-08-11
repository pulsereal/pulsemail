const { query } = require("../config/database");
const { mailService } = require("../services/MailService");

class Campaign {
    // Create new email campaign
    static async create(userEmail, campaignData) {
        try {
            const {
                name,
                subject,
                content,
                recipients,
                scheduled_at,
                template_id,
            } = campaignData;

            const result = await query(
                `
        INSERT INTO email_campaigns (
          user_email, name, subject, content, recipients, 
          scheduled_at, template_id, status, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', NOW())
        RETURNING *
      `,
                [
                    userEmail,
                    name,
                    subject,
                    content,
                    JSON.stringify(recipients),
                    scheduled_at,
                    template_id,
                ]
            );

            return result.rows[0];
        } catch (error) {
            throw new Error(`Error creating campaign: ${error.message}`);
        }
    }

    // Get user's campaigns
    static async getUserCampaigns(userEmail, limit = 20, offset = 0) {
        try {
            const result = await query(
                `
        SELECT *, 
          (SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = ec.id) as recipient_count,
          (SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = ec.id AND sent_at IS NOT NULL) as sent_count
        FROM email_campaigns ec
        WHERE user_email = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `,
                [userEmail, limit, offset]
            );

            return result.rows;
        } catch (error) {
            throw new Error(`Error fetching campaigns: ${error.message}`);
        }
    }

    // Get campaign by ID
    static async getById(campaignId, userEmail) {
        try {
            const result = await query(
                `
        SELECT * FROM email_campaigns 
        WHERE id = $1 AND user_email = $2
      `,
                [campaignId, userEmail]
            );

            return result.rows[0] || null;
        } catch (error) {
            throw new Error(`Error fetching campaign: ${error.message}`);
        }
    }

    // Update campaign
    static async update(campaignId, userEmail, updates) {
        try {
            const setClause = Object.keys(updates)
                .map((key, index) => `${key} = $${index + 3}`)
                .join(", ");

            const values = [campaignId, userEmail, ...Object.values(updates)];

            const result = await query(
                `
        UPDATE email_campaigns 
        SET ${setClause}, updated_at = NOW()
        WHERE id = $1 AND user_email = $2
        RETURNING *
      `,
                values
            );

            return result.rows[0] || null;
        } catch (error) {
            throw new Error(`Error updating campaign: ${error.message}`);
        }
    }

    // Delete campaign
    static async delete(campaignId, userEmail) {
        try {
            const result = await query(
                `
        DELETE FROM email_campaigns 
        WHERE id = $1 AND user_email = $2
        RETURNING id
      `,
                [campaignId, userEmail]
            );

            return result.rows.length > 0;
        } catch (error) {
            throw new Error(`Error deleting campaign: ${error.message}`);
        }
    }

    // Send campaign
    static async send(campaignId, userEmail) {
        try {
            const campaign = await this.getById(campaignId, userEmail);
            if (!campaign) {
                throw new Error("Campaign not found");
            }

            if (campaign.status === "sent") {
                throw new Error("Campaign already sent");
            }

            const recipients = JSON.parse(campaign.recipients);
            const emailService = mailService;

            // Update campaign status to sending
            await this.update(campaignId, userEmail, { status: "sending" });

            const sendResults = [];

            for (const recipient of recipients) {
                try {
                    // Personalize content if needed
                    let personalizedContent = campaign.content;
                    if (recipient.name) {
                        personalizedContent = personalizedContent.replace(
                            /\{name\}/g,
                            recipient.name
                        );
                    }
                    personalizedContent = personalizedContent.replace(
                        /\{email\}/g,
                        recipient.email
                    );

                    const result = await emailService.sendEmail(
                        userEmail,
                        recipient.email,
                        campaign.subject,
                        personalizedContent
                    );

                    // Log recipient send status
                    await query(
                        `
            INSERT INTO campaign_recipients (
              campaign_id, email, name, sent_at, status, message_id
            )
            VALUES ($1, $2, $3, NOW(), 'sent', $4)
          `,
                        [
                            campaignId,
                            recipient.email,
                            recipient.name || null,
                            result.messageId,
                        ]
                    );

                    sendResults.push({
                        email: recipient.email,
                        status: "sent",
                        messageId: result.messageId,
                    });
                } catch (error) {
                    // Log failed send
                    await query(
                        `
            INSERT INTO campaign_recipients (
              campaign_id, email, name, sent_at, status, error_message
            )
            VALUES ($1, $2, $3, NOW(), 'failed', $4)
          `,
                        [
                            campaignId,
                            recipient.email,
                            recipient.name || null,
                            error.message,
                        ]
                    );

                    sendResults.push({
                        email: recipient.email,
                        status: "failed",
                        error: error.message,
                    });
                }
            }

            // Update campaign status
            const failedCount = sendResults.filter(
                (r) => r.status === "failed"
            ).length;
            const finalStatus =
                failedCount === sendResults.length
                    ? "failed"
                    : failedCount > 0
                      ? "partially_sent"
                      : "sent";

            await this.update(campaignId, userEmail, {
                status: finalStatus,
                sent_at: new Date().toISOString(),
            });

            return {
                campaignId,
                status: finalStatus,
                totalRecipients: recipients.length,
                sentCount: sendResults.filter((r) => r.status === "sent")
                    .length,
                failedCount,
                results: sendResults,
            };
        } catch (error) {
            // Update campaign status to failed
            await this.update(campaignId, userEmail, { status: "failed" });
            throw new Error(`Error sending campaign: ${error.message}`);
        }
    }

    // Get campaign analytics
    static async getAnalytics(campaignId, userEmail) {
        try {
            const campaign = await this.getById(campaignId, userEmail);
            if (!campaign) {
                throw new Error("Campaign not found");
            }

            const result = await query(
                `
        SELECT 
          COUNT(*) as total_recipients,
          COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent_count,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
          COUNT(CASE WHEN opened_at IS NOT NULL THEN 1 END) as opened_count,
          COUNT(CASE WHEN clicked_at IS NOT NULL THEN 1 END) as clicked_count
        FROM campaign_recipients 
        WHERE campaign_id = $1
      `,
                [campaignId]
            );

            const stats = result.rows[0];

            // Calculate rates
            const sentCount = parseInt(stats.sent_count);
            const openRate =
                sentCount > 0
                    ? (
                          (parseInt(stats.opened_count) / sentCount) *
                          100
                      ).toFixed(2)
                    : 0;
            const clickRate =
                sentCount > 0
                    ? (
                          (parseInt(stats.clicked_count) / sentCount) *
                          100
                      ).toFixed(2)
                    : 0;

            return {
                campaign: {
                    id: campaign.id,
                    name: campaign.name,
                    subject: campaign.subject,
                    status: campaign.status,
                    created_at: campaign.created_at,
                    sent_at: campaign.sent_at,
                },
                stats: {
                    ...stats,
                    open_rate: parseFloat(openRate),
                    click_rate: parseFloat(clickRate),
                },
            };
        } catch (error) {
            throw new Error(
                `Error fetching campaign analytics: ${error.message}`
            );
        }
    }

    // Schedule campaign
    static async schedule(campaignId, userEmail, scheduledAt) {
        try {
            const result = await query(
                `
        UPDATE email_campaigns 
        SET scheduled_at = $3, status = 'scheduled', updated_at = NOW()
        WHERE id = $1 AND user_email = $2
        RETURNING *
      `,
                [campaignId, userEmail, scheduledAt]
            );

            return result.rows[0] || null;
        } catch (error) {
            throw new Error(`Error scheduling campaign: ${error.message}`);
        }
    }

    // Get scheduled campaigns that need to be sent
    static async getScheduledCampaigns() {
        try {
            const result = await query(`
        SELECT * FROM email_campaigns 
        WHERE status = 'scheduled' 
        AND scheduled_at <= NOW()
        AND scheduled_at IS NOT NULL
      `);

            return result.rows;
        } catch (error) {
            throw new Error(
                `Error fetching scheduled campaigns: ${error.message}`
            );
        }
    }

    // Duplicate campaign
    static async duplicate(campaignId, userEmail, newName) {
        try {
            const originalCampaign = await this.getById(campaignId, userEmail);
            if (!originalCampaign) {
                throw new Error("Original campaign not found");
            }

            const result = await query(
                `
        INSERT INTO email_campaigns (
          user_email, name, subject, content, recipients, 
          template_id, status, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'draft', NOW())
        RETURNING *
      `,
                [
                    userEmail,
                    newName || `Copy of ${originalCampaign.name}`,
                    originalCampaign.subject,
                    originalCampaign.content,
                    originalCampaign.recipients,
                    originalCampaign.template_id,
                ]
            );

            return result.rows[0];
        } catch (error) {
            throw new Error(`Error duplicating campaign: ${error.message}`);
        }
    }

    // Get campaign templates
    static async getTemplates(userEmail) {
        try {
            const result = await query(
                `
        SELECT * FROM campaign_templates 
        WHERE user_email = $1 OR is_global = true
        ORDER BY is_global DESC, name ASC
      `,
                [userEmail]
            );

            return result.rows;
        } catch (error) {
            throw new Error(`Error fetching templates: ${error.message}`);
        }
    }

    // Create campaign template
    static async createTemplate(userEmail, templateData) {
        try {
            const {
                name,
                content,
                thumbnail,
                is_global = false,
            } = templateData;

            const result = await query(
                `
        INSERT INTO campaign_templates (
          user_email, name, content, thumbnail, is_global, created_at
        )
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING *
      `,
                [userEmail, name, content, thumbnail, is_global]
            );

            return result.rows[0];
        } catch (error) {
            throw new Error(`Error creating template: ${error.message}`);
        }
    }
}

module.exports = Campaign;
