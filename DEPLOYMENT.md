# Pulsemail Custom Client - Deployment Guide

A comprehensive custom email client for Pulsemail with enhanced features including AI-powered automation, email campaigns, spam testing, and 2FA support.

## Features

### 🚀 Core Features

-   **Modern UI**: React-based responsive interface with Tailwind CSS
-   **Enhanced Security**: 2FA support, app passwords, rate limiting
-   **AI Integration**: LLM-powered email replies, categorization, and content generation
-   **Email Campaigns**: Create, schedule, and track email marketing campaigns
-   **Automation**: Smart email rules with conditions and actions
-   **Spam Testing**: Built-in SpamAssassin integration for outgoing emails
-   **Analytics**: Comprehensive email statistics and performance metrics

### 📧 Email Management

-   **Smart Categories**: AI-powered email categorization (Important, Work, Personal, etc.)
-   **Advanced Search**: Full-text search with filters and date ranges
-   **Folder Management**: Support for all IMAP folders
-   **Attachment Handling**: Upload and manage email attachments
-   **Email Templates**: Reusable templates for common responses

### 🤖 Automation Features

-   **Smart Rules**: Create automation rules based on sender, content, time, etc.
-   **Auto-replies**: Generate intelligent responses using AI
-   **Follow-ups**: Schedule automated follow-up emails
-   **Task Creation**: Automatically create tasks from emails
-   **Notifications**: Real-time alerts for important emails

### 📊 Campaign Management

-   **Campaign Builder**: Visual email campaign creator
-   **Recipient Management**: Import and manage contact lists
-   **Analytics**: Track open rates, click rates, and delivery statistics
-   **A/B Testing**: Test different email variations
-   **Scheduled Sending**: Schedule campaigns for optimal delivery times

## Prerequisites

-   **iRedMail server**: fully configured with the PostgreSQL backend
-   **Node.js**: version 18 or higher
-   **PostgreSQL**: access to iRedMail's `vmail` database, plus rights to create one more database
-   **Dovecot**: IMAP, and Pigeonhole ManageSieve on port 4190 for filters and vacation replies
-   **Postfix**: submission on port 587
-   **SpamAssassin** (optional): for spam scoring of outgoing mail
-   **OpenAI API key** (optional): for AI features

### How this client talks to your mail server

Understanding this makes the rest of the guide make sense.

The client never stores or replays a user's mailbox password. After a user
authenticates against `mailbox.password` in the `vmail` database, every IMAP and
ManageSieve session is opened through a **Dovecot master user**: the client logs
in as `alice@example.com*pulsemail-master` using the master password. Dovecot
grants access to Alice's mailbox on the strength of the master credential alone.

This is also exactly what makes admin cross-mailbox access work. An admin
browsing another user's inbox is the same mechanism, authorised by
`domain_admins` rather than by knowing the target's password.

**If you skip the master user setup in step 3, nobody will be able to read mail.**

## Installation

### 0. Preflight

Before changing anything, inventory the target server. `deploy/preflight.sh` is
read-only — it writes no files, installs nothing and restarts no services — and
reports what is present, what is missing and what would block the deployment.

Run it straight over SSH without copying it to the server:

```bash
ssh user@mailserver 'sudo bash -s' < deploy/preflight.sh
```

It reports blockers as `[STOP]` and things worth reviewing as `[warn]`. The
checks that most often decide whether a deployment succeeds are whether
ManageSieve is listening on 4190, whether the password schemes in
`mailbox.password` are ones this client implements, whether port 3001 is free,
and whether anyone holds `domain='ALL'` in `domain_admins`. Run it with `sudo`;
without root the Dovecot, Postfix and database sections are largely unreadable
and the report says so rather than guessing.

### Scripted installation

For an existing iRedMail host, `deploy/install.sh` performs everything in the
manual steps below. It is additive: it does not edit `dovecot.conf`, restart
Dovecot, or touch the Roundcube, iRedAdmin or SOGo nginx blocks. The client is
installed on its own hostname, because the built frontend uses absolute asset
paths and a router without a `basename`, so it cannot be served from a subpath.

