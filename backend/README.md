# Mock Data System for Development

This document explains how to use the file-based mock data system for development without requiring a real PostgreSQL database or email servers.

## 🚀 Quick Start

### 1. Enable Mock Data Mode

Set the environment variable in your `.env` file:

```env
NODE_ENV=development
USE_MOCK_DATA=true
```

### 2. Start the Server

```bash
cd backend
npm install
npm run dev
```

The server will now use file-based mock data instead of PostgreSQL!

## 📁 How It Works

The mock data system uses JSON files stored in `backend/data/` to simulate:

-   **Users** (`users.json`) - User accounts and authentication
-   **Emails** (`emails.json`) - Incoming emails with content
-   **Campaigns** (`campaigns.json`) - Email marketing campaigns
-   **Automation** (`automation.json`) - Automation rules
-   **Preferences** (`preferences.json`) - User preferences
-   **Categories** (`categories.json`) - Email categorization
-   **Folders** (`folders.json`) - Email folders
-   **Sent Emails** (`sent_emails.json`) - Outgoing email logs

## 🔧 Mock Data Management

### Using the Management Script

```bash
# Show help
node scripts/mock-data.js help

# Reset to default data
node scripts/mock-data.js reset

# Export current data
node scripts/mock-data.js export my-backup.json

# Import data from file
node scripts/mock-data.js import my-backup.json

# Add a new mock email
node scripts/mock-data.js add-email "Test Subject" "sender@example.com"

# List emails for a user
node scripts/mock-data.js list-emails test@localhost

# Show email statistics
node scripts/mock-data.js stats test@localhost
```

### Default Test Data

The system comes with pre-configured test data:

**Users:**

-   `test@localhost` (password: `test`)
-   `admin@localhost` (password: `admin`)

**Sample Emails:**

-   Welcome emails
-   Newsletters
-   Support tickets
-   Personal messages
-   Urgent notifications

**Sample Campaigns:**

-   Welcome campaign (draft)
-   Product launch (sent)

## 📧 Mock Email Features

### Email Content Generation

The mock system automatically generates realistic email content based on the subject:

-   **Welcome emails** - Professional welcome messages
-   **Newsletters** - Weekly update templates
-   **Support tickets** - Resolution notifications
-   **Personal messages** - Friendly conversations
-   **Urgent messages** - High-priority notifications

### Email Operations

All email operations work with mock data:

-   ✅ **Get emails** - Retrieve emails with pagination
-   ✅ **Get email content** - Full email content with HTML/text
-   ✅ **Mark as read/unread** - Update email flags
-   ✅ **Search emails** - Search by subject, sender, or content
-   ✅ **Delete emails** - Remove emails from mock storage
-   ✅ **Move emails** - Move between folders
-   ✅ **Send emails** - Simulate email sending

### Email Categories

Emails are automatically categorized:

-   **work** - Business communications
-   **personal** - Personal messages
-   **promotional** - Marketing emails
-   **automated** - System notifications
-   **important** - Urgent messages
-   **spam** - Unwanted content

## 🗄️ Mock Database Features

### Database Operations

The mock database supports all common operations:

-   ✅ **SELECT** - Query data with filters
-   ✅ **INSERT** - Add new records
-   ✅ **UPDATE** - Modify existing records
-   ✅ **DELETE** - Remove records

### Supported Tables

-   `mailbox` - User accounts
-   `email_categories` - Email categorization
-   `email_campaigns` - Marketing campaigns
-   `sent_emails` - Outgoing email logs
-   `user_reply_preferences` - User preferences
-   `llm_reply_log` - AI reply logs

## 🔄 Switching Between Mock and Real Data

### Enable Mock Data (Development)

```env
NODE_ENV=development
USE_MOCK_DATA=true
```

### Use Real Database (Production)

```env
NODE_ENV=production
USE_MOCK_DATA=false
# Configure real database credentials
DB_HOST=your-db-host
DB_USER=your-db-user
DB_PASSWORD=your-db-password
```

## 🔑 Dovecot Master User (Required for Real Mail)

When mock mode is off, all IMAP access goes through a single **Dovecot master
user** instead of per-mailbox passwords. The client connects as
`<mailbox><separator><master user>` with the master password, so it can open any
mailbox without knowing the owner's password. This is what makes the admin
mailbox switcher and the unified all-inboxes view possible.

### 1. Create the master password file

```bash
# Generate a strong password hash
doveadm pw -s SSHA512 -u pulsemail-master

# Store it (one line: user:hash)
sudo tee /etc/dovecot/dovecot-master-users <<'EOF'
pulsemail-master:{SSHA512}...paste-the-hash-here...
EOF

sudo chown root:dovecot /etc/dovecot/dovecot-master-users
sudo chmod 640 /etc/dovecot/dovecot-master-users
```

### 2. Register the master passdb in `dovecot.conf`

```
# Master users may log in as any mailbox using user*master syntax
auth_master_user_separator = *

passdb {
  driver = passwd-file
  args = /etc/dovecot/dovecot-master-users
  master = yes
  result_success = continue-ok
}
```

Place this block **before** the regular `passdb` entries, then reload:

```bash
sudo doveadm reload
```

### 3. Configure the backend

```env
IMAP_HOST=mail.example.com
IMAP_PORT=993
IMAP_SECURE=true
IMAP_MASTER_USER=pulsemail-master
IMAP_MASTER_PASS=the-plaintext-master-password
IMAP_MASTER_SEPARATOR=*

# Connection pool caps (the unified inbox fans out across mailboxes)
IMAP_MAX_CONNECTIONS=10
IMAP_IDLE_TTL_MS=30000
```

