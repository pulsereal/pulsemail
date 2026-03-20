# Pulsemail Custom Client

A comprehensive, modern email client built specifically for Pulsemail with enhanced features including AI-powered automation, email campaigns, spam testing, and advanced security.

## 🌟 Features

### 📧 Enhanced Email Management

-   **Modern Interface**: Responsive React-based UI with intuitive design
-   **Smart Categories**: AI-powered automatic email categorization
-   **Advanced Search**: Full-text search with filters and date ranges
-   **Folder Support**: Complete IMAP folder management
-   **Attachment Handling**: Secure file upload and management

### 🤖 AI-Powered Features

-   **Smart Replies**: Generate intelligent email responses using LLM
-   **Auto-Categorization**: Automatically categorize emails (Important, Work, Personal, etc.)
-   **Content Analysis**: AI-powered email content analysis and summarization
-   **Sentiment Detection**: Understand email tone and urgency

### 🚀 Email Campaigns

-   **Campaign Builder**: Visual email campaign creator with templates
-   **Contact Management**: Import and organize recipient lists
-   **Scheduling**: Schedule campaigns for optimal delivery times
-   **Analytics**: Track open rates, click rates, and delivery statistics
-   **A/B Testing**: Test different email variations

### ⚡ Automation & Rules

-   **Smart Rules**: Create automation based on sender, content, time, etc.
-   **Auto-Replies**: Intelligent automated responses
-   **Follow-ups**: Schedule automated follow-up sequences
-   **Task Creation**: Generate tasks from emails automatically
-   **Conditional Logic**: Complex rule conditions and actions

### 🔒 Enhanced Security

-   **Two-Factor Authentication**: TOTP-based 2FA support
-   **App Passwords**: Generate secure application-specific passwords
-   **Rate Limiting**: Built-in protection against abuse
-   **Secure Headers**: Comprehensive security headers
-   **Audit Logging**: Complete activity logging

### 🛡️ Spam Protection

-   **SpamAssassin Integration**: Real-time spam testing for outgoing emails
-   **Reputation Checking**: Domain and IP reputation verification
-   **Content Analysis**: Heuristic spam detection
-   **Recommendations**: Actionable suggestions to improve deliverability

### 📊 Analytics & Reporting

-   **Dashboard**: Comprehensive email statistics
-   **Performance Metrics**: Email activity and engagement analytics
-   **Campaign Reports**: Detailed campaign performance analysis
-   **Automation Insights**: Rule execution statistics

## 🏗️ Architecture

### Backend (Node.js + Express)

-   **RESTful API**: Comprehensive API for all functionality
-   **PostgreSQL Integration**: Direct integration with Pulsemail database
-   **IMAP/SMTP**: Native email protocol support
-   **Background Processing**: Scheduled tasks and automation
-   **Security Middleware**: Authentication, rate limiting, validation

### Frontend (React + TypeScript)

-   **Modern UI**: Built with React 18 and TypeScript
-   **State Management**: Zustand for efficient state handling
-   **Styling**: Tailwind CSS for responsive design
-   **Charts**: Chart.js integration for analytics
-   **Real-time Updates**: React Query for data synchronization

### Database Schema

-   **Extended Pulsemail**: Builds upon existing Pulsemail PostgreSQL schema
-   **Feature Tables**: Additional tables for campaigns, automation, analytics
-   **Indexing**: Optimized indexes for performance
-   **JSONB Support**: Flexible data storage for complex configurations

## 📦 Installation

### Prerequisites

-   Pulsemail server with PostgreSQL backend
-   Node.js 16+ and npm
-   Nginx or Apache web server
-   SpamAssassin (optional, for spam testing)
-   OpenAI API key (optional, for AI features)

### Quick Setup

1. **Clone the repository**

    ```bash
    git clone <repository-url> /opt/pulsemail-client
    cd /opt/pulsemail-client
    ```

2. **Setup database**

    ```bash
    sudo -u postgres psql -f database_setup.sql
    ```

3. **Configure backend**

    ```bash
    cd backend
    npm install
    cp .env.example .env
    # Edit .env with your configuration
    npm start
    ```

4. **Build frontend**

    ```bash
    cd frontend
    npm install
    npm run build
    ```

5. **Configure web server**
    - See `DEPLOYMENT.md` for detailed Nginx/Apache configuration

## 🔧 Configuration

### Environment Variables

**Backend (.env)**

```env
# Database
DB_HOST=localhost
DB_NAME=vmail
DB_USER=vmail
DB_PASSWORD=your_password

# Email Server
SMTP_HOST=localhost
SMTP_PORT=587
IMAP_HOST=localhost
IMAP_PORT=143

# Security
JWT_SECRET=your_jwt_secret
OPENAI_API_KEY=your_openai_key

# Features
SPAMASSASSIN_HOST=localhost
SPAMASSASSIN_PORT=783
```

### Database Integration

The application extends the existing Pulsemail PostgreSQL schema:

-   **Preserves**: All existing Pulsemail tables and data
-   **Extends**: Adds new tables for enhanced features
-   **Compatible**: Works alongside existing Pulsemail components

### Authentication

Uses Pulsemail's existing authentication system:

-   **User Accounts**: Same as Pulsemail mailbox accounts
-   **Passwords**: Compatible with all Pulsemail password schemes
-   **Domains**: Supports all configured domains
-   **Aliases**: Full alias support

## 🚀 Usage

### Basic Email Operations

