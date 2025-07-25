const express = require('express');
const AutomationService = require('../services/AutomationService');
const LLMService = require('../services/LLMService');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

let automationService;
const llmService = new LLMService();

// Initialize automation service
(async () => {
  automationService = new AutomationService();
})();

// Get user's automation rules
router.get('/rules', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { limit = 20, offset = 0, active_only } = req.query;

    let rules = await automationService.getUserRules(email, parseInt(limit), parseInt(offset));

    // Filter active rules only if requested
    if (active_only === 'true') {
      rules = rules.filter(rule => rule.active);
    }

    res.json({
      success: true,
      rules,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: rules.length
      }
    });

  } catch (error) {
    console.error('Get automation rules error:', error);
    res.status(500).json({ error: 'Failed to fetch automation rules' });
  }
});

// Create automation rule
router.post('/rules', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const {
      name,
      trigger_type,
      trigger_conditions,
      actions,
      active = true
    } = req.body;

    // Validate required fields
    if (!name || !trigger_type || !trigger_conditions || !actions) {
      return res.status(400).json({ 
        error: 'Name, trigger type, conditions, and actions are required' 
      });
    }

    // Validate trigger type
    const validTriggerTypes = ['email_received', 'schedule', 'manual'];
    if (!validTriggerTypes.includes(trigger_type)) {
      return res.status(400).json({ 
        error: 'Invalid trigger type',
        validTypes: validTriggerTypes
      });
    }

    // Validate actions
    if (!Array.isArray(actions) || actions.length === 0) {
      return res.status(400).json({ error: 'Actions must be a non-empty array' });
    }

    const validActionTypes = [
      'auto_reply', 'forward', 'mark_as_read', 'move_to_folder', 
      'add_label', 'create_task', 'send_notification', 'llm_categorize'
    ];

    for (const action of actions) {
      if (!validActionTypes.includes(action.type)) {
        return res.status(400).json({ 
          error: `Invalid action type: ${action.type}`,
          validTypes: validActionTypes
        });
      }
    }

    const ruleData = {
      name,
      trigger_type,
      trigger_conditions,
      actions,
      active
    };

    const rule = await automationService.createRule(email, ruleData);

    res.json({
      success: true,
      rule,
      message: 'Automation rule created successfully'
    });

  } catch (error) {
    console.error('Create automation rule error:', error);
    res.status(500).json({ error: 'Failed to create automation rule' });
  }
});

// Update automation rule
router.put('/rules/:id', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { id } = req.params;
    const updates = req.body;

    // Get existing rule to verify ownership
    const { query } = require('../config/database');
    const existingRule = await query(`
      SELECT * FROM automation_rules 
      WHERE id = $1 AND user_email = $2
    `, [id, email]);

    if (existingRule.rows.length === 0) {
      return res.status(404).json({ error: 'Automation rule not found' });
    }

    // Update rule
    const setClause = Object.keys(updates)
      .map((key, index) => `${key} = $${index + 3}`)
      .join(', ');
    
    const values = [id, email, ...Object.values(updates)];
    
    const result = await query(`
      UPDATE automation_rules 
      SET ${setClause}, updated_at = NOW()
      WHERE id = $1 AND user_email = $2
      RETURNING *
    `, values);

    const updatedRule = result.rows[0];

    // Update in automation service if active status changed
    if (updates.active !== undefined) {
      await automationService.toggleRule(id, email, updates.active);
    }

    res.json({
      success: true,
      rule: updatedRule,
      message: 'Automation rule updated successfully'
    });

  } catch (error) {
    console.error('Update automation rule error:', error);
    res.status(500).json({ error: 'Failed to update automation rule' });
  }
});

// Delete automation rule
router.delete('/rules/:id', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { id } = req.params;

    const deleted = await automationService.deleteRule(id, email);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Automation rule not found' });
    }

    res.json({
      success: true,
      message: 'Automation rule deleted successfully'
    });

  } catch (error) {
    console.error('Delete automation rule error:', error);
    res.status(500).json({ error: 'Failed to delete automation rule' });
  }
});