### 4. Verify

```bash
# Should open the target user's INBOX using the master credentials
doveadm -f table mailbox status -u user@example.com messages INBOX
```

### Security notes

-   `IMAP_MASTER_PASS` is a high-privilege credential. Keep it in the environment
    only; it is never sent to the browser.
-   Every cross-mailbox access is recorded in `admin_mailbox_switches` with the
    acting admin, the target mailbox, and the caller's IP.
-   Restrict the master user to the application host with a Dovecot
    `remote { }` block if the backend runs on a separate machine.

### Connection pooling

`src/services/ImapConnection.js` maintains a per-mailbox pool. Idle sockets are
reused for `IMAP_IDLE_TTL_MS` and a counting semaphore caps total concurrent
connections at `IMAP_MAX_CONNECTIONS`, so a unified-inbox request across many
mailboxes cannot exhaust Dovecot's connection limit.

## 📊 Data Persistence

### File Storage

Mock data is stored in JSON files in `backend/data/`:

```
backend/data/
├── users.json
├── emails.json
├── campaigns.json
├── automation.json
├── preferences.json
├── categories.json
├── folders.json
└── sent_emails.json
```

### Data Backup

You can export and import your mock data:

```bash
# Export current data
node scripts/mock-data.js export my-data.json

# Import data later
node scripts/mock-data.js import my-data.json
```

## 🧪 Testing with Mock Data

### Adding Test Emails

```bash
# Add a test email
node scripts/mock-data.js add-email "Meeting Tomorrow" "colleague@company.com"

# Add multiple emails
node scripts/mock-data.js add-email "Project Update" "manager@company.com"
node scripts/mock-data.js add-email "Lunch Invitation" "friend@personal.com"
```

### Viewing Data

```bash
# List all emails for test user
node scripts/mock-data.js list-emails test@localhost

# Check email statistics
node scripts/mock-data.js stats test@localhost
```

### Resetting Data

```bash
# Reset to default test data
node scripts/mock-data.js reset
```

## 🔍 Debugging

### Logs

The mock system provides detailed logs:

```
📁 Using mock database for development
📧 Using mock email service for development
🔍 Mock Query: SELECT * FROM mailbox WHERE username = $1...
📝 Params: ['test@localhost']
📤 Mock sending email: { from: 'test@localhost', to: 'recipient@example.com', subject: 'Test' }
```

### Data Inspection

You can inspect the JSON files directly:

```bash
# View users
cat backend/data/users.json

# View emails
cat backend/data/emails.json
```

## 🚀 Benefits

### Development Speed

-   ✅ **No database setup** - Works immediately
-   ✅ **No email server** - No SMTP/IMAP configuration
-   ✅ **Consistent data** - Predictable test environment
-   ✅ **Fast startup** - No connection delays

### Testing

-   ✅ **Isolated environment** - No external dependencies
-   ✅ **Controllable data** - Easy to create test scenarios
-   ✅ **Repeatable tests** - Reset to known state
-   ✅ **No side effects** - Safe to experiment

### Collaboration

-   ✅ **Shared test data** - Team can use same mock data
-   ✅ **Version controlled** - Mock data can be committed
-   ✅ **Easy sharing** - Export/import functionality
-   ✅ **Consistent experience** - Same data across environments

## 🔧 Customization

### Adding Custom Mock Data

You can modify the default data in `src/config/mockData.js`:

```javascript
getDefaultEmails() {
  return [
    {
      uid: '1',
      from: 'custom@example.com',
      to: 'test@localhost',
      subject: 'Custom Email',
      // ... more properties
    }
  ];
}
```

### Custom Email Templates

Add custom email content templates in `src/services/MockEmailService.js`:

```javascript
generateMockEmailContent(subject, from) {
  const templates = {
    'custom': `
      <h1>Custom Template</h1>
      <p>Your custom content here...</p>
    `
  };
  // ... implementation
}
```

## 🚨 Limitations

### Mock Data Limitations

-   ❌ **No real email sending** - Emails are simulated
-   ❌ **No real database features** - Limited SQL support
-   ❌ **No concurrent access** - Single file storage
-   ❌ **No transactions** - No rollback support

### When to Use Real Data

Switch to real database when testing:

-   Database-specific features
-   Performance testing
-   Integration testing
-   Production-like scenarios

## 📚 API Compatibility

The mock system maintains full API compatibility:

-   ✅ **Same endpoints** - All routes work identically
-   ✅ **Same responses** - JSON structure matches real API
-   ✅ **Same authentication** - JWT tokens work
-   ✅ **Same error handling** - Error responses match

## 🎯 Best Practices

### Development Workflow

1. **Start with mock data** - Quick setup for development
2. **Use management script** - Easy data manipulation
3. **Export important data** - Backup custom test data
4. **Switch to real data** - For integration testing

### Data Management

1. **Reset frequently** - Keep data clean
2. **Use meaningful test data** - Realistic scenarios
3. **Document custom data** - Share with team
4. **Version control exports** - Track data changes

## 🆘 Troubleshooting

### Common Issues

**Server won't start:**

```bash
# Check environment variables
cat .env | grep USE_MOCK_DATA

# Reset mock data
node scripts/mock-data.js reset
```

**No emails showing:**

```bash
# Check if emails exist
node scripts/mock-data.js list-emails test@localhost

# Add test emails
node scripts/mock-data.js add-email "Test" "sender@example.com"
```

**Data not persisting:**

```bash
# Check data directory
ls -la backend/data/

# Export current data
node scripts/mock-data.js export backup.json
```

The mock data system provides a powerful development environment that eliminates the need for complex infrastructure setup while maintaining full API compatibility.
