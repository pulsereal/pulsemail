const jwt = require('jsonwebtoken');
const User = require('../models/User');
const speakeasy = require('speakeasy');

// JWT Authentication middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByEmail(decoded.email);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = {
      email: decoded.email,
      id: decoded.email,
      name: user.name
    };
    
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// 2FA verification middleware
const verify2FA = async (req, res, next) => {
  try {
    const { email } = req.user;
    const { twoFactorCode } = req.body;

    // Check if user has 2FA enabled
    const secret = await User.get2FASecret(email);
    
    if (!secret) {
      // 2FA not enabled, proceed
      return next();
    }

    if (!twoFactorCode) {
      return res.status(400).json({ 
        error: '2FA code required',
        requires2FA: true
      });
    }

    // Verify 2FA code
    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: twoFactorCode,
      window: 2 // Allow 30 second window
    });

    if (!verified) {
      return res.status(401).json({ error: 'Invalid 2FA code' });
    }

    next();
  } catch (error) {
    return res.status(500).json({ error: 'Error verifying 2FA' });
  }
};

// App password authentication middleware
const authenticateAppPassword = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Basic authentication required' });
  }

  try {
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
    const [email, password] = credentials.split(':');

    // Try regular authentication first
    const user = await User.authenticate(email, password);
    
    if (user) {
      req.user = user;
      return next();
    }

    // Try app password authentication
    const appPasswords = await User.getAppPasswords(email);
    let validAppPassword = false;

    for (const appPassword of appPasswords) {
      const bcrypt = require('bcryptjs');
      const isValid = await bcrypt.compare(password, appPassword.password);
      
      if (isValid) {
        validAppPassword = true;
        req.user = await User.findByEmail(email);
        req.appPassword = appPassword;
        break;
      }
    }

    if (!validAppPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    next();
  } catch (error) {
    return res.status(500).json({ error: 'Authentication error' });
  }
};

// Rate limiting middleware
const rateLimit = require('express-rate-limit');

const createRateLimit = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

// Different rate limits for different endpoints
const authRateLimit = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  5, // 5 attempts
  'Too many authentication attempts, please try again later'
);

const emailRateLimit = createRateLimit(
  60 * 1000, // 1 minute
  10, // 10 emails per minute
  'Too many emails sent, please try again later'
);

const apiRateLimit = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  100, // 100 requests
  'Too many API requests, please try again later'
);

// Input validation middleware
const validateEmail = (req, res, next) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  next();
};

const validatePassword = (req, res, next) => {
  const { password } = req.body;
  
  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ 
      error: 'Password must be at least 8 characters long' 
    });
  }

  next();
};

// CORS middleware
const corsMiddleware = (req, res, next) => {
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://your-domain.com'
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', true);

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
};

// Error handling middleware
const errorHandler = (error, req, res, next) => {
  console.error('Error:', error);

  // JWT errors
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token' });
  }

  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expired' });
  }

  // Database errors
  if (error.code === '23505') { // PostgreSQL unique violation
    return res.status(409).json({ error: 'Resource already exists' });
  }

  if (error.code === '42P01') { // PostgreSQL table doesn't exist
    return res.status(500).json({ error: 'Database configuration error' });
  }

  // Default error
  const status = error.status || 500;
  const message = error.message || 'Internal server error';
  
  res.status(status).json({ 
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
};

// Request logging middleware
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });
  
  next();
};

// Security headers middleware
const securityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
};

// Content Security Policy middleware
const cspMiddleware = (req, res, next) => {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ');
  
  res.setHeader('Content-Security-Policy', csp);
  next();
};

module.exports = {
  authenticateToken,
  verify2FA,
  authenticateAppPassword,
  authRateLimit,
  emailRateLimit,
  apiRateLimit,
  validateEmail,
  validatePassword,
  corsMiddleware,
  errorHandler,
  requestLogger,
  securityHeaders,
  cspMiddleware
};
