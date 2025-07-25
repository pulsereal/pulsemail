const express = require('express');
const multer = require('multer');
const Email = require('../models/Email');
const LLMService = require('../services/LLMService');
const SpamService = require('../services/SpamService');
const AutomationService = require('../services/AutomationService');
const { 
  authenticateToken, 
  emailRateLimit,
  authenticateAppPassword
} = require('../middleware/auth');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 5 // Max 5 files
  }
});

// Initialize services
const emailService = new Email();
const llmService = new LLMService();
const spamService = new SpamService();
let automationService;

// Initialize automation service
(async () => {
  automationService = new AutomationService();
})();

// Get emails with pagination and filtering
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { 
      folder = 'INBOX', 
      limit = 50, 
      offset = 0,
      search,
      category,
      unread_only
    } = req.query;

    let emails;

    if (search) {
      // Search emails
      const searchCriteria = [
        ['OR', 
          ['SUBJECT', search],
          ['FROM', search],
          ['BODY', search]
        ]
      ];
      emails = await emailService.searchEmails(email, searchCriteria, folder);
    } else {
      // Get regular emails
      emails = await emailService.getEmails(email, folder, parseInt(limit), parseInt(offset));
    }

    // Filter by category if requested
    if (category && category !== 'all') {
      const { query } = require('../config/database');
      const categoryResult = await query(`
        SELECT email_uid FROM email_categories 
        WHERE user_email = $1 AND category = $2
      `, [email, category]);
      
      const categoryUids = new Set(categoryResult.rows.map(row => row.email_uid));
      emails = emails.filter(email => categoryUids.has(email.uid));
    }

    // Filter unread only if requested
    if (unread_only === 'true') {
      emails = emails.filter(email => !email.flags.includes('\\Seen'));
    }

    // Categorize emails using LLM if not already categorized
    for (const email of emails) {
      try {
        const { query } = require('../config/database');
        const categoryResult = await query(`
          SELECT category FROM email_categories 
          WHERE user_email = $1 AND email_uid = $2
        `, [req.user.email, email.uid]);

        if (categoryResult.rows.length === 0) {
          // Get email content for categorization
          const emailContent = await emailService.getEmailContent(req.user.email, email.uid, folder);
          const category = await llmService.categorizeEmail(
            emailContent.text || emailContent.html || '',
            email.subject,
            email.from
          );

          // Store category
          await query(`
            INSERT INTO email_categories (user_email, email_uid, category, confidence, method, created_at)
            VALUES ($1, $2, $3, 0.8, 'llm', NOW())
          `, [req.user.email, email.uid, category]);

          email.category = category;
        } else {
          email.category = categoryResult.rows[0].category;
        }
      } catch (error) {
        console.error('Error categorizing email:', error);
        email.category = 'work'; // Default category
      }
    }

    res.json({
      success: true,
      emails,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: emails.length
      }
    });

  } catch (error) {
    console.error('Get emails error:', error);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

// Get single email content
router.get('/:uid', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { uid } = req.params;
    const { folder = 'INBOX' } = req.query;

    const emailContent = await emailService.getEmailContent(email, uid, folder);
    
    if (!emailContent) {
      return res.status(404).json({ error: 'Email not found' });
    }

    // Generate summary using LLM
    try {
      const summary = await llmService.summarizeEmail(emailContent.text || emailContent.html || '');
      emailContent.summary = summary;
    } catch (error) {
      console.error('Error generating summary:', error);
    }

    // Get category
    try {
      const { query } = require('../config/database');
      const categoryResult = await query(`
        SELECT category FROM email_categories 
        WHERE user_email = $1 AND email_uid = $2
      `, [email, uid]);

      if (categoryResult.rows.length > 0) {
        emailContent.category = categoryResult.rows[0].category;
      }
    } catch (error) {
      console.error('Error getting category:', error);
    }

    res.json({
      success: true,
      email: emailContent
    });

  } catch (error) {
    console.error('Get email content error:', error);
    res.status(500).json({ error: 'Failed to fetch email content' });
  }
});