// Toggle automation rule active status
router.patch('/rules/:id/toggle', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { id } = req.params;
    const { active } = req.body;

    if (typeof active !== 'boolean') {
      return res.status(400).json({ error: 'Active status must be a boolean' });
    }

    const rule = await automationService.toggleRule(id, email, active);
    
    if (!rule) {
      return res.status(404).json({ error: 'Automation rule not found' });
    }

    res.json({
      success: true,
      rule,
      message: `Automation rule ${active ? 'enabled' : 'disabled'} successfully`
    });

  } catch (error) {
    console.error('Toggle automation rule error:', error);
    res.status(500).json({ error: 'Failed to toggle automation rule' });
  }
});

// Test automation rule (dry run)
router.post('/rules/:id/test', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { id } = req.params;
    const { test_email_data } = req.body;

    if (!test_email_data) {
      return res.status(400).json({ error: 'Test email data is required' });
    }

    // Get rule
    const { query } = require('../config/database');
    const ruleResult = await query(`
      SELECT * FROM automation_rules 
      WHERE id = $1 AND user_email = $2
    `, [id, email]);

    if (ruleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Automation rule not found' });
    }

    const rule = ruleResult.rows[0];

    // Test if email would match conditions
    const wouldMatch = automationService.checkEmailConditions(
      test_email_data, 
      rule.trigger_conditions
    );

    let simulatedActions = [];
    
    if (wouldMatch) {
      // Simulate what actions would be performed
      for (const action of rule.actions) {
        switch (action.type) {
          case 'auto_reply':
            simulatedActions.push({
              type: 'auto_reply',
              description: `Would send auto-reply to ${test_email_data.from}`,
              details: {
                subject: action.subject || `Re: ${test_email_data.subject}`,
                use_llm: action.use_llm || false
              }
            });
            break;
          case 'forward':
            simulatedActions.push({
              type: 'forward',
              description: `Would forward email to ${action.recipients.join(', ')}`,
              details: action.recipients
            });
            break;
          case 'mark_as_read':
            simulatedActions.push({
              type: 'mark_as_read',
              description: 'Would mark email as read'
            });
            break;
          case 'move_to_folder':
            simulatedActions.push({
              type: 'move_to_folder',
              description: `Would move email to folder: ${action.folder}`,
              details: { folder: action.folder }
            });
            break;
          case 'add_label':
            simulatedActions.push({
              type: 'add_label',
              description: `Would add label: ${action.label}`,
              details: { label: action.label }
            });
            break;
          case 'llm_categorize':
            simulatedActions.push({
              type: 'llm_categorize',
              description: 'Would categorize email using AI'
            });
            break;
          default:
            simulatedActions.push({
              type: action.type,
              description: `Would perform action: ${action.type}`
            });
        }
      }
    }

    res.json({
      success: true,
      test_result: {
        rule_name: rule.name,
        would_match: wouldMatch,
        simulated_actions: simulatedActions,
        conditions_checked: rule.trigger_conditions
      }
    });

  } catch (error) {
    console.error('Test automation rule error:', error);
    res.status(500).json({ error: 'Failed to test automation rule' });
  }
});

// Get automation statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    
    const stats = await automationService.getAutomationStats(email);

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('Get automation stats error:', error);
    res.status(500).json({ error: 'Failed to fetch automation statistics' });
  }
});

// Get automation logs
router.get('/logs', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { limit = 50, offset = 0, action } = req.query;

    const { query } = require('../config/database');
    
    let whereClause = 'WHERE user_email = $1';
    let params = [email];
    
    if (action) {
      whereClause += ' AND action = $2';
      params.push(action);
    }

    const result = await query(`
      SELECT * FROM automation_logs 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, parseInt(limit), parseInt(offset)]);

    res.json({
      success: true,
      logs: result.rows,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: result.rows.length
      }
    });

  } catch (error) {
    console.error('Get automation logs error:', error);
    res.status(500).json({ error: 'Failed to fetch automation logs' });
  }
});

// Get scheduled follow-ups
router.get('/follow-ups', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { status = 'all', limit = 20, offset = 0 } = req.query;

    const { query } = require('../config/database');
    
    let whereClause = 'WHERE user_email = $1';
    let params = [email];
    
    if (status !== 'all') {
      whereClause += ' AND status = $2';
      params.push(status);
    }

    const result = await query(`
      SELECT * FROM scheduled_followups 
      ${whereClause}
      ORDER BY scheduled_at ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, parseInt(limit), parseInt(offset)]);

    res.json({
      success: true,
      followUps: result.rows,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: result.rows.length
      }
    });

  } catch (error) {
    console.error('Get follow-ups error:', error);
    res.status(500).json({ error: 'Failed to fetch follow-ups' });
  }
});

