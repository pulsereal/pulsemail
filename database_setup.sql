-- Database setup for Pulsemail Custom Client
-- This script creates additional tables needed for the enhanced features
-- Run this on your existing Pulsemail PostgreSQL database

-- Connect to the vmail database
\c vmail;

-- Create additional tables for enhanced features

-- User preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
    email VARCHAR(255) PRIMARY KEY,
    preferences JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Two-factor authentication table
CREATE TABLE IF NOT EXISTS user_2fa (
    email VARCHAR(255) PRIMARY KEY,
    totp_secret VARCHAR(255) NOT NULL,
    enabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- App passwords for programmatic access
CREATE TABLE IF NOT EXISTS app_passwords (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    last_used TIMESTAMP
);

-- Admin mailbox switches tracking
CREATE TABLE IF NOT EXISTS admin_mailbox_switches (
    id SERIAL PRIMARY KEY,
    admin_email VARCHAR(255) NOT NULL,
    target_email VARCHAR(255) NOT NULL,
    switched_at TIMESTAMP DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT,
    session_duration INTERVAL,
    switched_back_at TIMESTAMP
);

-- Sent emails log
CREATE TABLE IF NOT EXISTS sent_emails (
    id SERIAL PRIMARY KEY,
    from_email VARCHAR(255) NOT NULL,
    to_email TEXT NOT NULL,
    subject TEXT,
    content TEXT,
    message_id VARCHAR(255),
    sent_at TIMESTAMP DEFAULT NOW()
);

-- Email categories (AI-based and manual)
CREATE TABLE IF NOT EXISTS email_categories (
    user_email VARCHAR(255) NOT NULL,
    email_uid VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL,
    confidence DECIMAL(3,2) DEFAULT 0.8,
    method VARCHAR(20) DEFAULT 'manual',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_email, email_uid)
);