// Send email
router.post('/send', authenticateToken, emailRateLimit, upload.array('attachments'), async (req, res) => {
  try {
    const { email } = req.user;
    const { to, cc, bcc, subject, content, test_spam = false } = req.body;

    if (!to || !subject || !content) {
      return res.status(400).json({ error: 'To, subject, and content are required' });
    }

    // Parse recipients
    const recipients = Array.isArray(to) ? to : [to];
    const ccRecipients = cc ? (Array.isArray(cc) ? cc : [cc]) : [];
    const bccRecipients = bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : [];

    // Process attachments
    const attachments = req.files ? req.files.map(file => ({
      filename: file.originalname,
      content: file.buffer,
      contentType: file.mimetype
    })) : [];

    // Test for spam if requested
    let spamResult = null;
    if (test_spam === 'true' || test_spam === true) {
      try {
        spamResult = await spamService.testSpam(content, email, recipients[0]);
        
        if (spamResult.isSpam && spamResult.score > 7.0) {
          return res.status(400).json({
            error: 'Email content appears to be spam',
            spamResult,
            recommendations: spamResult.recommendations
          });
        }
      } catch (error) {
        console.error('Spam test error:', error);
        // Continue sending even if spam test fails
      }
    }

    // Send email to all recipients
    const results = [];
    const allRecipients = [...recipients, ...ccRecipients, ...bccRecipients];

    for (const recipient of allRecipients) {
      try {
        const result = await emailService.sendEmail(email, recipient, subject, content, attachments);
        results.push({
          recipient,
          status: 'sent',
          messageId: result.messageId
        });
      } catch (error) {
        results.push({
          recipient,
          status: 'failed',
          error: error.message
        });
      }
    }

    const failedCount = results.filter(r => r.status === 'failed').length;
    const successCount = results.filter(r => r.status === 'sent').length;

    res.json({
      success: successCount > 0,
      results,
      summary: {
        sent: successCount,
        failed: failedCount,
        total: allRecipients.length
      },
      spamResult
    });

  } catch (error) {
    console.error('Send email error:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// Generate AI reply
router.post('/:uid/reply', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { uid } = req.params;
    const { 
      folder = 'INBOX',
      tone = 'professional',
      language = 'en',
      custom_instructions = ''
    } = req.body;

    // Get original email content
    const originalEmail = await emailService.getEmailContent(email, uid, folder);
    
    if (!originalEmail) {
      return res.status(404).json({ error: 'Original email not found' });
    }

    // Generate reply using LLM
    const replyResult = await llmService.generateReply(
      originalEmail.text || originalEmail.html || '',
      originalEmail.from.value[0].address,
      email,
      {
        tone,
        language,
        customInstructions: custom_instructions
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
        date: originalEmail.date
      }
    });

  } catch (error) {
    console.error('Generate reply error:', error);
    res.status(500).json({ error: 'Failed to generate reply' });
  }
});

// Mark email as read/unread
router.patch('/:uid/mark', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { uid } = req.params;
    const { action } = req.body; // 'read' or 'unread'

    if (!['read', 'unread'].includes(action)) {
      return res.status(400).json({ error: 'Action must be "read" or "unread"' });
    }

    const isRead = action === 'read';
    await emailService.markEmail(email, uid, '\\Seen', isRead);

    res.json({
      success: true,
      message: `Email marked as ${action}`
    });

  } catch (error) {
    console.error('Mark email error:', error);
    res.status(500).json({ error: 'Failed to mark email' });
  }
});

// Delete email
router.delete('/:uid', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { uid } = req.params;
    const { folder = 'INBOX' } = req.query;

    await emailService.deleteEmail(email, uid, folder);

    res.json({
      success: true,
      message: 'Email deleted successfully'
    });

  } catch (error) {
    console.error('Delete email error:', error);
    res.status(500).json({ error: 'Failed to delete email' });
  }
});

// Move email to folder
router.patch('/:uid/move', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { uid } = req.params;
    const { target_folder, source_folder = 'INBOX' } = req.body;

    if (!target_folder) {
      return res.status(400).json({ error: 'Target folder is required' });
    }

    await emailService.moveEmail(email, uid, target_folder, source_folder);

    res.json({
      success: true,
      message: `Email moved to ${target_folder}`
    });

  } catch (error) {
    console.error('Move email error:', error);
    res.status(500).json({ error: 'Failed to move email' });
  }
});

// Get email folders
router.get('/folders/list', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const folders = await emailService.getFolders(email);

    // Format folders for frontend
    const formatFolder = (name, folder) => ({
      name,
      displayName: name.replace(/^INBOX\.?/, '').replace(/\./g, '/') || 'Inbox',
      hasChildren: folder.children && Object.keys(folder.children).length > 0,
      children: folder.children ? Object.keys(folder.children).map(childName => 
        formatFolder(childName, folder.children[childName])
      ) : []
    });

    const formattedFolders = Object.keys(folders).map(name => formatFolder(name, folders[name]));

    res.json({
      success: true,
      folders: formattedFolders
    });

  } catch (error) {
    console.error('Get folders error:', error);
    res.status(500).json({ error: 'Failed to get folders' });
  }
});

// Test spam for email content
router.post('/test-spam', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { content, subject, recipient } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const spamResult = await spamService.testSpam(content, email, recipient || 'test@example.com');

    res.json({
      success: true,
      spamResult
    });

  } catch (error) {
    console.error('Test spam error:', error);
    res.status(500).json({ error: 'Failed to test spam' });
  }
});