```bash
# 1. Point a DNS A record at the server first; certbot needs it to resolve.

# 2. Copy the repository up
rsync -az -e 'ssh -p 777' --exclude node_modules --exclude .git --exclude dist \
      ./ user@mailserver:/tmp/pulsemail-client/

# 3. Install
ssh -p 777 user@mailserver \
  'sudo WEBMAIL_HOST=webmail.example.com CERTBOT_EMAIL=you@example.com \
   bash /tmp/pulsemail-client/deploy/install.sh'
```

The installer generates its own secrets, creates a `pulsemail` database and
role, grants that role read/write on only the iRedMail tables the client uses,
adds a Dovecot master user, and verifies the master login before continuing. It
finishes by running `backend/scripts/verify-live.js`, which exercises IMAP and
ManageSieve against the real server — the parts no mock can prove.

Undo everything with `sudo bash deploy/rollback.sh`, or
`sudo PURGE_DATA=yes bash deploy/rollback.sh` to drop the database too.

#### If the master passdb is not already configured

`preflight.sh` reports this. iRedMail usually ships the `passdb` block and an
empty `/etc/dovecot/dovecot-master-users`, in which case the installer only
appends a line and runs `doveadm reload` — no restart, no dropped sessions. If
the block is genuinely absent, add it manually per step 3 below before running
the installer, since that does require a Dovecot restart.

### 1. Clone and set up

```bash
cd /opt/
git clone <repository-url> pulsemail-client
cd pulsemail-client

chown -R nginx:nginx /opt/pulsemail-client  # Adjust user as needed
chmod -R 755 /opt/pulsemail-client
```

### 2. Database setup

The client uses **two** databases.

`vmail` is iRedMail's. Postfix and Dovecot read it directly, so the client only
touches the documented iRedMail schema (`mailbox`, `domain`, `alias`,
`forwardings`, `domain_admins`, `used_quota`) and never creates tables there.

Everything the client owns — preferences, 2FA, app passwords, campaigns,
automation rules, mail filters, identities, the impersonation audit trail —
lives in a separate `pulsemail` database. Keeping them apart means the schema
bootstrap needs DDL rights on our database only, and an iRedMail upgrade can
never collide with our tables.

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE pulsemail WITH LOGIN PASSWORD 'choose_a_strong_password';
CREATE DATABASE pulsemail OWNER pulsemail;
SQL
```

Grant the same role read/write on the iRedMail tables the client needs. It does
not need DDL rights on `vmail`:

```bash
sudo -u postgres psql vmail <<'SQL'
GRANT CONNECT ON DATABASE vmail TO pulsemail;
GRANT USAGE ON SCHEMA public TO pulsemail;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  mailbox, domain, domain_admins, alias, alias_domain, forwardings
  TO pulsemail;
GRANT SELECT ON used_quota, last_login TO pulsemail;
SQL
```

The application's own tables are created automatically on first boot, so there
is no migration step to run.

### 3. Dovecot master user

Create the master password file. Use a long random password; it grants access
to every mailbox on the server.

```bash
MASTER_PASS=$(openssl rand -base64 32)
echo "pulsemail-master:$(doveadm pw -s SSHA512 -p "$MASTER_PASS")" \
  | sudo tee /etc/dovecot/dovecot.master.passwd
sudo chmod 600 /etc/dovecot/dovecot.master.passwd
sudo chown dovecot:dovecot /etc/dovecot/dovecot.master.passwd
echo "Master password (put this in IMAP_MASTER_PASS): $MASTER_PASS"
```

Add the master passdb to `/etc/dovecot/dovecot.conf`. It must appear **before**
the regular SQL passdb:

```
passdb {
  driver = passwd-file
  args = /etc/dovecot/dovecot.master.passwd
  master = yes
  result_success = continue
}
```

`result_success = continue` is what makes the separator login work: Dovecot
accepts the master credential and then proceeds to look up the target mailbox.

Enable ManageSieve so mail filters and vacation replies reach the server:

```
protocols = imap lmtp sieve

