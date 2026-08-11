# Pulsemail Client - Campaign Management & Automation

This document provides implementation details for the Campaign Management and Automation Rules interfaces for the Pulsemail client.

## ✅ Completed Features

### Campaign Management
- **Campaign Builder**: Multi-step campaign creation with template support
- **Campaign List**: View, edit, delete, duplicate campaigns with status filters
- **Template Gallery**: Pre-built templates and custom template creation
- **Campaign Analytics**: Performance tracking with charts and detailed metrics
- **Scheduling**: Schedule campaigns for future sending
- **Recipient Management**: Import and manage recipient lists
- **A/B Testing**: Send test campaigns before full deployment

### Automation Rules
- **Rule Builder**: Visual rule creation with triggers and actions
- **Trigger Types**:
  - Email received/sent
  - Keyword matching
  - Sender domain filtering
  - Scheduled triggers
  - Follow-up due notifications
  - Attachment detection
  - VIP sender detection
  - Bounce handling

- **Action Types**:
  - Auto-reply with AI generation
  - Email forwarding
  - Email categorization
  - Follow-up scheduling
  - Task creation
  - LLM-generated replies
  - Notifications
  - Folder management
  - Label management
  - Webhook calls

### Follow-up & Task Management
- **Follow-up Tracking**: Monitor scheduled follow-ups
- **Task Management**: Create and track automation-generated tasks
- **AI Integration**: LLM-powered content generation
- **Status Monitoring**: Track execution success/failure rates

## 🏗️ Component Architecture

### Campaign Components
```
components/campaigns/
├── CampaignList.tsx          # Main campaign listing with filters
├── CampaignModal.tsx         # Multi-step campaign creation/editing
├── CampaignAnalytics.tsx     # Performance charts and metrics
└── TemplateGallery.tsx       # Template selection and management
```

### Automation Components
```
components/automation/
├── AutomationRuleList.tsx    # Rule listing with status management
├── AutomationRuleModal.tsx   # Multi-step rule creation
└── FollowUpManager.tsx       # Follow-up and task management
```

### Common Components
```
components/common/
├── Button.tsx               # Styled button with variants
├── Input.tsx                # Form input with validation
├── Textarea.tsx             # Multi-line text input
├── Select.tsx               # Dropdown selection
├── Modal.tsx                # Modal dialog wrapper
└── Badge.tsx                # Status badges
```

## 🔧 Required Backend API Endpoints

### Campaign API (`/api/campaigns`)
```typescript
// Get campaigns with filtering
GET /api/campaigns?status=draft&limit=20&offset=0

// Get single campaign
GET /api/campaigns/:id

// Create campaign
POST /api/campaigns
{
  name: string;
  subject: string;
  content: string;
  recipients: Array<{ email: string; name?: string }>;
  scheduled_at?: string;
  template_id?: number;
}

// Update campaign
PUT /api/campaigns/:id

// Delete campaign
DELETE /api/campaigns/:id

// Send campaign
POST /api/campaigns/:id/send

// Schedule campaign
POST /api/campaigns/:id/schedule
{ scheduled_at: string }

// Get analytics
GET /api/campaigns/:id/analytics

// Duplicate campaign
POST /api/campaigns/:id/duplicate
{ name?: string }

// Test campaign
POST /api/campaigns/:id/test
{ test_emails: string[] }

// Cancel campaign
POST /api/campaigns/:id/cancel

// Import recipients
POST /api/campaigns/recipients/import
{ csv_data: string }

// Performance summary
GET /api/campaigns/performance/summary?period=30
```

### Campaign Templates API (`/api/campaigns/templates`)
```typescript
// Get templates
GET /api/campaigns/templates/list

// Create template
POST /api/campaigns/templates
{
  name: string;
  content: string;
  thumbnail?: string;
}

// Update template
PUT /api/campaigns/templates/:id

// Delete template
DELETE /api/campaigns/templates/:id
```

