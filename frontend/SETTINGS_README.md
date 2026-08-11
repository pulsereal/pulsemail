# Settings & Preferences Interface

This document provides implementation details for the comprehensive Settings page with user preferences, 2FA setup, app passwords, notifications, and security features for the Pulsemail client.

## ✅ Completed Features

### User Preferences (`UserPreferences.tsx`)
- **Personal Information**: Name and email management
- **Localization**: Language and timezone selection (9 languages, 12 timezones)
- **Appearance**: Theme selection (Light/Dark/Auto)
- **Email Preferences**: Pagination, refresh intervals, default folder
- **Notification Controls**: Granular notification settings
- **Real-time Updates**: Instant preference saving with validation

### Two-Factor Authentication (`TwoFactorAuth.tsx`)
- **QR Code Setup**: Visual QR code generation for authenticator apps
- **Manual Secret Entry**: Alternative setup method
- **Verification Process**: Multi-step setup wizard
- **Backup Codes**: Generation and download of recovery codes
- **Disable 2FA**: Secure disable process with password confirmation
- **Status Indicators**: Clear visual status of 2FA protection

### App Passwords (`AppPasswords.tsx`)
- **Password Generation**: Secure app-specific password creation
- **Device Management**: Named passwords for different devices/apps
- **Usage Tracking**: Last used timestamps and activity monitoring
- **Security Features**: One-time display, copy to clipboard
- **Bulk Management**: Easy deletion and management of multiple passwords
- **Setup Instructions**: Built-in guidance for email client configuration

### Notification Settings (`NotificationSettings.tsx`)
- **Multi-Channel Notifications**: Email, desktop, browser, sound
- **Granular Categories**: New emails, campaigns, automation, security alerts
- **Timing Controls**: Immediate, hourly, daily, weekly digests
- **Quiet Hours**: Customizable do-not-disturb periods
- **Sound Settings**: Volume control and sound selection
- **Browser Integration**: Native notification permission handling
- **Email Digests**: Configurable summary emails

### Security Settings (`SecuritySettings.tsx`)
- **Password Management**: Secure password change with validation
- **Security Status**: Visual security score and recommendations
- **Activity Monitoring**: Recent security events and login history
- **Password Strength**: Real-time validation with requirements
- **Security Recommendations**: Contextual security improvement tips

## 🏗️ Component Architecture

### Settings Components
```
components/settings/
├── UserPreferences.tsx       # Profile and general preferences
├── TwoFactorAuth.tsx         # 2FA setup and management
├── AppPasswords.tsx          # Application password management
├── NotificationSettings.tsx  # Comprehensive notification controls
└── SecuritySettings.tsx      # Password and security management
```

### Key Features by Component

#### UserPreferences.tsx
- **Form Management**: React Hook Form with validation
- **Preference Categories**: Personal, appearance, email, notifications
- **Timezone Support**: Comprehensive timezone selection
- **Theme Management**: Light/dark/auto theme switching
- **Real-time Sync**: Immediate preference updates

#### TwoFactorAuth.tsx
- **Setup Wizard**: 3-step setup process (QR → Verify → Backup codes)
- **QR Code Generation**: Server-generated QR codes for easy setup
- **Backup Code Management**: Secure generation and download
- **Disable Protection**: Password + 2FA code required to disable
- **Status Monitoring**: Clear enable/disable state indicators

#### AppPasswords.tsx
- **Secure Generation**: Server-side password generation
- **One-time Display**: Passwords shown only once for security
- **Activity Tracking**: Usage timestamps and device identification
- **Bulk Operations**: Easy management of multiple passwords
- **Setup Guidance**: Step-by-step configuration instructions

#### NotificationSettings.tsx
- **Multi-level Controls**: System-wide and category-specific settings
- **Browser Integration**: Native browser notification API
- **Quiet Hours**: Time-based notification suppression
- **Sound Management**: Volume and sound type controls
- **Digest Configuration**: Email summary preferences

#### SecuritySettings.tsx
- **Password Validation**: Real-time strength checking
- **Security Score**: Visual security status indicators
- **Change Protection**: Current password verification required
- **Activity Logs**: Recent security events display
- **Recommendations**: Contextual security improvement suggestions