service managesieve-login {
  inet_listener sieve {
    port = 4190
  }
}

plugin {
  sieve = file:/var/vmail/sieve/%d/%n/scripts;active=/var/vmail/sieve/%d/%n/active.sieve
}
```

Restart and verify:

```bash
sudo systemctl restart dovecot

# Should report "OK" - proves the master login works end to end
doveadm auth login 'postmaster@yourdomain.com*pulsemail-master' "$MASTER_PASS"
```

### 4. Backend configuration

```bash
cd /opt/pulsemail-client/backend
npm ci --omit=dev
cp .env.example .env
nano .env
```

`.env.example` documents every variable inline. The settings that matter most in
production:

```env
NODE_ENV=production
PORT=3001

# iRedMail's database - no DDL rights needed here
DB_HOST=localhost
DB_NAME=vmail
DB_USER=pulsemail
DB_PASSWORD=choose_a_strong_password

# This application's own database - created on first boot
APP_DB_NAME=pulsemail
APP_DB_USER=pulsemail
APP_DB_PASSWORD=choose_a_strong_password

# Dovecot master user from step 3. Without these, no mail can be read.
IMAP_HOST=localhost
IMAP_PORT=143
IMAP_MASTER_USER=pulsemail-master
IMAP_MASTER_PASS=the_master_password_from_step_3
IMAP_MASTER_SEPARATOR=*

# ManageSieve, for filters and the vacation responder
SIEVE_HOST=localhost
SIEVE_PORT=4190

SMTP_HOST=localhost
SMTP_PORT=587
SMTP_USER=your_admin@yourdomain.com
SMTP_PASS=your_admin_password

# At least 32 characters. Generate with: openssl rand -base64 48
# Changing this invalidates every existing session.
JWT_SECRET=

# Number of reverse proxies in front of the app. Required behind nginx:
# without it the rate limiter sees every request as coming from the proxy
# and one busy user locks out everyone else.
TRUST_PROXY=1

# Leave empty when nginx serves the frontend and proxies /api from the same
# host, as configured below. No cross-origin request happens in that layout.
CORS_ORIGINS=
```

The server validates this configuration at startup and **refuses to start** in
production if the JWT secret, database password or master credentials are
missing or still hold example placeholders. A failed start prints exactly which
variable is at fault.

### 5. Frontend configuration

```bash
cd /opt/pulsemail-client/frontend
npm ci
npm run build
```

This writes `dist/`, which nginx serves directly. The production build omits
source maps. The API base URL is the relative path `/api`, so no build-time
configuration is needed as long as nginx proxies `/api` from the same host.

### 6. System service setup

Create a systemd service file:

```bash
sudo nano /etc/systemd/system/pulsemail-client.service
```

```ini
[Unit]
Description=Pulsemail Custom Client Backend
After=network.target postgresql.service

[Service]
Type=simple
User=nginx
WorkingDirectory=/opt/pulsemail-client/backend
Environment=NODE_ENV=production
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=pulsemail-client

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable pulsemail-client
sudo systemctl start pulsemail-client
sudo systemctl status pulsemail-client
```

### 7. Web server configuration

#### For Nginx

Create a virtual host configuration:

```bash
sudo nano /etc/nginx/conf.d/pulsemail-client.conf
```

```nginx
server {
    listen 80;
    server_name mail.yourdomain.com;  # Replace with your domain
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name mail.yourdomain.com;  # Replace with your domain

    # SSL configuration (use your existing certificates)
    ssl_certificate /etc/ssl/certs/yourdomain.com.crt;
    ssl_certificate_key /etc/ssl/private/yourdomain.com.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";

    # Root directory for frontend
    root /opt/pulsemail-client/frontend/dist;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;

    # Frontend routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Backend API proxy
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # Static assets caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Security - deny access to sensitive files
    location ~ /\. {
        deny all;
    }

    location ~ /(\.env|package\.json|node_modules/) {
        deny all;
    }
}
```

Test and reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Verifying the installation

Work through these in order. Each one isolates a different integration, so the
first failure tells you which component to look at.

```bash
# 1. The process starts. Configuration problems are reported here and the
#    service refuses to start rather than failing later on a user request.
sudo systemctl status pulsemail-client
sudo journalctl -u pulsemail-client -n 50