### Automation API (`/api/automation`)
```typescript
// Get rules
GET /api/automation/rules?active_only=true&limit=20&offset=0

// Create rule
POST /api/automation/rules
{
  name: string;
  trigger_type: string;
  trigger_conditions: object;
  actions: Array<{ type: string; config: object }>;
  active?: boolean;
}

// Update rule
PUT /api/automation/rules/:id

// Delete rule
DELETE /api/automation/rules/:id

// Toggle rule status
PATCH /api/automation/rules/:id/toggle
{ active: boolean }

// Test rule
POST /api/automation/rules/:id/test
{ test_email_data: object }

// Get automation stats
GET /api/automation/stats

// Get execution logs
GET /api/automation/logs?limit=50&offset=0&action=auto_reply
```

### Follow-ups API (`/api/automation/follow-ups`)
```typescript
// Get follow-ups
GET /api/automation/follow-ups?status=pending&limit=20&offset=0

// Schedule follow-up
POST /api/automation/follow-ups
{
  recipient_email: string;
  subject: string;
  content?: string;
  scheduled_at: string;
  follow_up_type?: string;
  original_email_data?: object;
  use_llm?: boolean;
  purpose?: string;
}

// Update follow-up
PUT /api/automation/follow-ups/:id

// Cancel follow-up
DELETE /api/automation/follow-ups/:id
```

### Tasks API (`/api/automation/tasks`)
```typescript
// Get tasks
GET /api/automation/tasks?status=pending&limit=20&offset=0

// Update task
PATCH /api/automation/tasks/:id
{
  status: string;
  notes?: string;
}

// Create task
POST /api/automation/tasks
{
  title: string;
  description: string;
  due_date?: string;
  priority?: 'high' | 'medium' | 'low';
  related_email_uid?: string;
}
```

## 📊 Database Schema Requirements

### Campaigns Table
```sql
CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    status campaign_status DEFAULT 'draft',
    recipients_count INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    opens_count INTEGER DEFAULT 0,
    clicks_count INTEGER DEFAULT 0,
    bounces_count INTEGER DEFAULT 0,
    template_id INTEGER REFERENCES campaign_templates(id),
    scheduled_at TIMESTAMP,
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE TYPE campaign_status AS ENUM (
    'draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled'
);
```

### Campaign Recipients Table
```sql
CREATE TABLE campaign_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    status recipient_status DEFAULT 'pending',
    sent_at TIMESTAMP,
    opened_at TIMESTAMP,
    clicked_at TIMESTAMP,
    bounced_at TIMESTAMP,
    bounce_reason TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TYPE recipient_status AS ENUM (
    'pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'unsubscribed'
);
```

### Campaign Templates Table
```sql
CREATE TABLE campaign_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    thumbnail TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);
```

### Automation Rules Table
```sql
CREATE TABLE automation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    trigger_type trigger_type_enum NOT NULL,
    trigger_conditions JSONB NOT NULL DEFAULT '{}',
    actions JSONB NOT NULL DEFAULT '[]',
    active BOOLEAN DEFAULT true,
    execution_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    last_triggered TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE TYPE trigger_type_enum AS ENUM (
    'email_received', 'email_sent', 'keyword_match', 'sender_domain', 
    'schedule', 'follow_up_due', 'attachment_received', 'vip_sender', 'bounced_email'
);
```

### Follow-ups Table
```sql
CREATE TABLE follow_ups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_email VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    content TEXT,
    scheduled_at TIMESTAMP NOT NULL,
    status followup_status DEFAULT 'pending',
    follow_up_type VARCHAR(100),
    original_email_uid VARCHAR(255),
    original_email_data JSONB,
    use_llm BOOLEAN DEFAULT false,
    purpose VARCHAR(255),
    automation_rule_id UUID REFERENCES automation_rules(id),
    sent_at TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TYPE followup_status AS ENUM ('pending', 'sent', 'failed', 'cancelled');
```

