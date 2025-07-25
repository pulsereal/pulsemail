const express = require('express');
const Campaign = require('../models/Campaign');
const { authenticateToken, emailRateLimit } = require('../middleware/auth');

const router = express.Router();

// Get user's campaigns
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { limit = 20, offset = 0, status } = req.query;

    let campaigns = await Campaign.getUserCampaigns(email, parseInt(limit), parseInt(offset));

    // Filter by status if provided
    if (status && status !== 'all') {
      campaigns = campaigns.filter(campaign => campaign.status === status);
    }

    res.json({
      success: true,
      campaigns,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: campaigns.length
      }
    });

  } catch (error) {
    console.error('Get campaigns error:', error);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

// Get single campaign
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { id } = req.params;

    const campaign = await Campaign.getById(id, email);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json({
      success: true,
      campaign
    });

  } catch (error) {
    console.error('Get campaign error:', error);
    res.status(500).json({ error: 'Failed to fetch campaign' });
  }
});

// Create new campaign
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const {
      name,
      subject,
      content,
      recipients,
      scheduled_at,
      template_id
    } = req.body;

    // Validate required fields
    if (!name || !subject || !content || !recipients) {
      return res.status(400).json({ 
        error: 'Name, subject, content, and recipients are required' 
      });
    }

    // Validate recipients format
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ 
        error: 'Recipients must be a non-empty array' 
      });
    }

    // Validate each recipient
    for (const recipient of recipients) {
      if (!recipient.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email)) {
        return res.status(400).json({ 
          error: `Invalid email address: ${recipient.email}` 
        });
      }
    }

    const campaignData = {
      name,
      subject,
      content,
      recipients,
      scheduled_at: scheduled_at ? new Date(scheduled_at) : null,
      template_id
    };

    const campaign = await Campaign.create(email, campaignData);

    res.json({
      success: true,
      campaign,
      message: 'Campaign created successfully'
    });

  } catch (error) {
    console.error('Create campaign error:', error);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

// Update campaign
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { id } = req.params;
    const {
      name,
      subject,
      content,
      recipients,
      scheduled_at,
      template_id
    } = req.body;

    // Check if campaign exists and belongs to user
    const existingCampaign = await Campaign.getById(id, email);
    if (!existingCampaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Don't allow editing sent campaigns
    if (existingCampaign.status === 'sent') {
      return res.status(400).json({ error: 'Cannot edit sent campaigns' });
    }

    const updates = {};
    
    if (name !== undefined) updates.name = name;
    if (subject !== undefined) updates.subject = subject;
    if (content !== undefined) updates.content = content;
    if (recipients !== undefined) {
      // Validate recipients
      if (!Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ 
          error: 'Recipients must be a non-empty array' 
        });
      }
      updates.recipients = JSON.stringify(recipients);
    }
    if (scheduled_at !== undefined) {
      updates.scheduled_at = scheduled_at ? new Date(scheduled_at) : null;
    }
    if (template_id !== undefined) updates.template_id = template_id;

    const campaign = await Campaign.update(id, email, updates);

    res.json({
      success: true,
      campaign,
      message: 'Campaign updated successfully'
    });

  } catch (error) {
    console.error('Update campaign error:', error);
    res.status(500).json({ error: 'Failed to update campaign' });
  }
});

// Delete campaign
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { id } = req.params;

    const deleted = await Campaign.delete(id, email);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json({
      success: true,
      message: 'Campaign deleted successfully'
    });

  } catch (error) {
    console.error('Delete campaign error:', error);
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

// Send campaign
router.post('/:id/send', authenticateToken, emailRateLimit, async (req, res) => {
  try {
    const { email } = req.user;
    const { id } = req.params;

    const result = await Campaign.send(id, email);

    res.json({
      success: true,
      result,
      message: `Campaign sent to ${result.sentCount} recipients`
    });

  } catch (error) {
    console.error('Send campaign error:', error);
    res.status(500).json({ error: error.message || 'Failed to send campaign' });
  }
});

// Schedule campaign
router.post('/:id/schedule', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { id } = req.params;
    const { scheduled_at } = req.body;

    if (!scheduled_at) {
      return res.status(400).json({ error: 'Scheduled date is required' });
    }

    const scheduledDate = new Date(scheduled_at);
    
    if (scheduledDate <= new Date()) {
      return res.status(400).json({ error: 'Scheduled date must be in the future' });
    }

    const campaign = await Campaign.schedule(id, email, scheduledDate);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json({
      success: true,
      campaign,
      message: 'Campaign scheduled successfully'
    });

  } catch (error) {
    console.error('Schedule campaign error:', error);
    res.status(500).json({ error: 'Failed to schedule campaign' });
  }
});

// Get campaign analytics
router.get('/:id/analytics', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { id } = req.params;

    const analytics = await Campaign.getAnalytics(id, email);

    res.json({
      success: true,
      analytics
    });

  } catch (error) {
    console.error('Get campaign analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch campaign analytics' });
  }
});

// Duplicate campaign
router.post('/:id/duplicate', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { id } = req.params;
    const { name } = req.body;

    const duplicatedCampaign = await Campaign.duplicate(id, email, name);

    res.json({
      success: true,
      campaign: duplicatedCampaign,
      message: 'Campaign duplicated successfully'
    });

  } catch (error) {
    console.error('Duplicate campaign error:', error);
    res.status(500).json({ error: 'Failed to duplicate campaign' });
  }
});