## 🔧 Required Backend API Endpoints

### User Preferences API (`/api/auth/preferences`)
```typescript
// Update user preferences
PUT /api/auth/preferences
{
  name: string;
  preferences: {
    theme: 'light' | 'dark' | 'auto';
    language: string;
    timezone: string;
    email_notifications: boolean;
    desktop_notifications: boolean;
    // ... other preference fields
  };
}
```

### Two-Factor Authentication API (`/api/auth/2fa`)
```typescript
// Setup 2FA - returns QR code and secret
POST /api/auth/2fa/setup
Response: {
  secret: string;
  qr_code: string; // Base64 encoded QR code
  backup_codes: string[];
}

// Verify 2FA setup
POST /api/auth/2fa/verify
{ token: string }

// Disable 2FA
POST /api/auth/2fa/disable
{ token: string; password: string }
```

### App Passwords API (`/api/auth/app-passwords`)
```typescript
// Get app passwords
GET /api/auth/app-passwords

// Create app password
POST /api/auth/app-passwords
{ name: string }
Response: {
  id: string;
  name: string;
  password: string; // Only returned once
  created_at: string;
}

// Delete app password
DELETE /api/auth/app-passwords/:id
```

### Security API (`/api/auth`)
```typescript
// Change password
POST /api/auth/change-password
{
  current_password: string;
  new_password: string;
  confirm_password: string;
}

// Get user quota
GET /api/auth/quota
Response: {
  emails_sent_today: number;
  emails_sent_this_month: number;
  daily_limit: number;
  monthly_limit: number;
  storage_used_mb: number;
  storage_limit_mb: number;
}

// Get security activity
GET /api/auth/security-activity
Response: {
  last_password_change: string;
  last_login: string;
  recent_logins: Array<{
    ip_address: string;
    user_agent: string;
    location: string;
    timestamp: string;
  }>;
}
```

## 📊 Database Schema Extensions

### User Preferences Table
```sql
-- Extend users table with preference columns
ALTER TABLE users ADD COLUMN preferences JSONB DEFAULT '{}';
ALTER TABLE users ADD COLUMN two_factor_secret VARCHAR(32);
ALTER TABLE users ADD COLUMN two_factor_enabled BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN backup_codes JSONB DEFAULT '[]';

-- Create indexes for better performance
CREATE INDEX idx_users_preferences ON users USING GIN(preferences);
CREATE INDEX idx_users_2fa_enabled ON users(two_factor_enabled);
```

### App Passwords Table
```sql
CREATE TABLE app_passwords (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    last_used TIMESTAMP,
    expires_at TIMESTAMP,
    active BOOLEAN DEFAULT true
);

CREATE INDEX idx_app_passwords_user_id ON app_passwords(user_id);
CREATE INDEX idx_app_passwords_active ON app_passwords(active);
```

### Security Activity Table
```sql
CREATE TABLE security_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    activity_type security_activity_type NOT NULL,
    ip_address INET,
    user_agent TEXT,
    location VARCHAR(255),
    details JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TYPE security_activity_type AS ENUM (
    'login', 'logout', 'password_change', '2fa_enabled', '2fa_disabled',
    'app_password_created', 'app_password_deleted', 'failed_login'
);

CREATE INDEX idx_security_activity_user_id ON security_activity(user_id);
CREATE INDEX idx_security_activity_type ON security_activity(activity_type);
CREATE INDEX idx_security_activity_created_at ON security_activity(created_at);
```

## 🎯 Key Implementation Features

### Theme Management
- **CSS Custom Properties**: Dynamic theme switching
- **System Integration**: Respects OS dark mode preference
- **Persistence**: Theme choice saved in user preferences
- **Real-time Updates**: Instant theme application

### Security Enhancements
- **Password Strength Meter**: Real-time validation with visual feedback
- **2FA Integration**: TOTP-based authentication with backup codes
- **App Password Security**: One-time display, secure generation
- **Activity Monitoring**: Comprehensive security event logging

### Notification System
- **Progressive Enhancement**: Graceful fallback for unsupported browsers
- **Permission Management**: Proper browser notification permission handling
- **Quiet Hours**: Time-based notification suppression
- **Multi-channel Delivery**: Email, desktop, browser, sound notifications

