// Campaign Types
export interface Campaign {
    id: string;
    name: string;
    subject: string;
    content: string;
    status: "draft" | "scheduled" | "sending" | "sent" | "paused" | "cancelled";
    recipients: CampaignRecipient[];
    recipients_count: number;
    sent_count?: number;
    opens_count?: number;
    clicks_count?: number;
    bounces_count?: number;
    unsubscribes_count?: number;
    created_at: string;
    scheduled_at?: string;
    sent_at?: string;
    template_id?: number;
    template_name?: string;
    tracking_enabled: boolean;
    test_emails?: string[];
}

export interface CampaignRecipient {
    email: string;
    name?: string;
    status?:
        | "pending"
        | "sent"
        | "delivered"
        | "opened"
        | "clicked"
        | "bounced"
        | "unsubscribed";
    sent_at?: string;
    opened_at?: string;
    clicked_at?: string;
    bounced_at?: string;
    bounce_reason?: string;
}

export interface CampaignTemplate {
    id: number;
    name: string;
    content: string;
    thumbnail?: string;
    created_at: string;
    updated_at: string;
}

export interface CampaignAnalytics {
    campaign_id: string;
    total_sent: number;
    total_delivered: number;
    total_opens: number;
    total_clicks: number;
    total_bounces: number;
    total_unsubscribes: number;
    open_rate: number;
    click_rate: number;
    bounce_rate: number;
    unsubscribe_rate: number;
    daily_stats: DailyStats[];
    recipient_stats: RecipientStats[];
    link_clicks: LinkClick[];
    device_breakdown: DeviceBreakdown;
    location_breakdown: LocationBreakdown;
    recommendations?: string[];
}

export interface DailyStats {
    date: string;
    sent: number;
    opens: number;
    clicks: number;
    bounces: number;
}

export interface RecipientStats {
    email: string;
    status: string;
    opens: number;
    clicks: number;
    last_activity?: string;
}

export interface LinkClick {
    url: string;
    clicks: number;
    unique_clicks: number;
}

export interface DeviceBreakdown {
    desktop: number;
    mobile: number;
    tablet: number;
    unknown: number;
}

export interface LocationBreakdown {
    [country: string]: number;
}

// Automation Types
export interface AutomationRule {
    id: string;
    name: string;
    description?: string;
    trigger_type: TriggerType;
    trigger_conditions: TriggerConditions;
    actions: AutomationAction[];
    active: boolean;
    created_at: string;
    updated_at: string;
    last_triggered?: string;
    execution_count: number;
    success_count: number;
    error_count: number;
    created_by: string;
}

export type TriggerType =
    | "email_received"
    | "email_sent"
    | "keyword_match"
    | "sender_domain"
    | "schedule"
    | "follow_up_due"
    | "attachment_received"
    | "vip_sender"
    | "bounced_email";

export interface TriggerConditions {
    keywords?: string[];
    sender_patterns?: string[];
    subject_patterns?: string[];
    body_patterns?: string[];
    folder?: string;
    schedule_cron?: string;
    follow_up_delay_hours?: number;
    attachment_types?: string[];
    vip_senders?: string[];
    bounce_type?: "hard" | "soft" | "any";
    priority_level?: "high" | "medium" | "low";
}

export interface AutomationAction {
    type: ActionType;
    config: ActionConfig;
    order: number;
    enabled: boolean;
}

export type ActionType =
    | "auto_reply"
    | "forward_email"
    | "categorize"
    | "schedule_follow_up"
    | "create_task"
    | "llm_generate_reply"
    | "send_notification"
    | "move_to_folder"
    | "add_label"
    | "mark_important"
    | "webhook_call";

export interface ActionConfig {
    // Auto Reply
    subject?: string;
    message?: string;
    use_llm?: boolean;
    tone?: "professional" | "friendly" | "formal" | "casual";

    // Forward Email
    forward_to?: string;
    include_original?: boolean;

    // Categorize
    category?: string;
    confidence_threshold?: number;

    // Schedule Follow-up
    delay_hours?: number;
    follow_up_template?: string;
    purpose?: string;

    // Create Task
    title?: string;
    description?: string;
    due_in_days?: number;
    assignee?: string;
    priority?: "high" | "medium" | "low";

    // LLM Generate Reply
    instructions?: string;
    auto_send?: boolean;
    language?: string;

    // Send Notification
    notification_type?: "email" | "sms" | "slack" | "webhook";
    recipients?: string[];

    // Move to Folder
    folder?: string;
    create_if_not_exists?: boolean;

    // Add Label
    label?: string;
    color?: string;

    // Webhook Call
    webhook_url?: string;
    webhook_method?: "GET" | "POST" | "PUT";
    webhook_headers?: Record<string, string>;
    webhook_body?: string;
}

