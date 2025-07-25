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

-   **Pulsemail Server**: Fully configured with PostgreSQL backend
-   **Node.js**: Version 16 or higher
-   **PostgreSQL**: Access to Pulsemail's vmail database
-   **SMTP/IMAP**: Access to mail server ports
-   **SpamAssassin** (optional): For spam testing features
-   **OpenAI API Key** (optional): For AI features

## Installation

### 1. Clone and Setup

```bash
# Clone the repository
cd /opt/
git clone <repository-url> pulsemail-client
cd pulsemail-client

# Set permissions
chown -R nginx:nginx /opt/pulsemail-client  # Adjust user as needed
chmod -R 755 /opt/pulsemail-client
```

### 2. Database Setup

```bash
# Connect to PostgreSQL as the postgres user
sudo -u postgres psql

# Run the database setup script
\i /opt/pulsemail-client/database_setup.sql

# Exit PostgreSQL
\q
```

### 3. Backend Configuration

```bash
cd /opt/pulsemail-client/backend

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit the configuration file
nano .env
```

**Configure `.env` file:**

```env
# Environment
NODE_ENV=production
PORT=3001

# Database Configuration (Pulsemail PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=vmail
DB_USER=vmail
DB_PASSWORD=your_vmail_password_here

# Email Server Configuration
SMTP_HOST=localhost
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_admin@yourdomain.com
SMTP_PASS=your_admin_password

IMAP_HOST=localhost
IMAP_PORT=143
IMAP_SECURE=false

# JWT Configuration
JWT_SECRET=your_super_secret_jwt_key_minimum_32_characters
JWT_EXPIRES_IN=7d

# SpamAssassin (optional)
SPAMASSASSIN_HOST=localhost
SPAMASSASSIN_PORT=783

# OpenAI API (optional - for AI features)
OPENAI_API_KEY=your_openai_api_key_here

# Application
APP_NAME=Pulsemail Client

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info
LOG_FILE=logs/app.log
```

### 4. Frontend Configuration

```bash
cd /opt/pulsemail-client/frontend

# Install dependencies
npm install

# Build for production
npm run build
```

### 5. System Service Setup

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

### 6. Web Server Configuration

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

#### OpenAI API Setup

1. Get an API key from [OpenAI](https://platform.openai.com)
2. Add the key to your `.env` file
3. Restart the backend service

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

#### Backend Optimization

```bash
# Use PM2 for better process management
npm install -g pm2

# Create PM2 ecosystem file
cat > /opt/pulsemail-client/backend/ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'pulsemail-client',
    script: 'src/server.js',
    cwd: '/opt/pulsemail-client/backend',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production'
    }
  }]
}
EOF

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

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

### 3. Rate Limiting

The application includes built-in rate limiting, but you can add additional protection:

```nginx
# Add to Nginx configuration
http {
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/m;
    limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;
}

server {
    location /api/auth/login {
        limit_req zone=login burst=3 nodelay;
        # ... rest of configuration
    }

    location /api/ {
        limit_req zone=api burst=20 nodelay;
        # ... rest of configuration
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

2. **IMAP/SMTP Connection Issues**

    ```bash
    # Test IMAP connection
    telnet localhost 143

    # Test SMTP connection
    telnet localhost 587
    ```

3. **Frontend Build Issues**

    ```bash
    # Clear node modules and rebuild
    cd /opt/pulsemail-client/frontend
    rm -rf node_modules package-lock.json
    npm install
    npm run build
    ```

4. **Permission Issues**
    ```bash
    # Fix file permissions
    sudo chown -R nginx:nginx /opt/pulsemail-client
    sudo chmod -R 755 /opt/pulsemail-client
    ```

### Debug Mode

Enable debug mode for troubleshooting:

```bash
# Edit .env file
NODE_ENV=development
LOG_LEVEL=debug

# Restart service
sudo systemctl restart pulsemail-client
```

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

# Backup database
sudo -u postgres pg_dump vmail > $BACKUP_DIR/vmail_$DATE.sql

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
# Pull latest changes
cd /opt/pulsemail-client
git pull origin main

# Update backend
cd backend
npm install
sudo systemctl restart pulsemail-client

# Update frontend
cd ../frontend
npm install
npm run build
sudo systemctl reload nginx
```

### Getting Help

-   **Logs**: Check application and system logs for error details
-   **Documentation**: Refer to the API documentation at `/api/docs`
-   **Configuration**: Verify all environment variables are correctly set
-   **Permissions**: Ensure proper file and database permissions

This deployment guide provides a comprehensive setup for the Pulsemail Custom Client. Adjust the configuration according to your specific environment and requirements.