# 2. The API is up
curl -s localhost:3001/health

# 3. Authentication against the vmail database
curl -s -X POST localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@yourdomain.com","password":"your_password"}'

# 4. Reading mail through the Dovecot master user. Save the token from step 3.
TOKEN=... # the "token" field from step 3
curl -s localhost:3001/api/emails?limit=5 -H "Authorization: Bearer $TOKEN"

# 5. Admin cross-mailbox access, if you logged in as a domain admin
curl -s localhost:3001/api/emails?limit=5 \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Mailbox: someone-else@yourdomain.com"

# 6. ManageSieve. Should return an empty list rather than an error.
curl -s localhost:3001/api/mailbox/filters -H "Authorization: Bearer $TOKEN"
```

Step 4 failing while step 3 succeeds almost always means the Dovecot master user
is misconfigured; recheck `doveadm auth login` from step 3 of the installation.

## Configuration

### 1. Admin User Setup

Create the first admin user in the Pulsemail admin panel or directly in the database, then access the application at `https://mail.yourdomain.com` and login with your email credentials.

### 2. Email Server Integration

The application integrates directly with your existing Pulsemail setup:

-   **SMTP**: Uses your Postfix configuration for sending emails
-   **IMAP**: Connects to Dovecot for reading emails
-   **Database**: Uses the existing vmail PostgreSQL database
-   **Authentication**: Uses Pulsemail's user authentication system

### 3. Optional Features Configuration

#### SpamAssassin Integration

```bash
# Install SpamAssassin if not already installed
sudo yum install spamassassin  # RHEL/CentOS
sudo apt install spamassassin  # Debian/Ubuntu

# Start SpamAssassin daemon
sudo systemctl enable spamassassin
sudo systemctl start spamassassin
```

#### AI importance sorting

Scores incoming mail so users get a **Priority** view in the inbox. Configured
entirely from the admin panel under **Administration → AI Sorting**; nothing
needs to go in `.env` and no restart is required.

1. Sign in as a global admin and open **AI Sorting**.
2. Pick a preset or enter any endpoint that speaks the OpenAI chat-completions
   API. That covers OpenAI, Azure OpenAI, OpenRouter, Groq and Together, as
   well as a model you host yourself with Ollama or vLLM.
3. Enter the API key if the endpoint needs one, then use **Test connection**
   before saving. The key is encrypted at rest and never returned to the
   browser afterwards.
4. Turn on **Enable AI features** and **Importance sorting**, then **Save**.

Classification runs in a background job on a five-minute timer, never inside a
user request, so an unreachable or slow endpoint cannot delay the inbox. Its
cost is bounded by the daily message cap and by how far back it looks, both set
on the same page. **Run now** triggers a pass immediately.

Three settings are worth deliberate choices:

-   **Priority threshold** — the score at which mail enters the Priority view.
    Start at 70 and lower it if too little is being promoted.
-   **Body characters sent** — how much of each message reaches the endpoint.
    Set this to `0` to send only sender and subject, which keeps message bodies
    on your server at some cost in accuracy.
-   **Daily message cap** — an upper bound on spend across the whole server.

If mail must not leave the machine at all, point the base URL at a locally
hosted model; the request path is identical.

Set `SECRET_ENCRYPTION_KEY` in `.env` before configuring the endpoint. Without
it the API key is encrypted using `JWT_SECRET`, which means rotating that
secret silently invalidates the stored key and an admin has to re-enter it.

Summaries and suggested replies are separate switches on the same page. Both
are off by default because summaries add an LLM round trip to every message
that is opened.

## Replacing RoundCube

### 1. Backup Current Setup