export interface FollowUp {
    id: string;
    recipient_email: string;
    subject: string;
    content: string;
    scheduled_at: string;
    status: "pending" | "sent" | "failed" | "cancelled";
    follow_up_type: string;
    original_email_uid?: string;
    original_email_data?: any;
    use_llm: boolean;
    purpose?: string;
    created_at: string;
    sent_at?: string;
    error_message?: string;
    automation_rule_id?: string;
}

export interface Task {
    id: string;
    title: string;
    description: string;
    status: "pending" | "in_progress" | "completed" | "cancelled";
    priority: "high" | "medium" | "low";
    due_date?: string;
    created_at: string;
    updated_at: string;
    completed_at?: string;
    assignee?: string;
    notes?: string;
    related_email_uid?: string;
    automation_rule_id?: string;
    created_by: string;
}

export interface AutomationStats {
    total_rules: number;
    active_rules: number;
    inactive_rules: number;
    total_executions: number;
    successful_executions: number;
    failed_executions: number;
    success_rate: number;
    executions_today: number;
    executions_this_week: number;
    executions_this_month: number;
    pending_follow_ups: number;
    pending_tasks: number;
    top_performing_rules: TopPerformingRule[];
}

export interface TopPerformingRule {
    id: string;
    name: string;
    execution_count: number;
    success_rate: number;
    last_triggered?: string;
}

export interface AutomationLog {
    id: string;
    rule_id: string;
    rule_name: string;
    trigger_data: any;
    action: string;
    status: "success" | "error" | "warning";
    error_message?: string;
    execution_time_ms: number;
    created_at: string;
}

// Mail Types
export interface EmailSummary {
    uid: string;
    seqno?: number;
    mailbox: string;
    mailboxName?: string;
    mailboxDomain?: string;
    folder: string;
    from: string;
    fromName?: string;
    fromAddress?: string;
    to: string;
    cc?: string;
    subject: string;
    date: string | null;
    messageId?: string;
    flags: string[];
    size: number;
    hasAttachments?: boolean;
    category?: string;
    /** 0-100, absent until the background classifier has reached the message. */
    importance?: number;
    importanceReason?: string;
    /** True when importance is at or above the configured threshold. */
    priority?: boolean;
}

export interface EmailAddress {
    text?: string;
    value?: Array<{ address?: string; name?: string }>;
}

export interface EmailDetail {
    uid: string;
    mailbox: string;
    folder: string;
    from?: EmailAddress | null;
    to?: EmailAddress | null;
    cc?: EmailAddress | null;
    subject: string;
    date: string | null;
    messageId?: string;
    html?: string | null;
    text?: string;
    flags: string[];
    attachments: EmailAttachment[];
    summary?: string;
    category?: string;
    importance?: number;
    importanceReason?: string;
}

export interface EmailAttachment {
    filename?: string;
    contentType?: string;
    size?: number;
    contentId?: string;
}

export interface MailFolder {
    name: string;
    path: string;
    displayName: string;
    delimiter: string;
    attributes: string[];
    specialUse: string | null;
    selectable: boolean;
    hasChildren: boolean;
    children: MailFolder[];
    count?: number;
    unseen?: number;
}

// Admin Types
export interface AccessibleMailbox {
    email: string;
    name: string;
    domain: string;
    quota?: number;
    active?: number;
    created?: string;
}

export interface MailboxUnreadStat {
    mailbox: string;
    name: string;
    domain?: string;
    unread: number;
    error?: string | null;
}

export interface UnifiedMailboxSummary {
    mailbox: string;
    name: string;
    domain?: string;
    total: number;
    unread: number;
    error?: string;
}

export interface AdminDashboardStats {
    totalUsers: number;
    activeUsers: number;
    inactiveUsers: number;
    totalEmails: number;
    unreadEmails: number;
    sentEmails: number;
    storageUsed: number;
    storageLimit: number;
}

export interface AdminActivity {
    id: string;
    user: string;
    action: string;
    timestamp: string;
    details: string;
}

// Provisioning Types (iRedMail vmail schema)
export interface Domain {
    domain: string;
    description: string;
    maxMailboxes: number;
    maxAliases: number;
    maxQuotaMb: number;
    defaultUserQuotaMb: number;
    active: boolean;
    created?: string;
    mailboxCount?: number;
    aliasCount?: number;
    usedQuotaMb?: number;
}

export interface DomainDetail extends Domain {
    admins: string[];
    aliasDomains: string[];
    catchAll: string[];
}

export interface ProvisionedMailbox {
    email: string;
    name: string;
    domain: string;
    quotaMb: number;
    usedMb?: number;
    active: boolean;
    isGlobalAdmin?: boolean;
    created?: string;
    firstName?: string;
    lastName?: string;
    department?: string;
    services?: string[];
}