### User Experience
- **Form Validation**: Real-time validation with helpful error messages
- **Loading States**: Clear loading indicators for all async operations
- **Success Feedback**: Toast notifications for successful operations
- **Progressive Disclosure**: Show/hide advanced options as needed

## 🚀 Setup Instructions

### 1. Install Additional Dependencies
```bash
# QR Code generation (backend)
npm install qrcode speakeasy

# TOTP verification (backend)
npm install otplib
```

### 2. Environment Variables
Add to your `.env` file:
```env
# 2FA Settings
TOTP_SERVICE_NAME=Pulsemail
TOTP_ISSUER=Pulsemail Client

# App Password Settings
APP_PASSWORD_LENGTH=16
APP_PASSWORD_EXPIRY_DAYS=365

# Security Settings
PASSWORD_MIN_LENGTH=8
PASSWORD_REQUIRE_UPPERCASE=true
PASSWORD_REQUIRE_LOWERCASE=true
PASSWORD_REQUIRE_NUMBERS=true
PASSWORD_REQUIRE_SPECIAL=true
```

### 3. Backend Implementation Requirements

#### 2FA Implementation
```typescript
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';

// Generate 2FA secret and QR code
export const setup2FA = async (userId: string) => {
  const secret = speakeasy.generateSecret({
    name: user.email,
    service: process.env.TOTP_SERVICE_NAME,
    issuer: process.env.TOTP_ISSUER,
  });

  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
  
  // Generate backup codes
  const backupCodes = Array.from({ length: 10 }, () => 
    Math.random().toString(36).substring(2, 10).toUpperCase()
  );

  return {
    secret: secret.base32,
    qr_code: qrCodeUrl,
    backup_codes: backupCodes,
  };
};
```

#### App Password Generation
```typescript
import crypto from 'crypto';
import bcrypt from 'bcrypt';

export const generateAppPassword = async (userId: string, name: string) => {
  // Generate secure random password
  const password = crypto.randomBytes(12).toString('base64').slice(0, 16);
  const hashedPassword = await bcrypt.hash(password, 12);

  const appPassword = await db.app_passwords.create({
    user_id: userId,
    name,
    password_hash: hashedPassword,
  });

  // Return password only once
  return {
    id: appPassword.id,
    name: appPassword.name,
    password, // Only returned on creation
    created_at: appPassword.created_at,
  };
};
```

## 🔒 Security Considerations

### Two-Factor Authentication
- **Secret Storage**: Store 2FA secrets encrypted in database
- **Backup Codes**: Hash backup codes, allow single use only
- **Rate Limiting**: Implement rate limiting for 2FA verification attempts
- **Recovery Process**: Secure account recovery process for lost 2FA devices

### App Passwords
- **Secure Generation**: Use cryptographically secure random generation
- **Limited Scope**: App passwords should have limited API access
- **Expiration**: Implement automatic expiration for unused passwords
- **Audit Trail**: Log all app password creation and usage

### Password Security
- **Strength Requirements**: Enforce strong password policies
- **History**: Prevent reuse of recent passwords
- **Breach Detection**: Check against known compromised password lists
- **Secure Storage**: Use proper password hashing (bcrypt, Argon2)

## 📱 Mobile Responsiveness

All settings components are fully responsive with:
- **Adaptive Layouts**: Grid layouts that stack on mobile
- **Touch-Friendly**: Appropriate touch targets and spacing
- **Readable Text**: Proper font sizes and contrast ratios
- **Modal Optimization**: Mobile-optimized modals and forms

## 🧪 Testing Recommendations

### Unit Tests
- Test form validation logic
- Test preference save/load functionality
- Test 2FA setup and verification flows
- Test app password generation and management

### Integration Tests
- Test complete settings workflow
- Test 2FA integration with authentication
- Test notification permission handling
- Test theme switching functionality

### Security Tests
- Test password strength validation
- Test 2FA backup code functionality
- Test app password security measures
- Test session management after password changes

This comprehensive settings implementation provides enterprise-grade security features while maintaining an intuitive user experience. The modular architecture allows for easy extension and customization of individual features as needed.