```bash
# Backup RoundCube configuration
sudo cp -r /opt/www/roundcubemail /opt/www/roundcubemail.backup

# Backup database (if using separate RoundCube database)
sudo -u postgres pg_dump roundcubemail > roundcube_backup.sql
```

### 2. Update Web Server Configuration

Modify your existing mail server configuration to point to the new client instead of RoundCube:

```nginx
# Replace the existing RoundCube location block with:
location /mail/ {
    alias /opt/pulsemail-client/frontend/dist/;
    try_files $uri $uri/ /index.html;
}

# Keep the API proxy configuration
location /mail/api/ {
    proxy_pass http://localhost:3001/api/;
    # ... proxy configuration
}
```

### 3. Update Pulsemail Admin

Update the webmail URL in Pulsemail Admin panel:

-   Login to Pulsemail Admin
-   Go to System Settings
-   Update the webmail URL to point to your new client

## Monitoring and Maintenance

### 1. Log Files

Monitor application logs:

```bash
# Backend logs
sudo journalctl -u pulsemail-client -f

# Nginx access logs
sudo tail -f /var/log/nginx/access.log

# Application logs (if configured)
sudo tail -f /opt/pulsemail-client/backend/logs/app.log
```

### 2. Database Maintenance

```bash
# Regular database maintenance
sudo -u postgres psql vmail -c "VACUUM ANALYZE;"

# Monitor database size
sudo -u postgres psql vmail -c "
  SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
"
```

### 3. Performance Optimization

#### Backend process management

The systemd unit above is sufficient for most installations. If you prefer PM2:

```bash
npm install -g pm2

cat > /opt/pulsemail-client/backend/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'pulsemail-client',
    script: 'src/server.js',
    cwd: '/opt/pulsemail-client/backend',
    instances: 1,
    exec_mode: 'fork',
    env: { NODE_ENV: 'production' }
  }]
}
EOF

pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

**Do not run this in cluster mode.** The automation scheduler and follow-up
cron jobs are per-process, so every extra worker fires every scheduled rule
again — users would receive duplicate auto-replies and follow-ups. The
in-memory rate limiter is also per-process, so limits would be multiplied by the
worker count. Scale by giving the single process more memory rather than by
adding workers; the workload is I/O-bound on IMAP, not CPU-bound.

#### Database Optimization

Add to PostgreSQL configuration (`/var/lib/pgsql/data/postgresql.conf`):

```ini
# Optimize for email workload
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 16MB
maintenance_work_mem = 256MB
max_connections = 200
```

## Security Considerations

### 1. Firewall Configuration

```bash
# Allow necessary ports
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --permanent --add-port=3001/tcp  # Only if needed for direct access
sudo firewall-cmd --reload
```

### 2. SSL/TLS Configuration

Ensure you're using strong SSL configuration:

```nginx
# In your Nginx configuration
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-CHACHA20-POLY1305;
ssl_prefer_server_ciphers off;
ssl_dhparam /etc/ssl/dhparam.pem;  # Generate with: openssl dhparam -out /etc/ssl/dhparam.pem 2048
```

### 3. Rate limiting

The application limits requests per authenticated mailbox, falling back to the
client address for unauthenticated requests. Defaults are in `.env.example`.

Set `TRUST_PROXY=1` or the limiter cannot see real client addresses and applies
one shared budget to your entire user base.

If you add nginx-level limits as well, keep them generous. A webmail client
issues one request per folder listing plus one per message opened, so a limit
tuned for a typical REST API will break normal reading:

```nginx
http {
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;
}