// Schedule follow-up
router.post('/follow-ups', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const {
      recipient_email,
      subject,
      content,
      scheduled_at,
      follow_up_type = 'general',
      original_email_data,
      use_llm = false,
      purpose = 'follow-up'
    } = req.body;

    if (!recipient_email || !subject || !scheduled_at) {
      return res.status(400).json({ 
        error: 'Recipient email, subject, and scheduled date are required' 
      });
    }

    const scheduledDate = new Date(scheduled_at);
    if (scheduledDate <= new Date()) {
      return res.status(400).json({ error: 'Scheduled date must be in the future' });
    }

    const { query } = require('../config/database');
    const result = await query(`
      INSERT INTO scheduled_followups (
        user_email, recipient_email, subject, content, scheduled_at,
        follow_up_type, original_email_data, use_llm, purpose, 
        status, active, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', true, NOW())
      RETURNING *
    `, [
      email, recipient_email, subject, content, scheduledDate,
      follow_up_type, JSON.stringify(original_email_data || {}),
      use_llm, purpose
    ]);

    res.json({
      success: true,
      followUp: result.rows[0],
      message: 'Follow-up scheduled successfully'
    });

  } catch (error) {
    console.error('Schedule follow-up error:', error);
    res.status(500).json({ error: 'Failed to schedule follow-up' });
  }
});

// Update follow-up
router.put('/follow-ups/:id', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { id } = req.params;
    const updates = req.body;

    const { query } = require('../config/database');
    
    // Check if follow-up exists and belongs to user
    const existingFollowUp = await query(`
      SELECT * FROM scheduled_followups 
      WHERE id = $1 AND user_email = $2
    `, [id, email]);

    if (existingFollowUp.rows.length === 0) {
      return res.status(404).json({ error: 'Follow-up not found' });
    }

    const current = existingFollowUp.rows[0];
    
    // Don't allow editing sent follow-ups
    if (current.status === 'sent') {
      return res.status(400).json({ error: 'Cannot edit sent follow-ups' });
    }

    // Validate scheduled_at if being updated
    if (updates.scheduled_at) {
      const scheduledDate = new Date(updates.scheduled_at);
      if (scheduledDate <= new Date()) {
        return res.status(400).json({ error: 'Scheduled date must be in the future' });
      }
    }

    const setClause = Object.keys(updates)
      .map((key, index) => `${key} = $${index + 3}`)
      .join(', ');
    
    const values = [id, email, ...Object.values(updates)];
    
    const result = await query(`
      UPDATE scheduled_followups 
      SET ${setClause}, updated_at = NOW()
      WHERE id = $1 AND user_email = $2
      RETURNING *
    `, values);

    res.json({
      success: true,
      followUp: result.rows[0],
      message: 'Follow-up updated successfully'
    });

  } catch (error) {
    console.error('Update follow-up error:', error);
    res.status(500).json({ error: 'Failed to update follow-up' });
  }
});

// Cancel follow-up
router.delete('/follow-ups/:id', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { id } = req.params;

    const { query } = require('../config/database');
    const result = await query(`
      DELETE FROM scheduled_followups 
      WHERE id = $1 AND user_email = $2 AND status = 'pending'
      RETURNING id
    `, [id, email]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Follow-up not found or cannot be cancelled' });
    }

    res.json({
      success: true,
      message: 'Follow-up cancelled successfully'
    });

  } catch (error) {
    console.error('Cancel follow-up error:', error);
    res.status(500).json({ error: 'Failed to cancel follow-up' });
  }
});

