const { query } = require('../config/database');
const Email = require('../models/Email');
const LLMService = require('./LLMService');
const cron = require('node-cron');

class AutomationService {
  constructor() {
    this.llmService = new LLMService();
    this.emailService = new Email();
    this.activeRules = new Map();
    this.scheduledTasks = new Map();
    this.init();
  }

  // Initialize automation service
  async init() {
    await this.loadActiveRules();
    this.startScheduler();
  }

  // Load all active automation rules
  async loadActiveRules() {
    try {
      const result = await query(`
        SELECT * FROM automation_rules 
        WHERE active = true
      `);

      for (const rule of result.rows) {
        this.activeRules.set(rule.id, rule);
        
        // Set up scheduled tasks for time-based rules
        if (rule.trigger_type === 'schedule') {
          this.scheduleRule(rule);
        }
      }

      console.log(`Loaded ${result.rows.length} active automation rules`);
    } catch (error) {
      console.error('Failed to load automation rules:', error);
    }
  }

  // Create new automation rule
  async createRule(userEmail, ruleData) {
    try {
      const {
        name,
        trigger_type,
        trigger_conditions,
        actions,
        active = true
      } = ruleData;

      const result = await query(`
        INSERT INTO automation_rules (
          user_email, name, trigger_type, trigger_conditions, 
          actions, active, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING *
      `, [
        userEmail, name, trigger_type, 
        JSON.stringify(trigger_conditions),
        JSON.stringify(actions),
        active
      ]);

      const rule = result.rows[0];
      
      if (active) {
        this.activeRules.set(rule.id, rule);
        
        if (trigger_type === 'schedule') {
          this.scheduleRule(rule);
        }
      }

      await this.logAutomation(userEmail, 'rule_created', {
        ruleId: rule.id,
        ruleName: name
      });

      return rule;
    } catch (error) {
      throw new Error(`Failed to create automation rule: ${error.message}`);
    }
  }

  // Process incoming email for automation triggers
  async processIncomingEmail(emailData) {
    try {
      const { from, to, subject, content, uid } = emailData;
      
      // Find applicable rules for this email
      const applicableRules = Array.from(this.activeRules.values())
        .filter(rule => 
          rule.user_email === to && 
          rule.trigger_type === 'email_received' &&
          this.checkEmailConditions(emailData, rule.trigger_conditions)
        );

      // Execute actions for each applicable rule
      for (const rule of applicableRules) {
        await this.executeRuleActions(rule, emailData);
      }

      return applicableRules.length;
    } catch (error) {
      console.error('Failed to process incoming email:', error);
      return 0;
    }
  }