### Tasks Table
```sql
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status task_status DEFAULT 'pending',
    priority task_priority DEFAULT 'medium',
    due_date TIMESTAMP,
    assignee UUID REFERENCES users(id),
    notes TEXT,
    related_email_uid VARCHAR(255),
    automation_rule_id UUID REFERENCES automation_rules(id),
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high');
```

### Automation Logs Table
```sql
CREATE TABLE automation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID REFERENCES automation_rules(id),
    rule_name VARCHAR(255),
    trigger_data JSONB,
    action VARCHAR(100),
    status log_status,
    error_message TEXT,
    execution_time_ms INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TYPE log_status AS ENUM ('success', 'error', 'warning');
```

## 🚀 Setup Instructions

### 1. Install Dependencies
```bash
cd frontend
npm install
```

### 2. Environment Variables
Create a `.env` file:
```
VITE_API_URL=http://localhost:8000
VITE_APP_NAME=Pulsemail Client
```

### 3. Start Development Server
```bash
npm run dev
```

### 4. Backend Requirements
Ensure your backend implements:
- All the API endpoints listed above
- PostgreSQL database with the required schema
- Authentication middleware
- File upload handling for attachments
- Email sending capabilities (SMTP via Postfix/Dovecot)
- LLM integration for AI features

## 🎯 Integration with Existing Email Client

The components are designed to integrate seamlessly with your existing Pulsemail client:

1. **Navigation**: Already integrated in `Layout.tsx` with campaigns and automation menu items
2. **API**: Uses the existing `api.ts` service with proper error handling
3. **Authentication**: Leverages existing auth store and protected routes
4. **Styling**: Consistent with existing Tailwind CSS design system
5. **State Management**: Uses React Query for data fetching and caching

## 🔌 LLM Integration Points

### Campaign Content Generation
```typescript
// API endpoint for AI content generation
POST /api/campaigns/generate-content
{
  campaign_type: 'welcome' | 'newsletter' | 'product_announcement';
  tone: 'professional' | 'friendly' | 'formal' | 'casual';
  key_points: string[];
  target_audience: string;
}
```

### Auto-Reply Generation
```typescript
// API endpoint for reply generation
POST /api/automation/generate-reply
{
  original_email: {
    subject: string;
    content: string;
    sender: string;
  };
  reply_tone: string;
  custom_instructions?: string;
}
```

## 🔧 Customization

### Adding New Trigger Types
1. Update `TriggerType` enum in `types/index.ts`
2. Add new case in `AutomationRuleModal.tsx` trigger conditions rendering
3. Implement backend logic for the new trigger

### Adding New Action Types
1. Update `ActionType` enum in `types/index.ts`
2. Add new case in `AutomationRuleModal.tsx` action config rendering
3. Implement backend execution logic

### Styling Customization
- Modify `tailwind.config.js` for theme changes
- Update component variants in common components
- Customize colors and spacing in CSS variables

## 📈 Performance Considerations

- **Virtualization**: Large campaign/rule lists use react-window for performance
- **Pagination**: API calls include limit/offset for efficient data loading
- **Caching**: React Query provides intelligent caching and background updates
- **Code Splitting**: Components are modular for better bundle optimization
- **Debouncing**: Search inputs include debouncing to reduce API calls

## 🧪 Testing Recommendations

### Unit Tests
- Test individual components with Jest and React Testing Library
- Mock API calls using MSW (Mock Service Worker)
- Test form validation and submission flows

### Integration Tests
- Test complete campaign creation workflow
- Test automation rule execution scenarios
- Test email sending and tracking functionality

### E2E Tests
- Use Cypress or Playwright for end-to-end testing
- Test user journeys from login to campaign completion
- Test automation rule triggers and actions

This implementation provides a comprehensive, production-ready campaign management and automation system that integrates seamlessly with your existing Pulsemail client infrastructure.