export interface MailboxDetail extends ProvisionedMailbox {
    aliases: string[];
    forwardings: MailboxForwarding;
    adminOf: string[];
}

export interface MailboxForwarding {
    destinations: string[];
    keepCopy: boolean;
}

export interface MailAlias {
    address: string;
    name: string;
    domain: string;
    members: string[];
    active: boolean;
}

// Sieve Types
export type FilterField = "from" | "to" | "subject" | "body" | "header";
export type FilterMatch = "contains" | "is" | "matches";

export interface FilterCondition {
    field: FilterField;
    match: FilterMatch;
    value: string;
    header?: string;
    negate?: boolean;
}

export type FilterActionType =
    | "fileinto"
    | "copy"
    | "redirect"
    | "discard"
    | "reject"
    | "keep"
    | "flag"
    | "markread";

export interface FilterAction {
    type: FilterActionType;
    folder?: string;
    to?: string;
    reason?: string;
    flag?: string;
}

export interface MailFilter {
    id?: number;
    name: string;
    priority: number;
    match: "all" | "any";
    conditions: FilterCondition[];
    actions: FilterAction[];
    stopProcessing: boolean;
    active: boolean;
}

export interface VacationSettings {
    enabled: boolean;
    subject: string;
    body: string;
    startDate: string | null;
    endDate: string | null;
    intervalDays: number;
}

export interface Identity {
    id: number;
    fromAddress: string;
    displayName: string;
    signature: string;
    isDefault: boolean;
}

// AI Types
// Snake case mirrors the llm_settings columns, which the API returns as-is.
export interface LLMSettings {
    enabled: boolean;
    base_url: string;
    model: string;
    classify_enabled: boolean;
    summaries_enabled: boolean;
    replies_enabled: boolean;
    importance_threshold: number;
    snippet_chars: number;
    batch_size: number;
    daily_limit: number;
    lookback_days: number;
    custom_instructions: string | null;
    updated_at?: string;
    updated_by?: string | null;
    hasApiKey: boolean;
    apiKeyHint: string | null;
    configured: boolean;
}

export interface ClassificationWorkerStatus {
    scheduled: boolean;
    running: boolean;
    intervalMs: number;
    lastRun: string | null;
    lastError: string | null;
}

export interface LLMConnectionTest {
    ok: boolean;
    model?: string;
    latencyMs?: number;
    reply?: string;
    status?: number | null;
    error?: string;
}

export interface LLMUsageDay {
    day: string;
    feature: string;
    requests: number;
    messages: number;
    prompt_tokens: number;
    completion_tokens: number;
    errors: number;
}

export interface ClassificationStats {
    classified: number;
    important: number;
    mailboxes: number;
    last_run: string | null;
}

// Common Types
export interface User {
    id?: string;
    email: string;
    name: string;
    isAdmin: boolean;
    adminType?: "global" | "domain" | null;
    domains?: string[];
    quota?: number;
    language?: string;
    has2FA?: boolean;
    two_factor_enabled?: boolean;
    isAdminSwitch?: boolean;
    originalAdmin?: string | null;
    preferences?: Partial<UserPreferences>;
    created_at?: string;
    last_login?: string;
}

export interface UserPreferences {
    theme: "light" | "dark" | "auto";
    language: string;
    timezone: string;
    auto_refresh_interval: number;
    emails_per_page: number;
    default_folder: string;
    email_notifications: boolean;
    desktop_notifications: boolean;
    sound_notifications: boolean;
    push_notifications: boolean;
    marketing_emails: boolean;
    new_email_notifications: boolean;
    campaign_notifications: boolean;
    automation_notifications: boolean;
    security_notifications: boolean;
    system_notifications: boolean;
    notification_frequency: "immediate" | "hourly" | "daily" | "weekly";
    quiet_hours_enabled: boolean;
    quiet_hours_start: string;
    quiet_hours_end: string;
    weekend_notifications: boolean;
    digest_enabled: boolean;
    digest_frequency: "daily" | "weekly" | "monthly";
    digest_time: string;
    max_notifications_per_hour: number;
    [key: string]: unknown;
}

export interface UserQuota {
    emails_sent_today: number;
    emails_sent_this_month: number;
    daily_limit: number;
    monthly_limit: number;
    storage_used_mb: number;
    storage_limit_mb: number;
}

export interface ApiResponse<T> {
    success: boolean;
    data: T;
    message?: string;
    pagination?: {
        total: number;
        page: number;
        limit: number;
        pages: number;
    };
}

export interface PaginationParams {
    page?: number;
    limit?: number;
    offset?: number;
}

export interface FilterParams {
    search?: string;
    status?: string;
    category?: string;
    date_from?: string;
    date_to?: string;
    sort_by?: string;
    sort_order?: "asc" | "desc";
}
