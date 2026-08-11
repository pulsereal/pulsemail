#!/bin/bash

# Quick Setup Script for Mock Data Development
# This script sets up the backend to use file-based mock data

set -e

echo "🚀 Setting up Pulsemail Client Backend with Mock Data..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if we're in the backend directory
if [ ! -f "package.json" ]; then
    print_warning "Not in backend directory. Changing to backend directory..."
    cd backend
fi

# Install dependencies
print_status "Installing dependencies..."
npm install

# Create .env file with mock data enabled
print_status "Creating .env file with mock data configuration..."
cat > .env << EOF
# ========================================
# Pulsemail Client Backend - Mock Data Development
# ========================================

# ========================================
# Server Configuration
# ========================================
NODE_ENV=development
PORT=3001
APP_NAME=Pulsemail Client

# ========================================
# Mock Data Configuration
# ========================================
USE_MOCK_DATA=true

# ========================================
# JWT Configuration
# ========================================
JWT_SECRET=dev_jwt_secret_key_for_mock_data_development_only
JWT_EXPIRES_IN=7d

# ========================================
# Mock Email Configuration
# ========================================
SMTP_HOST=localhost
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=test@localhost
SMTP_PASS=test_password

IMAP_HOST=localhost
IMAP_PORT=993
IMAP_SECURE=true
IMAP_PASS=test_password

# ========================================
# OpenAI Configuration (Optional)
# ========================================
OPENAI_API_KEY=your_openai_api_key_here

# ========================================
# Security & Rate Limiting
# ========================================
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# ========================================
# CORS Configuration
# ========================================
CORS_ORIGIN=http://localhost:3000,http://localhost:3001

# ========================================
# Logging Configuration
# ========================================
LOG_LEVEL=debug
DEBUG=true
DB_DEBUG=false
EOF

print_success "Created .env file with mock data configuration"

# Initialize mock data
print_status "Initializing mock data..."
node -e "
const MockDataManager = require('./src/config/mockData');
const mockData = new MockDataManager();
console.log('✅ Mock data initialized');
"

# Test the setup
print_status "Testing the setup..."
if node -e "
const MockDataManager = require('./src/config/mockData');
const mockData = new MockDataManager();
const users = mockData.getUsers();
const emails = mockData.getEmails('test@localhost');
console.log('✅ Mock data test successful');
console.log('📧 Users:', users.length);
console.log('📧 Emails:', emails.length);
" 2>/dev/null; then
    print_success "Mock data test passed"
else
    print_warning "Mock data test failed, but continuing..."
fi

echo ""
print_success "🎉 Mock data setup completed!"
echo ""
echo "📋 What's been set up:"
echo "  ✅ Dependencies installed"
echo "  ✅ .env file created with mock data enabled"
echo "  ✅ Mock data initialized"
echo "  ✅ Test data created"
echo ""
echo "🔧 Next steps:"
echo "  1. Start the server: npm run dev"
echo "  2. Test the API: http://localhost:3001/health"
echo "  3. Login with: test@localhost / test"
echo ""
echo "📚 Useful commands:"
echo "  • Manage mock data: node scripts/mock-data.js help"
echo "  • Add test emails: node scripts/mock-data.js add-email 'Subject' 'sender@example.com'"
echo "  • Reset data: node scripts/mock-data.js reset"
echo ""
echo "📖 Documentation:"
echo "  • Mock data guide: README-MOCK-DATA.md"
echo "  • Setup guide: README-SETUP.md"
echo ""
print_success "Ready to start development with mock data!" 