  // Check if email matches rule conditions
  checkEmailConditions(emailData, conditions) {
    try {
      const { from, to, subject, content } = emailData;
      
      // Check sender conditions
      if (conditions.sender) {
        if (conditions.sender.includes && !from.toLowerCase().includes(conditions.sender.includes.toLowerCase())) {
          return false;
        }
        if (conditions.sender.equals && from.toLowerCase() !== conditions.sender.equals.toLowerCase()) {
          return false;
        }
        if (conditions.sender.domain) {
          const senderDomain = from.split('@')[1];
          if (senderDomain !== conditions.sender.domain.toLowerCase()) {
            return false;
          }
        }
      }

      // Check subject conditions
      if (conditions.subject) {
        if (conditions.subject.contains && !subject.toLowerCase().includes(conditions.subject.contains.toLowerCase())) {
          return false;
        }
        if (conditions.subject.matches && !new RegExp(conditions.subject.matches, 'i').test(subject)) {
          return false;
        }
      }

      // Check content conditions
      if (conditions.content) {
        if (conditions.content.contains && !content.toLowerCase().includes(conditions.content.contains.toLowerCase())) {
          return false;
        }
        if (conditions.content.matches && !new RegExp(conditions.content.matches, 'i').test(content)) {
          return false;
        }
      }

      // Check time conditions
      if (conditions.time) {
        const now = new Date();
        const hour = now.getHours();
        
        if (conditions.time.business_hours_only && (hour < 9 || hour > 17)) {
          return false;
        }
        if (conditions.time.after && hour < parseInt(conditions.time.after)) {
          return false;
        }
        if (conditions.time.before && hour > parseInt(conditions.time.before)) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Error checking email conditions:', error);
      return false;
    }
  }

  // Execute rule actions
  async executeRuleActions(rule, emailData) {
    try {
      const actions = rule.actions;
      
      for (const action of actions) {
        switch (action.type) {
          case 'auto_reply':
            await this.executeAutoReply(rule, emailData, action);
            break;
          case 'forward':
            await this.executeForward(rule, emailData, action);
            break;
          case 'mark_as_read':
            await this.executeMarkAsRead(rule, emailData, action);
            break;
          case 'move_to_folder':
            await this.executeMoveToFolder(rule, emailData, action);
            break;
          case 'add_label':
            await this.executeAddLabel(rule, emailData, action);
            break;
          case 'create_task':
            await this.executeCreateTask(rule, emailData, action);
            break;
          case 'send_notification':
            await this.executeSendNotification(rule, emailData, action);
            break;
          case 'llm_categorize':
            await this.executeLLMCategorize(rule, emailData, action);
            break;
          default:
            console.warn(`Unknown action type: ${action.type}`);
        }
      }

      // Log successful execution
      await this.logAutomation(rule.user_email, 'rule_executed', {
        ruleId: rule.id,
        ruleName: rule.name,
        emailFrom: emailData.from,
        emailSubject: emailData.subject
      });

    } catch (error) {
      console.error(`Failed to execute rule ${rule.id}:`, error);
      
      // Log failed execution
      await this.logAutomation(rule.user_email, 'rule_failed', {
        ruleId: rule.id,
        ruleName: rule.name,
        error: error.message
      });
    }
  }

  // Execute auto-reply action
  async executeAutoReply(rule, emailData, action) {
    const { from, to, subject, content } = emailData;
    
    let replyContent = action.content;
    let replySubject = action.subject || `Re: ${subject}`;

    // Use LLM to generate smart reply if configured
    if (action.use_llm) {
      const llmResponse = await this.llmService.generateReply(
        content,
        from,
        to,
        {
          tone: action.tone || 'professional',
          language: action.language || 'en',
          customInstructions: action.custom_instructions || ''
        }
      );
      
      replyContent = llmResponse.reply;
    }

    // Replace placeholders
    replyContent = this.replacePlaceholders(replyContent, emailData, rule);
    replySubject = this.replacePlaceholders(replySubject, emailData, rule);

    // Send the reply
    await this.emailService.sendEmail(to, from, replySubject, replyContent);
    
    console.log(`Auto-reply sent from ${to} to ${from}`);
  }

  // Execute forward action
  async executeForward(rule, emailData, action) {
    const { from, to, subject, content } = emailData;
    
    const forwardContent = `
      <p><strong>Forwarded message:</strong></p>
      <p><strong>From:</strong> ${from}</p>
      <p><strong>To:</strong> ${to}</p>
      <p><strong>Subject:</strong> ${subject}</p>
      <hr>
      ${content}
    `;
    
    const forwardSubject = `Fwd: ${subject}`;
    
    for (const recipient of action.recipients) {
      await this.emailService.sendEmail(to, recipient, forwardSubject, forwardContent);
    }
    
    console.log(`Email forwarded to ${action.recipients.join(', ')}`);
  }

  // Execute mark as read action
  async executeMarkAsRead(rule, emailData, action) {
    const { uid } = emailData;
    await this.emailService.markEmail(rule.user_email, uid, '\\Seen', true);
    console.log(`Email ${uid} marked as read`);
  }

  // Execute move to folder action
  async executeMoveToFolder(rule, emailData, action) {
    const { uid } = emailData;
    await this.emailService.moveEmail(rule.user_email, uid, action.folder);
    console.log(`Email ${uid} moved to folder: ${action.folder}`);
  }

  // Execute add label action
  async executeAddLabel(rule, emailData, action) {
    try {
      await query(`
        INSERT INTO email_labels (user_email, email_uid, label, created_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (user_email, email_uid, label) DO NOTHING
      `, [rule.user_email, emailData.uid, action.label]);
      
      console.log(`Label "${action.label}" added to email ${emailData.uid}`);
    } catch (error) {
      console.error('Failed to add label:', error);
    }
  }

  // Execute create task action
  async executeCreateTask(rule, emailData, action) {
    try {
      const taskTitle = this.replacePlaceholders(action.title, emailData, rule);
      const taskDescription = this.replacePlaceholders(action.description || '', emailData, rule);
      
      await query(`
        INSERT INTO automation_tasks (
          user_email, title, description, email_reference, 
          due_date, priority, status, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
      `, [
        rule.user_email,
        taskTitle,
        taskDescription,
        JSON.stringify({ from: emailData.from, subject: emailData.subject, uid: emailData.uid }),
        action.due_date || null,
        action.priority || 'medium'
      ]);
      
      console.log(`Task created: ${taskTitle}`);
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  }

  // Execute send notification action
  async executeSendNotification(rule, emailData, action) {
    try {
      const notificationContent = this.replacePlaceholders(action.message, emailData, rule);
      
      // Store notification in database
      await query(`
        INSERT INTO user_notifications (
          user_email, type, title, message, data, created_at
        )
        VALUES ($1, 'automation', $2, $3, $4, NOW())
      `, [
        rule.user_email,
        action.title || 'Automation Alert',
        notificationContent,
        JSON.stringify({ ruleId: rule.id, emailFrom: emailData.from })
      ]);
      
      console.log(`Notification sent to ${rule.user_email}`);
    } catch (error) {
      console.error('Failed to send notification:', error);
    }
  }

  // Execute LLM categorize action
  async executeLLMCategorize(rule, emailData, action) {
    try {
      const category = await this.llmService.categorizeEmail(
        emailData.content,
        emailData.subject,
        emailData.from
      );
      
      // Store categorization
      await query(`
        INSERT INTO email_categories (
          user_email, email_uid, category, confidence, method, created_at
        )
        VALUES ($1, $2, $3, $4, 'llm', NOW())
        ON CONFLICT (user_email, email_uid) 
        DO UPDATE SET category = $3, confidence = $4, method = 'llm', updated_at = NOW()
      `, [rule.user_email, emailData.uid, category, 0.8]);
      
      console.log(`Email categorized as: ${category}`);
    } catch (error) {
      console.error('Failed to categorize email:', error);
    }
  }

  // Replace placeholders in text
  replacePlaceholders(text, emailData, rule) {
    return text
      .replace(/\{sender\}/g, emailData.from)
      .replace(/\{recipient\}/g, emailData.to || rule.user_email)
      .replace(/\{subject\}/g, emailData.subject)
      .replace(/\{date\}/g, new Date().toLocaleDateString())
      .replace(/\{time\}/g, new Date().toLocaleTimeString())
      .replace(/\{sender_name\}/g, emailData.from.split('@')[0]);
  }

  // Schedule rule for periodic execution
  scheduleRule(rule) {
    const conditions = rule.trigger_conditions;
    
    if (!conditions.schedule) {
      return;
    }

    const cronPattern = conditions.schedule.cron || '0 9 * * 1-5'; // Default: 9 AM weekdays
    
    const task = cron.schedule(cronPattern, async () => {
      await this.executeScheduledRule(rule);
    }, {
      scheduled: false
    });

    this.scheduledTasks.set(rule.id, task);
    task.start();
    
    console.log(`Scheduled rule ${rule.id} with pattern: ${cronPattern}`);
  }

  // Execute scheduled rule
  async executeScheduledRule(rule) {
    try {
      console.log(`Executing scheduled rule: ${rule.name}`);
      
      // Execute actions for scheduled rules
      for (const action of rule.actions) {
        switch (action.type) {
          case 'send_email':
            await this.executeSendScheduledEmail(rule, action);
            break;
          case 'generate_report':
            await this.executeGenerateReport(rule, action);
            break;
          case 'cleanup_emails':
            await this.executeCleanupEmails(rule, action);
            break;
          default:
            console.warn(`Unsupported scheduled action: ${action.type}`);
        }
      }
      
      await this.logAutomation(rule.user_email, 'scheduled_rule_executed', {
        ruleId: rule.id,
        ruleName: rule.name
      });
      
    } catch (error) {
      console.error(`Failed to execute scheduled rule ${rule.id}:`, error);
      
      await this.logAutomation(rule.user_email, 'scheduled_rule_failed', {
        ruleId: rule.id,
        ruleName: rule.name,
        error: error.message
      });
    }
  }

  // Send scheduled email
  async executeSendScheduledEmail(rule, action) {
    const content = this.replacePlaceholders(action.content, {}, rule);
    const subject = this.replacePlaceholders(action.subject, {}, rule);
    
    for (const recipient of action.recipients) {
      await this.emailService.sendEmail(rule.user_email, recipient, subject, content);
    }
    
    console.log(`Scheduled email sent to ${action.recipients.length} recipients`);
  }

  // Generate and send report
  async executeGenerateReport(rule, action) {
    // This would generate various reports based on action.report_type
    console.log(`Generating report: ${action.report_type}`);
  }

  // Cleanup old emails
  async executeCleanupEmails(rule, action) {
    // This would clean up emails based on criteria
    console.log(`Cleaning up emails older than ${action.days_old} days`);
  }

  // Start the automation scheduler
  startScheduler() {
    // Check for follow-ups every hour
    cron.schedule('0 * * * *', async () => {
      await this.processScheduledFollowUps();
    });

    console.log('Automation scheduler started');
  }

  // Process scheduled follow-ups
  async processScheduledFollowUps() {
    try {
      const result = await query(`
        SELECT * FROM scheduled_followups 
        WHERE scheduled_at <= NOW() 
        AND status = 'pending'
        AND active = true
      `);

      for (const followUp of result.rows) {
        await this.executeFollowUp(followUp);
      }
    } catch (error) {
      console.error('Failed to process scheduled follow-ups:', error);
    }
  }

  // Execute follow-up
  async executeFollowUp(followUp) {
    try {
      const { user_email, original_email_data, follow_up_type, content } = followUp;
      
      let followUpContent = content;
      
      // Generate LLM follow-up if content is empty
      if (!content && followUp.use_llm) {
        const conversationHistory = JSON.parse(original_email_data);
        const llmResponse = await this.llmService.generateFollowUp(
          conversationHistory,
          follow_up_type,
          { purpose: followUp.purpose }
        );
        followUpContent = llmResponse.content;
      }
      
      // Send follow-up email
      await this.emailService.sendEmail(
        user_email,
        followUp.recipient_email,
        followUp.subject,
        followUpContent
      );
      
      // Mark as sent
      await query(`
        UPDATE scheduled_followups 
        SET status = 'sent', sent_at = NOW()
        WHERE id = $1
      `, [followUp.id]);
      
      console.log(`Follow-up sent: ${followUp.subject}`);
      
    } catch (error) {
      console.error(`Failed to execute follow-up ${followUp.id}:`, error);
      
      // Mark as failed
      await query(`
        UPDATE scheduled_followups 
        SET status = 'failed', error_message = $2
        WHERE id = $1
      `, [followUp.id, error.message]);
    }
  }

  // Get user's automation rules
  async getUserRules(userEmail, limit = 20, offset = 0) {
    try {
      const result = await query(`
        SELECT ar.*, 
          (SELECT COUNT(*) FROM automation_logs WHERE rule_id = ar.id AND action = 'rule_executed') as execution_count,
          (SELECT MAX(created_at) FROM automation_logs WHERE rule_id = ar.id AND action = 'rule_executed') as last_executed
        FROM automation_rules ar
        WHERE user_email = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `, [userEmail, limit, offset]);

      return result.rows;
    } catch (error) {
      throw new Error(`Failed to get user rules: ${error.message}`);
    }
  }

  // Toggle rule active status
  async toggleRule(ruleId, userEmail, active) {
    try {
      const result = await query(`
        UPDATE automation_rules 
        SET active = $3, updated_at = NOW()
        WHERE id = $1 AND user_email = $2
        RETURNING *
      `, [ruleId, userEmail, active]);

      const rule = result.rows[0];
      if (!rule) {
        throw new Error('Rule not found');
      }

      if (active) {
        this.activeRules.set(rule.id, rule);
        if (rule.trigger_type === 'schedule') {
          this.scheduleRule(rule);
        }
      } else {
        this.activeRules.delete(rule.id);
        if (this.scheduledTasks.has(rule.id)) {
          this.scheduledTasks.get(rule.id).stop();
          this.scheduledTasks.delete(rule.id);
        }
      }

      return rule;
    } catch (error) {
      throw new Error(`Failed to toggle rule: ${error.message}`);
    }
  }

  // Delete automation rule
  async deleteRule(ruleId, userEmail) {
    try {
      const result = await query(`
        DELETE FROM automation_rules 
        WHERE id = $1 AND user_email = $2
        RETURNING id
      `, [ruleId, userEmail]);

      if (result.rows.length > 0) {
        this.activeRules.delete(ruleId);
        if (this.scheduledTasks.has(ruleId)) {
          this.scheduledTasks.get(ruleId).stop();
          this.scheduledTasks.delete(ruleId);
        }
        return true;
      }
      
      return false;
    } catch (error) {
      throw new Error(`Failed to delete rule: ${error.message}`);
    }
  }

  // Log automation activity
  async logAutomation(userEmail, action, data) {
    try {
      await query(`
        INSERT INTO automation_logs (
          user_email, action, data, created_at
        )
        VALUES ($1, $2, $3, NOW())
      `, [userEmail, action, JSON.stringify(data)]);
    } catch (error) {
      console.error('Failed to log automation:', error);
    }
  }

  // Get automation statistics
  async getAutomationStats(userEmail) {
    try {
      const result = await query(`
        SELECT 
          COUNT(DISTINCT ar.id) as total_rules,
          COUNT(DISTINCT CASE WHEN ar.active THEN ar.id END) as active_rules,
          COUNT(al.id) as total_executions,
          COUNT(CASE WHEN al.created_at >= NOW() - INTERVAL '7 days' THEN al.id END) as executions_this_week,
          COUNT(CASE WHEN al.action = 'rule_failed' THEN al.id END) as failed_executions
        FROM automation_rules ar
        LEFT JOIN automation_logs al ON ar.id = (al.data->>'ruleId')::int
        WHERE ar.user_email = $1
      `, [userEmail]);

      return result.rows[0] || {
        total_rules: 0,
        active_rules: 0,
        total_executions: 0,
        executions_this_week: 0,
        failed_executions: 0
      };
    } catch (error) {
      return {
        total_rules: 0,
        active_rules: 0,
        total_executions: 0,
        executions_this_week: 0,
        failed_executions: 0
      };
    }
  }
}

module.exports = AutomationService;
