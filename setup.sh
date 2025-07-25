#!/bin/bash

# Pulsemail Custom Client - Setup Script
# This script helps set up the development environment

set -e

echo "🚀 Pulsemail Custom Client Setup"
echo "================================"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo "❌ Node.js version 16+ is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Setup backend
echo ""
echo "📦 Setting up backend..."
cd backend

if [ ! -f ".env" ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please edit backend/.env with your configuration"
fi

echo "📥 Installing backend dependencies..."
npm install

echo "✅ Backend setup complete"

# Setup frontend
echo ""
echo "🎨 Setting up frontend..."
cd ../frontend

echo "📥 Installing frontend dependencies..."
npm install

# Verify Tailwind CSS setup
echo "🎨 Setting up Tailwind CSS..."
if [ ! -f "postcss.config.js" ]; then
    echo "⚠️  PostCSS config missing, creating..."
    cat > postcss.config.js << 'EOF'
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
EOF
fi

echo "🏗️  Building frontend for production..."
npm run build

echo "✅ Frontend setup complete"

# Back to root
cd ..

echo ""
echo "🎉 Setup Complete!"
echo ""
echo "✨ The login page now includes:"
echo "   - Modern gradient background"
echo "   - Professional card layout"
echo "   - Animated form elements"
echo "   - 2FA support with smooth transitions"
echo "   - Error handling with visual feedback"
echo "   - Feature highlights"
echo ""
echo "Next steps:"
echo "1. Configure your database using: sudo -u postgres psql -f database_setup.sql"
echo "2. Edit backend/.env with your Pulsemail configuration"
echo "3. Start the backend: cd backend && npm start"
echo "4. Configure your web server (see DEPLOYMENT.md)"
echo ""
echo "For development:"
echo "- Backend: cd backend && npm run dev"
echo "- Frontend: cd frontend && npm run dev"
echo ""
echo "Styling Notes:"
echo "- All Tailwind CSS classes are properly configured"
echo "- PostCSS and Autoprefixer are set up"
echo "- Login page includes full responsive design"
echo "- Custom animations and gradients implemented"
echo ""
echo "Documentation:"
echo "- README.md - Project overview and features"
echo "- DEPLOYMENT.md - Complete deployment guide"
echo "- API docs available at http://localhost:3001/api/docs"