// Get automation tasks
router.get('/tasks', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { status = 'all', limit = 20, offset = 0 } = req.query;

    const { query } = require('../config/database');
    
    let whereClause = 'WHERE user_email = $1';
    let params = [email];
    
    if (status !== 'all') {
      whereClause += ' AND status = $2';
      params.push(status);
    }

    const result = await query(`
      SELECT * FROM automation_tasks 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, parseInt(limit), parseInt(offset)]);

    res.json({
      success: true,
      tasks: result.rows,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: result.rows.length
      }
    });

  } catch (error) {
    console.error('Get automation tasks error:', error);
    res.status(500).json({ error: 'Failed to fetch automation tasks' });
  }
});

// Update task status
router.patch('/tasks/:id', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { id } = req.params;
    const { status, notes } = req.body;

    const validStatuses = ['pending', 'in_progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status',
        validStatuses
      });
    }

    const { query } = require('../config/database');
    const result = await query(`
      UPDATE automation_tasks 
      SET status = $3, notes = $4, updated_at = NOW()
      WHERE id = $1 AND user_email = $2
      RETURNING *
    `, [id, email, status, notes || null]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({
      success: true,
      task: result.rows[0],
      message: 'Task updated successfully'
    });

  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Get rule templates
router.get('/templates', authenticateToken, async (req, res) => {
  try {
    const templates = [
      {
        id: 'auto_reply_ooo',
        name: 'Out of Office Auto-Reply',
        description: 'Automatically reply to emails when you\'re away',
        trigger_type: 'email_received',
        trigger_conditions: {
          time: { business_hours_only: false }
        },
        actions: [{
          type: 'auto_reply',
          subject: 'Out of Office: {subject}',
          content: 'Thank you for your email. I am currently out of office and will respond when I return.',
          use_llm: false
        }]
      },
      {
        id: 'urgent_email_forward',
        name: 'Forward Urgent Emails',
        description: 'Forward emails marked as urgent to another address',
        trigger_type: 'email_received',
        trigger_conditions: {
          subject: { contains: 'urgent' }
        },
        actions: [{
          type: 'forward',
          recipients: ['manager@company.com']
        }]
      },
      {
        id: 'newsletter_organize',
        name: 'Organize Newsletters',
        description: 'Automatically move newsletters to a dedicated folder',
        trigger_type: 'email_received',
        trigger_conditions: {
          content: { contains: 'unsubscribe' }
        },
        actions: [{
          type: 'move_to_folder',
          folder: 'Newsletters'
        }, {
          type: 'mark_as_read'
        }]
      },
      {
        id: 'ai_categorize',
        name: 'AI Email Categorization',
        description: 'Use AI to automatically categorize all incoming emails',
        trigger_type: 'email_received',
        trigger_conditions: {},
        actions: [{
          type: 'llm_categorize'
        }]
      },
      {
        id: 'smart_reply',
        name: 'Smart Auto-Reply',
        description: 'Generate intelligent auto-replies using AI',
        trigger_type: 'email_received',
        trigger_conditions: {
          sender: { domain: 'customer.com' }
        },
        actions: [{
          type: 'auto_reply',
          use_llm: true,
          tone: 'professional',
          custom_instructions: 'Keep responses helpful and concise'
        }]
      }
    ];

    res.json({
      success: true,
      templates
    });

  } catch (error) {
    console.error('Get rule templates error:', error);
    res.status(500).json({ error: 'Failed to fetch rule templates' });
  }
});

// Create rule from template
router.post('/rules/from-template', authenticateToken, async (req, res) => {
  try {
    const { email } = req.user;
    const { template_id, name, customizations = {} } = req.body;

    if (!template_id || !name) {
      return res.status(400).json({ error: 'Template ID and name are required' });
    }

    // Get template (this would typically come from a database)
    const templates = {
      'auto_reply_ooo': {
        trigger_type: 'email_received',
        trigger_conditions: { time: { business_hours_only: false } },
        actions: [{
          type: 'auto_reply',
          subject: 'Out of Office: {subject}',
          content: 'Thank you for your email. I am currently out of office and will respond when I return.',
          use_llm: false
        }]
      }
      // Add other templates here
    };

    const template = templates[template_id];
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Apply customizations
    const ruleData = {
      name,
      trigger_type: template.trigger_type,
      trigger_conditions: { ...template.trigger_conditions, ...customizations.trigger_conditions },
      actions: template.actions.map(action => ({ ...action, ...customizations.actions?.[0] })),
      active: true
    };

    const rule = await automationService.createRule(email, ruleData);

    res.json({
      success: true,
      rule,
      message: 'Rule created from template successfully'
    });

  } catch (error) {
    console.error('Create rule from template error:', error);
    res.status(500).json({ error: 'Failed to create rule from template' });
  }
});

module.exports = router;