server {
    location /api/auth/login {
        limit_req zone=login burst=5 nodelay;
    }

    location /api/ {
        limit_req zone=api burst=50 nodelay;
    }
}
```

## Troubleshooting

### Common Issues

1. **Database Connection Errors**

    ```bash
    # Check PostgreSQL status
    sudo systemctl status postgresql

    # Check database connectivity
    sudo -u postgres psql vmail -c "SELECT version();"
    ```

2. **Login works but no mail appears**

    Almost always the Dovecot master user. Test it directly:

    ```bash
    doveadm auth login 'user@yourdomain.com*pulsemail-master' 'master_password'
    ```

    If that fails, check that the master `passdb` block appears *before* the SQL
    `passdb` in `dovecot.conf`, that it sets `result_success = continue`, and
    that `IMAP_MASTER_SEPARATOR` in `.env` matches Dovecot's
    `auth_master_user_separator` (both default to `*`).

3. **Filters and vacation replies do not take effect**

    ManageSieve is not reachable. Confirm the service is listening and that
    `sieve` is in the `protocols` line:

    ```bash
    ss -lntp | grep 4190
    doveconf -n | grep -A5 managesieve
    ```

4. **Everyone is rate limited at once**

    `TRUST_PROXY` is unset, so every request appears to come from nginx. Set
    `TRUST_PROXY=1` and restart.

5. **IMAP/SMTP connection issues**

    ```bash
    # Test IMAP connection
    telnet localhost 143

    # Test SMTP connection
    telnet localhost 587
    ```

6. **Frontend build issues**

    ```bash
    cd /opt/pulsemail-client/frontend
    rm -rf node_modules
    npm ci
    npm run build
    ```

    Keep `package-lock.json`; deleting it defeats the point of `npm ci` and can
    pull in versions that were never tested together.

7. **Permission issues**

    ```bash
    sudo chown -R nginx:nginx /opt/pulsemail-client
    sudo chmod -R 755 /opt/pulsemail-client
    ```

### Debugging

The service logs to the journal, so `journalctl -u pulsemail-client -f` is the
main tool. Two extra switches are available in `.env`:

```env
# Log every SQL statement with its duration and row count. Very noisy.
DB_DEBUG=true
```

Leaving `NODE_ENV=production` while debugging is deliberate: switching to
`development` skips input validation and changes error responses, so problems
you see there may not reflect production behaviour.

## Backup and Recovery

### 1. Database Backup

```bash
#!/bin/bash
# Create backup script
cat > /opt/scripts/backup-pulsemail-client.sh << EOF
#!/bin/bash
BACKUP_DIR="/opt/backups"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup both databases: iRedMail's, and this application's
sudo -u postgres pg_dump vmail > $BACKUP_DIR/vmail_$DATE.sql
sudo -u postgres pg_dump pulsemail > $BACKUP_DIR/pulsemail_$DATE.sql

# Backup application files
tar -czf $BACKUP_DIR/pulsemail-client_$DATE.tar.gz /opt/pulsemail-client

# Clean old backups (keep 7 days)
find $BACKUP_DIR -name "*.sql" -mtime +7 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete
EOF

chmod +x /opt/scripts/backup-pulsemail-client.sh

# Add to crontab for daily backups
echo "0 2 * * * /opt/scripts/backup-pulsemail-client.sh" | sudo crontab -
```

### 2. Application Recovery

```bash
# Restore from backup
sudo systemctl stop pulsemail-client
cd /opt
sudo tar -xzf /opt/backups/pulsemail-client_YYYYMMDD_HHMMSS.tar.gz
sudo systemctl start pulsemail-client
```

## Support and Updates

### Updating the Application

```bash
cd /opt/pulsemail-client
git pull origin main

cd backend
npm ci --omit=dev
sudo systemctl restart pulsemail-client

cd ../frontend
npm ci
npm run build
sudo systemctl reload nginx
```

New application tables are created automatically on restart, so there is no
separate migration step. Watch `journalctl -u pulsemail-client -n 30` after the
restart: a configuration variable added by an update will stop the service with
an explicit message rather than letting it run half-configured.

### Getting Help

-   **Logs**: Check application and system logs for error details
-   **Documentation**: Refer to the API documentation at `/api/docs`
-   **Configuration**: Verify all environment variables are correctly set
-   **Permissions**: Ensure proper file and database permissions

This deployment guide provides a comprehensive setup for the Pulsemail Custom Client. Adjust the configuration according to your specific environment and requirements.