// Get campaign templates
router.get('/templates/list', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;

    const templates = await Campaign.getTemplates(email);

    res.json({
      success: true,
      templates
    });

  } catch (error) {
    console.error('Get templates error:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// Create campaign template
router.post('/templates', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { name, content, thumbnail } = req.body;

    if (!name || !content) {
      return res.status(400).json({ error: 'Name and content are required' });
    }

    const template = await Campaign.createTemplate(email, {
      name,
      content,
      thumbnail,
      is_global: false
    });

    res.json({
      success: true,
      template,
      message: 'Template created successfully'
    });

  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// Test campaign (send to test recipients)
router.post('/:id/test', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { id } = req.params;
    const { test_emails } = req.body;

    if (!test_emails || !Array.isArray(test_emails) || test_emails.length === 0) {
      return res.status(400).json({ error: 'Test emails are required' });
    }

    // Get campaign
    const campaign = await Campaign.getById(id, email);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Send test emails
    const Email = require('../models/Email');
    const emailService = new Email();
    const results = [];

    for (const testEmail of test_emails) {
      try {
        const result = await emailService.sendEmail(
          email,
          testEmail,
          `[TEST] ${campaign.subject}`,
          campaign.content
        );
        
        results.push({
          email: testEmail,
          status: 'sent',
          messageId: result.messageId
        });
      } catch (error) {
        results.push({
          email: testEmail,
          status: 'failed',
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      results,
      message: `Test sent to ${results.filter(r => r.status === 'sent').length} recipients`
    });

  } catch (error) {
    console.error('Test campaign error:', error);
    res.status(500).json({ error: 'Failed to send test campaign' });
  }
});

// Import recipients from CSV
router.post('/recipients/import', authenticateToken, async (req, res) => {
  try {
    const { csv_data } = req.body;

    if (!csv_data) {
      return res.status(400).json({ error: 'CSV data is required' });
    }

    // Parse CSV data
    const lines = csv_data.trim().split('\n');
    const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
    
    // Find email column
    const emailIndex = headers.findIndex(h => 
      h === 'email' || h === 'email address' || h === 'e-mail'
    );
    
    if (emailIndex === -1) {
      return res.status(400).json({ error: 'Email column not found in CSV' });
    }

    // Find name column (optional)
    const nameIndex = headers.findIndex(h => 
      h === 'name' || h === 'full name' || h === 'first name'
    );

    const recipients = [];
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/^"(.*)"$/, '$1'));
      
      if (values.length <= emailIndex) {
        errors.push(`Line ${i + 1}: Not enough columns`);
        continue;
      }

      const email = values[emailIndex];
      const name = nameIndex >= 0 ? values[nameIndex] : '';

      // Validate email
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push(`Line ${i + 1}: Invalid email address: ${email}`);
        continue;
      }

      recipients.push({ email, name });
    }

    res.json({
      success: true,
      recipients,
      errors,
      summary: {
        total_lines: lines.length - 1,
        valid_recipients: recipients.length,
        errors: errors.length
      }
    });

  } catch (error) {
    console.error('Import recipients error:', error);
    res.status(500).json({ error: 'Failed to import recipients' });
  }
});

// Get campaign performance summary
router.get('/performance/summary', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { period = '30' } = req.query; // days

    const { query } = require('../config/database');
    
    const result = await query(`
      SELECT 
        COUNT(*) as total_campaigns,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent_campaigns,
        COUNT(CASE WHEN status = 'draft' THEN 1 END) as draft_campaigns,
        COUNT(CASE WHEN status = 'scheduled' THEN 1 END) as scheduled_campaigns,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '${parseInt(period)} days' THEN 1 END) as recent_campaigns
      FROM email_campaigns 
      WHERE user_email = $1
    `, [email]);

    const stats = result.rows[0];

    // Get recipient stats
    const recipientResult = await query(`
      SELECT 
        COUNT(*) as total_recipients,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
        COUNT(CASE WHEN opened_at IS NOT NULL THEN 1 END) as opened_count,
        COUNT(CASE WHEN clicked_at IS NOT NULL THEN 1 END) as clicked_count
      FROM campaign_recipients cr
      JOIN email_campaigns ec ON cr.campaign_id = ec.id
      WHERE ec.user_email = $1
      AND ec.created_at >= NOW() - INTERVAL '${parseInt(period)} days'
    `, [email]);

    const recipientStats = recipientResult.rows[0];

    // Calculate rates
    const sentCount = parseInt(recipientStats.sent_count) || 0;
    const deliveryRate = recipientStats.total_recipients > 0 ? 
      (sentCount / parseInt(recipientStats.total_recipients) * 100).toFixed(2) : 0;
    const openRate = sentCount > 0 ? 
      (parseInt(recipientStats.opened_count) / sentCount * 100).toFixed(2) : 0;
    const clickRate = sentCount > 0 ? 
      (parseInt(recipientStats.clicked_count) / sentCount * 100).toFixed(2) : 0;

    res.json({
      success: true,
      summary: {
        campaigns: stats,
        recipients: recipientStats,
        rates: {
          delivery_rate: parseFloat(deliveryRate),
          open_rate: parseFloat(openRate),
          click_rate: parseFloat(clickRate)
        },
        period: parseInt(period)
      }
    });

  } catch (error) {
    console.error('Get performance summary error:', error);
    res.status(500).json({ error: 'Failed to fetch performance summary' });
  }
});

// Cancel scheduled campaign
router.post('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { id } = req.params;

    const campaign = await Campaign.getById(id, email);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.status !== 'scheduled') {
      return res.status(400).json({ error: 'Only scheduled campaigns can be cancelled' });
    }

    const updatedCampaign = await Campaign.update(id, email, { 
      status: 'draft',
      scheduled_at: null 
    });

    res.json({
      success: true,
      campaign: updatedCampaign,
      message: 'Campaign cancelled successfully'
    });

  } catch (error) {
    console.error('Cancel campaign error:', error);
    res.status(500).json({ error: 'Failed to cancel campaign' });
  }
});

module.exports = router;