-- Email campaigns
CREATE TABLE IF NOT EXISTS email_campaigns (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    subject TEXT NOT NULL,
    content TEXT NOT NULL,
    recipients JSONB NOT NULL,
    scheduled_at TIMESTAMP,
    template_id INTEGER,
    status VARCHAR(20) DEFAULT 'draft',
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Campaign recipients tracking
CREATE TABLE IF NOT EXISTS campaign_recipients (
    id SERIAL PRIMARY KEY,
    campaign_id INTEGER NOT NULL,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    sent_at TIMESTAMP,
    opened_at TIMESTAMP,
    clicked_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending',
    message_id VARCHAR(255),
    error_message TEXT,
    FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE CASCADE
);

-- Campaign templates
CREATE TABLE IF NOT EXISTS campaign_templates (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    thumbnail TEXT,
    is_global BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Automation rules
CREATE TABLE IF NOT EXISTS automation_rules (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    trigger_type VARCHAR(50) NOT NULL,
    trigger_conditions JSONB NOT NULL,
    actions JSONB NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Automation execution logs
CREATE TABLE IF NOT EXISTS automation_logs (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    rule_id INTEGER,
    action VARCHAR(50) NOT NULL,
    data JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Scheduled follow-ups
CREATE TABLE IF NOT EXISTS scheduled_followups (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    recipient_email VARCHAR(255) NOT NULL,
    subject TEXT NOT NULL,
    content TEXT,
    scheduled_at TIMESTAMP NOT NULL,
    follow_up_type VARCHAR(50) DEFAULT 'general',
    original_email_data JSONB,
    use_llm BOOLEAN DEFAULT FALSE,
    purpose VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending',
    active BOOLEAN DEFAULT TRUE,
    sent_at TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Automation-generated tasks
CREATE TABLE IF NOT EXISTS automation_tasks (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    email_reference JSONB,
    due_date TIMESTAMP,
    priority VARCHAR(20) DEFAULT 'medium',
    status VARCHAR(20) DEFAULT 'pending',
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- User reply preferences for LLM
CREATE TABLE IF NOT EXISTS user_reply_preferences (
    email VARCHAR(255) PRIMARY KEY,
    preferences JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- LLM reply generation log
CREATE TABLE IF NOT EXISTS llm_reply_log (
    id SERIAL PRIMARY KEY,
    sender_email VARCHAR(255) NOT NULL,
    recipient_email VARCHAR(255) NOT NULL,
    original_content TEXT NOT NULL,
    generated_reply TEXT NOT NULL,
    context JSONB,
    feedback_rating INTEGER,
    feedback_text TEXT,
    feedback_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Email labels
CREATE TABLE IF NOT EXISTS email_labels (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    email_uid VARCHAR(255) NOT NULL,
    label VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_email, email_uid, label)
);

-- User notifications
CREATE TABLE IF NOT EXISTS user_notifications (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_email_categories_user_category ON email_categories(user_email, category);
CREATE INDEX IF NOT EXISTS idx_campaigns_user_status ON email_campaigns(user_email, status);
CREATE INDEX IF NOT EXISTS idx_automation_rules_user_active ON automation_rules(user_email, active);
CREATE INDEX IF NOT EXISTS idx_followups_scheduled ON scheduled_followups(scheduled_at, status, active);
CREATE INDEX IF NOT EXISTS idx_sent_emails_from_date ON sent_emails(from_email, sent_at);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign ON campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_automation_logs_user_date ON automation_logs(user_email, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_reply_log_recipient ON llm_reply_log(recipient_email, created_at);
CREATE INDEX IF NOT EXISTS idx_email_labels_user_email ON email_labels(user_email, email_uid);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON user_notifications(user_email, read_at);
CREATE INDEX IF NOT EXISTS idx_admin_switches_admin_date ON admin_mailbox_switches(admin_email, switched_at);
CREATE INDEX IF NOT EXISTS idx_admin_switches_target ON admin_mailbox_switches(target_email);

-- Create sample campaign templates
INSERT INTO campaign_templates (user_email, name, content, is_global) VALUES
('admin@example.com', 'Welcome Email', 
'<h1>Welcome to Our Service!</h1>
<p>Dear {name},</p>
<p>Thank you for joining us. We''re excited to have you on board!</p>
<p>Best regards,<br>The Team</p>', 
true),

('admin@example.com', 'Newsletter Template',
'<h1>Monthly Newsletter</h1>
<p>Hello {name},</p>
<p>Here''s what''s happening this month...</p>
<p>Best regards,<br>The Team</p>',
true),

('admin@example.com', 'Follow-up Email',
'<h1>Following Up</h1>
<p>Hi {name},</p>
<p>I wanted to follow up on our previous conversation...</p>
<p>Best regards,<br>Your Name</p>',
true);

-- Grant permissions (adjust as needed for your setup)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO vmail;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vmail;

-- Add comments for documentation
COMMENT ON TABLE user_preferences IS 'User-specific preferences and settings';
COMMENT ON TABLE user_2fa IS 'Two-factor authentication settings';
COMMENT ON TABLE app_passwords IS 'Application-specific passwords for API access';
COMMENT ON TABLE admin_mailbox_switches IS 'Audit log for admin mailbox switching';
COMMENT ON TABLE sent_emails IS 'Log of all sent emails';
COMMENT ON TABLE email_categories IS 'AI and manual categorization of emails';
COMMENT ON TABLE email_campaigns IS 'Email marketing campaigns';
COMMENT ON TABLE campaign_recipients IS 'Campaign recipient tracking and analytics';
COMMENT ON TABLE campaign_templates IS 'Reusable email templates';
COMMENT ON TABLE automation_rules IS 'Email automation rules and triggers';
COMMENT ON TABLE automation_logs IS 'Log of automation rule executions';
COMMENT ON TABLE scheduled_followups IS 'Scheduled follow-up emails';
COMMENT ON TABLE automation_tasks IS 'Tasks created by automation rules';
COMMENT ON TABLE user_reply_preferences IS 'User preferences for LLM-generated replies';
COMMENT ON TABLE llm_reply_log IS 'Log of LLM-generated email replies';
COMMENT ON TABLE email_labels IS 'Custom labels for emails';
COMMENT ON TABLE user_notifications IS 'System notifications for users';

-- Create a view for admin dashboard statistics
CREATE OR REPLACE VIEW admin_dashboard_stats AS
SELECT 
    (SELECT COUNT(*) FROM mailbox WHERE active = 1) as total_mailboxes,
    (SELECT COUNT(*) FROM domain WHERE active = 1) as total_domains,
    (SELECT COUNT(*) FROM admin_mailbox_switches WHERE switched_at >= NOW() - INTERVAL '24 hours') as switches_today,
    (SELECT COUNT(*) FROM sent_emails WHERE sent_at >= NOW() - INTERVAL '24 hours') as emails_sent_today,
    (SELECT COUNT(*) FROM email_campaigns WHERE status = 'sent' AND sent_at >= NOW() - INTERVAL '7 days') as campaigns_this_week;

-- Create a function to check if user is admin
CREATE OR REPLACE FUNCTION is_user_admin(user_email VARCHAR)
RETURNS TABLE(is_admin BOOLEAN, admin_type VARCHAR, domains TEXT[]) AS $$
BEGIN
    -- Check if user is in domain_admins table
    IF EXISTS (SELECT 1 FROM domain_admins WHERE username = user_email) THEN
        -- Check if global admin (ALL domain)
        IF EXISTS (SELECT 1 FROM domain_admins WHERE username = user_email AND domain = 'ALL') THEN
            RETURN QUERY SELECT true, 'global'::VARCHAR, ARRAY['ALL']::TEXT[];
        ELSE
            -- Domain admin
            RETURN QUERY SELECT 
                true, 
                'domain'::VARCHAR, 
                ARRAY(SELECT domain FROM domain_admins WHERE username = user_email)::TEXT[];
        END IF;
    ELSE
        RETURN QUERY SELECT false, null::VARCHAR, ARRAY[]::TEXT[];
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Create a function to get accessible mailboxes for admin
CREATE OR REPLACE FUNCTION get_admin_accessible_mailboxes(admin_email VARCHAR)
RETURNS TABLE(
    email VARCHAR,
    name VARCHAR, 
    domain VARCHAR,
    quota BIGINT,
    created TIMESTAMP,
    active INTEGER
) AS $$
DECLARE
    admin_info RECORD;
BEGIN
    -- Get admin information
    SELECT * INTO admin_info FROM is_user_admin(admin_email);
    
    IF NOT admin_info.is_admin THEN
        RETURN;
    END IF;
    
    IF admin_info.admin_type = 'global' THEN
        -- Global admin can access all mailboxes
        RETURN QUERY
        SELECT 
            m.username::VARCHAR as email,
            m.name::VARCHAR,
            m.domain::VARCHAR,
            m.quota,
            m.created,
            m.active
        FROM mailbox m
        WHERE m.active = 1
        ORDER BY m.domain, m.username;
    ELSE
        -- Domain admin can only access mailboxes in their domains
        RETURN QUERY
        SELECT 
            m.username::VARCHAR as email,
            m.name::VARCHAR,
            m.domain::VARCHAR,
            m.quota,
            m.created,
            m.active
        FROM mailbox m
        WHERE m.domain = ANY(admin_info.domains) AND m.active = 1
        ORDER BY m.domain, m.username;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Display table information
SELECT 
    schemaname,
    tablename,
    tableowner,
    tablespace,
    hasindexes,
    hasrules,
    hastriggers
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN (
    'user_preferences', 'user_2fa', 'app_passwords', 'admin_mailbox_switches',
    'sent_emails', 'email_categories', 'email_campaigns', 'campaign_recipients',
    'campaign_templates', 'automation_rules', 'automation_logs',
    'scheduled_followups', 'automation_tasks', 'user_reply_preferences',
    'llm_reply_log', 'email_labels', 'user_notifications'
)
ORDER BY tablename;

-- Show created indexes
SELECT 
    indexname,
    tablename,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- Show admin functions
SELECT 
    proname as function_name,
    pg_get_function_result(oid) as returns,
    pg_get_function_arguments(oid) as arguments
FROM pg_proc 
WHERE proname IN ('is_user_admin', 'get_admin_accessible_mailboxes');

ECHO 'Database setup completed successfully!';
ECHO 'Admin mailbox switching feature is now available.';
ECHO '';
ECHO 'Admin Features Added:';
ECHO '- Admin mailbox switching without authentication';
ECHO '- Audit logging for all mailbox switches';
ECHO '- Domain-based access control';
ECHO '- Switch history tracking';
ECHO '- Admin dashboard statistics';
ECHO '';
ECHO 'Next steps:';
ECHO '1. Configure admin users in domain_admins table';
ECHO '2. Test admin login and mailbox switching';
ECHO '3. Review audit logs in admin_mailbox_switches table';
