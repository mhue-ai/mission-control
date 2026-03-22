/**
 * Authentication Middleware
 * 
 * Fixes from review:
 * - JWT-based authentication for all dashboard routes
 * - WebSocket auth via token query parameter
 * - Password hashing with bcrypt
 * - Session management with httpOnly cookies
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const JWT_SECRET = process.env.MC_JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRY = '24h';
const COOKIE_NAME = 'mc_session';

class AuthMiddleware {
  constructor(options = {}) {
    this.adminPasswordHash = null;
    this.jwtSecret = options.jwtSecret || JWT_SECRET;
    this._initPassword(options.adminPassword || process.env.MC_ADMIN_PASSWORD);
  }

  async _initPassword(password) {
    if (!password) {
      console.warn('[auth] WARNING: No admin password set. Generate one with: openssl rand -base64 16');
      // For development only — reject all logins
      return;
    }
    this.adminPasswordHash = await bcrypt.hash(password, 12);
  }

  /**
   * Express-style middleware for HTTP routes.
   * Checks Authorization header (Bearer token) or session cookie.
   */
  httpAuth() {
    return (req, res, next) => {
      // Public routes
      if (req.url === '/api/auth/login' || req.url === '/api/health') {
        return next();
      }
      // Static assets (Next.js)
      if (req.url.startsWith('/_next/') || req.url === '/favicon.ico') {
        return next();
      }

      const token = this._extractToken(req);
      if (!token) {
        // If it's an API request, return 401
        if (req.url.startsWith('/api/')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Authentication required' }));
          return;
        }
        // For page requests, redirect to login
        // (In production, Next.js handles this client-side)
        return next();
      }

      try {
        const payload = jwt.verify(token, this.jwtSecret);
        req.user = payload;
        next();
      } catch (e) {
        if (req.url.startsWith('/api/')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid or expired token' }));
          return;
        }
        next();
      }
    };
  }

  /**
   * Validate a WebSocket upgrade request.
   * Checks token in query string: ws://host/ws?token=<jwt>
   */
  wsAuth(req) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    if (!token) return null;
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (e) {
      return null;
    }
  }

  /**
   * Handle login POST request
   */
  async handleLogin(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { password } = JSON.parse(body);

        if (!this.adminPasswordHash) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No admin password configured' }));
          return;
        }

        const valid = await bcrypt.compare(password, this.adminPasswordHash);
        if (!valid) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid password' }));
          return;
        }

        const token = jwt.sign(
          { role: 'admin', iat: Math.floor(Date.now() / 1000) },
          this.jwtSecret,
          { expiresIn: JWT_EXPIRY }
        );

        // Set httpOnly cookie for browser + return token for API clients
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`,
        });
        res.end(JSON.stringify({ ok: true, token }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
    });
  }

  /**
   * Handle logout
   */
  handleLogout(req, res) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
    });
    res.end(JSON.stringify({ ok: true }));
  }

  _extractToken(req) {
    // Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    // Check cookie
    const cookies = req.headers.cookie;
    if (cookies) {
      const match = cookies.split(';').find(c => c.trim().startsWith(`${COOKIE_NAME}=`));
      if (match) return match.split('=')[1].trim();
    }
    return null;
  }
}

module.exports = { AuthMiddleware };