// Get email statistics
router.get('/stats/dashboard', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    
    // Get email statistics
    const emailStats = await Email.getEmailStats(email);
    
    // Get LLM reply statistics
    const llmStats = await llmService.getReplyStats(email);
    
    // Get automation statistics
    const automationStats = automationService ? 
      await automationService.getAutomationStats(email) : 
      { total_rules: 0, active_rules: 0, total_executions: 0 };

    res.json({
      success: true,
      stats: {
        emails: emailStats,
        llm: llmStats,
        automation: automationStats
      }
    });

  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// Search emails with advanced filters
router.post('/search', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { 
      query: searchQuery,
      folder = 'INBOX',
      sender,
      subject,
      date_from,
      date_to,
      has_attachments,
      category
    } = req.body;

    let searchCriteria = [];

    // Build search criteria
    if (searchQuery) {
      searchCriteria.push(['OR', 
        ['SUBJECT', searchQuery],
        ['FROM', searchQuery],
        ['BODY', searchQuery]
      ]);
    }

    if (sender) {
      searchCriteria.push(['FROM', sender]);
    }

    if (subject) {
      searchCriteria.push(['SUBJECT', subject]);
    }

    if (date_from) {
      searchCriteria.push(['SINCE', new Date(date_from)]);
    }

    if (date_to) {
      searchCriteria.push(['BEFORE', new Date(date_to)]);
    }

    if (has_attachments === true) {
      searchCriteria.push(['HEADER', 'CONTENT-TYPE', 'MULTIPART']);
    }

    // Combine all criteria with AND
    const finalCriteria = searchCriteria.length > 1 ? 
      ['AND', ...searchCriteria] : 
      searchCriteria[0] || ['ALL'];

    const emails = await emailService.searchEmails(email, finalCriteria, folder);

    // Filter by category if specified
    if (category && category !== 'all') {
      const { query } = require('../config/database');
      const categoryResult = await query(`
        SELECT email_uid FROM email_categories 
        WHERE user_email = $1 AND category = $2
      `, [email, category]);
      
      const categoryUids = new Set(categoryResult.rows.map(row => row.email_uid));
      emails = emails.filter(email => categoryUids.has(email.uid));
    }

    res.json({
      success: true,
      emails,
      total: emails.length
    });

  } catch (error) {
    console.error('Search emails error:', error);
    res.status(500).json({ error: 'Failed to search emails' });
  }
});

// Categorize email manually
router.patch('/:uid/categorize', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { uid } = req.params;
    const { category } = req.body;

    const validCategories = ['important', 'personal', 'promotional', 'social', 'spam', 'automated', 'work'];
    
    if (!validCategories.includes(category)) {
      return res.status(400).json({ 
        error: 'Invalid category',
        validCategories 
      });
    }

    const { query } = require('../config/database');
    await query(`
      INSERT INTO email_categories (user_email, email_uid, category, confidence, method, created_at)
      VALUES ($1, $2, $3, 1.0, 'manual', NOW())
      ON CONFLICT (user_email, email_uid) 
      DO UPDATE SET category = $3, confidence = 1.0, method = 'manual', updated_at = NOW()
    `, [email, uid, category]);

    res.json({
      success: true,
      message: `Email categorized as ${category}`
    });

  } catch (error) {
    console.error('Categorize email error:', error);
    res.status(500).json({ error: 'Failed to categorize email' });
  }
});

// Provide feedback on LLM generated reply
router.post('/llm-feedback', authenticateToken, async (req, res) => {
  try {
    const { log_id, rating, feedback = '' } = req.body;

    if (!log_id || !rating) {
      return res.status(400).json({ error: 'Log ID and rating are required' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    await llmService.provideFeedback(log_id, rating, feedback);

    res.json({
      success: true,
      message: 'Feedback provided successfully'
    });

  } catch (error) {
    console.error('LLM feedback error:', error);
    res.status(500).json({ error: 'Failed to provide feedback' });
  }
});

// Email endpoint for external integrations (using app passwords)
router.post('/external/send', authenticateAppPassword, emailRateLimit, async (req, res) => {
  try {
    const { email } = req.user;
    const { to, subject, content, attachments = [] } = req.body;

    if (!to || !subject || !content) {
      return res.status(400).json({ error: 'To, subject, and content are required' });
    }

    const result = await emailService.sendEmail(email, to, subject, content, attachments);

    res.json({
      success: true,
      messageId: result.messageId,
      message: 'Email sent successfully'
    });

  } catch (error) {
    console.error('External send email error:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

module.exports = router;