```javascript
// Send email with spam testing
const response = await emailAPI.sendEmail({
    to: "user@example.com",
    subject: "Hello World",
    content: "<p>Email content</p>",
    test_spam: true,
});

// Generate AI reply
const reply = await emailAPI.generateReply(emailUid, {
    tone: "professional",
    language: "en",
});
```

### Campaign Management

```javascript
// Create campaign
const campaign = await campaignAPI.createCampaign({
    name: "Newsletter",
    subject: "Monthly Update",
    content: "<h1>Newsletter Content</h1>",
    recipients: [
        { email: "user1@example.com", name: "User 1" },
        { email: "user2@example.com", name: "User 2" },
    ],
});

// Send campaign
await campaignAPI.sendCampaign(campaign.id);
```

### Automation Rules

```javascript
// Create automation rule
const rule = await automationAPI.createRule({
    name: "Auto-reply for support",
    trigger_type: "email_received",
    trigger_conditions: {
        sender: { domain: "customer.com" },
    },
    actions: [
        {
            type: "auto_reply",
            use_llm: true,
            tone: "helpful",
        },
    ],
});
```

## 🔌 API Documentation

### Authentication Endpoints

-   `POST /api/auth/login` - User login with 2FA support
-   `POST /api/auth/refresh` - Refresh JWT token
-   `GET /api/auth/me` - Get current user info
-   `POST /api/auth/2fa/setup` - Setup 2FA
-   `GET /api/auth/app-passwords` - Get app passwords

### Email Endpoints

-   `GET /api/emails` - Get emails with filtering
-   `POST /api/emails/send` - Send email with spam testing
-   `POST /api/emails/:uid/reply` - Generate AI reply
-   `POST /api/emails/test-spam` - Test content for spam
-   `GET /api/emails/stats/dashboard` - Get email statistics

### Campaign Endpoints

-   `GET /api/campaigns` - Get campaigns
-   `POST /api/campaigns` - Create campaign
-   `POST /api/campaigns/:id/send` - Send campaign
-   `GET /api/campaigns/:id/analytics` - Get analytics
-   `POST /api/campaigns/:id/test` - Send test emails

### Automation Endpoints

-   `GET /api/automation/rules` - Get automation rules
-   `POST /api/automation/rules` - Create rule
-   `POST /api/automation/follow-ups` - Schedule follow-up
-   `GET /api/automation/stats` - Get automation statistics

Full API documentation available at `/api/docs` when running.

## 🛠️ Development

### Backend Development

```bash
cd backend
npm install
npm run dev  # Starts with nodemon
```

### Frontend Development

```bash
cd frontend
npm install
npm run dev  # Starts Vite dev server
```

### Project Structure

```
pulsemail-client/
├── backend/
│   ├── src/
│   │   ├── routes/          # API routes
│   │   ├── models/          # Database models
│   │   ├── services/        # Business logic
│   │   ├── middleware/      # Express middleware
│   │   └── utils/           # Utility functions
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/      # React components
│   │   ├── pages/          # Page components
│   │   ├── services/       # API services
│   │   ├── stores/         # State management
│   │   └── utils/          # Utility functions
│   └── package.json
├── database_setup.sql       # Database schema
└── DEPLOYMENT.md           # Deployment guide
```

## 🔍 Monitoring

### Health Checks

```bash
# Check API health
curl http://localhost:3001/health

# Check service status
systemctl status pulsemail-client

# Monitor logs
journalctl -u pulsemail-client -f
```

### Performance Metrics

The application provides built-in metrics:

-   **Email Statistics**: Sent/received counts, response times
-   **Campaign Analytics**: Delivery rates, engagement metrics
-   **Automation Performance**: Rule execution statistics
-   **System Health**: Database connections, memory usage

## 🔒 Security

### Built-in Security Features

-   **JWT Authentication**: Secure token-based authentication
-   **Rate Limiting**: Protection against abuse and DoS
-   **Input Validation**: Comprehensive request validation
-   **SQL Injection Protection**: Parameterized queries
-   **XSS Prevention**: Content sanitization
-   **CSRF Protection**: Token-based CSRF protection

### Security Headers

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000
Content-Security-Policy: default-src 'self'
```

### Audit Logging

All significant actions are logged:

-   **Authentication**: Login attempts, 2FA usage
-   **Email Operations**: Send/receive activities
-   **Automation**: Rule executions and modifications
-   **Campaign Activities**: Campaign sends and analytics

## 🤝 Contributing

### Development Setup

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

### Code Style

-   **Backend**: ESLint + Prettier
-   **Frontend**: ESLint + Prettier + TypeScript
-   **Database**: PostgreSQL best practices
-   **Documentation**: Markdown with clear examples

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

### Getting Help

-   **Documentation**: Check `DEPLOYMENT.md` for detailed setup
-   **API Docs**: Available at `/api/docs` endpoint
-   **Logs**: Monitor application logs for troubleshooting
-   **Issues**: Create GitHub issues for bugs and feature requests

### Common Issues

1. **Database Connection**: Verify PostgreSQL credentials and network access
2. **IMAP/SMTP Errors**: Check email server configuration and ports
3. **Permission Issues**: Ensure proper file and directory permissions
4. **Build Failures**: Clear node_modules and reinstall dependencies

### Requirements

-   **Server**: Linux-based server with Pulsemail
-   **Memory**: Minimum 2GB RAM (4GB recommended)
-   **Storage**: 10GB available space
-   **Network**: HTTPS access for security features

---

## Partners



**Built with ❤️ for the Pulsemail community**

This custom client enhances your Pulsemail experience with modern features while maintaining compatibility with your existing setup. Perfect for organizations looking to upgrade their email interface without changing their underlying infrastructure.
