/**
 * RBAC Authentication & Authorization
 *
 * Roles:
 *   admin  — full access: create/delete users, manage config, all CRUD
 *   editor — read + write: manage agents, workplans, kanban, infra
 *   viewer — read only: view dashboards, cannot modify anything
 *
 * First boot: creates admin user from MC_ADMIN_PASSWORD env var.
 * Users stored in SQLite with bcrypt-hashed passwords.
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const log = require('./logger');

const JWT_EXPIRY = '24h';
const COOKIE_NAME = 'mc_session';
const ROLES = ['admin', 'editor', 'viewer'];

// Permission matrix: role → allowed actions
const PERMISSIONS = {
  admin:  ['read', 'write', 'delete', 'admin', 'scan', 'config', 'users'],
  editor: ['read', 'write', 'delete', 'scan'],
  viewer: ['read'],
};

// Route → required permission
const ROUTE_PERMS = {
  // Public
  'POST /api/auth/login': null,
  'POST /api/auth/logout': null,
  'GET /api/health': null,

  // Read
  'GET /api/agents': 'read',
  'GET /api/managed-gateways': 'read',
  'GET /api/workplans': 'read',
  'GET /api/events': 'read',
  'GET /api/fleet': 'read',
  'GET /api/gateways': 'read',
  'GET /api/watchdog': 'read',
  'GET /api/execution': 'read',
  'GET /api/metrics': 'read',
  'GET /api/kanban': 'read',
  'GET /api/infra': 'read',
  'GET /api/vault': 'read',
  'GET /api/users': 'admin',
  'GET /api/auth/me': 'read',

  // Write
  'POST /api/agents': 'write',
  'PATCH /api/agents': 'write',
  'POST /api/managed-gateways': 'write',
  'PATCH /api/managed-gateways': 'write',
  'POST /api/workplans': 'write',
  'PATCH /api/workplans': 'write',
  'POST /api/kanban': 'write',
  'PATCH /api/kanban': 'write',
  'POST /api/infra': 'write',
  'PATCH /api/infra': 'write',
  'POST /api/vault': 'write',
  'PATCH /api/vault': 'write',
  'POST /api/heartbeat': 'write',
  'POST /api/approvals': 'write',
  'PATCH /api/watchdog': 'write',
  'POST /api/watchdog': 'write',

  // Delete
  'DELETE /api/agents': 'delete',
  'DELETE /api/managed-gateways': 'delete',
  'DELETE /api/workplans': 'delete',
  'DELETE /api/kanban': 'delete',
  'DELETE /api/infra': 'delete',
  'DELETE /api/vault': 'delete',

  // Admin
  'POST /api/users': 'admin',
  'PATCH /api/users': 'admin',
  'DELETE /api/users': 'admin',
  'PATCH /api/gateways': 'config',
  'POST /api/gateways': 'config',

  // Scan
  'POST /api/infra/scan': 'scan',
};

class AuthMiddleware {
  constructor(db, options = {}) {
    this.db = db;
    this.jwtSecret = options.jwtSecret || process.env.MC_JWT_SECRET || crypto.randomBytes(32).toString('hex');
    this._migrate();
    this._prepare();
    this._seedAdmin(options.adminPassword || process.env.MC_ADMIN_PASSWORD);
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT DEFAULT '',
        role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin','editor','viewer')),
        enabled INTEGER DEFAULT 1,
        last_login TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }

  _prepare() {
    this.s = {
      getByUsername: this.db.prepare(`SELECT * FROM users WHERE username=?`),
      getById: this.db.prepare(`SELECT id, username, display_name, role, enabled, last_login, created_at FROM users WHERE id=?`),
      list: this.db.prepare(`SELECT id, username, display_name, role, enabled, last_login, created_at FROM users ORDER BY created_at`),
      insert: this.db.prepare(`INSERT INTO users (id, username, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)`),
      updateRole: this.db.prepare(`UPDATE users SET role=?, updated_at=datetime('now') WHERE id=?`),
      updatePassword: this.db.prepare(`UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?`),
      updateProfile: this.db.prepare(`UPDATE users SET display_name=?, updated_at=datetime('now') WHERE id=?`),
      toggleEnabled: this.db.prepare(`UPDATE users SET enabled=?, updated_at=datetime('now') WHERE id=?`),
      delete: this.db.prepare(`DELETE FROM users WHERE id=?`),
      updateLogin: this.db.prepare(`UPDATE users SET last_login=datetime('now') WHERE id=?`),
      count: this.db.prepare(`SELECT COUNT(*) as count FROM users`),
    };
  }

  _seedAdmin(password) {
    const count = this.s.count.get().count;
    if (count > 0) return; // Users exist, don't re-seed

    if (!password) {
      log.warn('auth', 'No MC_ADMIN_PASSWORD set. Cannot create admin user.');
      return;
    }

    const hash = bcrypt.hashSync(password, 12);
    const id = 'user-' + crypto.randomUUID().slice(0, 8);
    this.s.insert.run(id, 'admin', hash, 'Administrator', 'admin');
    log.info('auth', `Admin user created (username: admin)`);
  }

  // ─── HTTP middleware ──────────────────────────────────────────

  httpAuth() {
    return (req, res, next) => {
      const { pathname } = new URL(req.url, `http://${req.headers.host}`);

      // Public routes
      if (pathname === '/api/auth/login' || pathname === '/api/health') return next();
      if (pathname.startsWith('/_next/') || pathname === '/favicon.ico') return next();
      // Login page
      if (pathname === '/login') return next();

      const token = this._extractToken(req);
      if (!token) {
        if (pathname.startsWith('/api/')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Authentication required' }));
        }
        return next();
      }

      try {
        const payload = jwt.verify(token, this.jwtSecret);
        req.user = payload;

        // Check RBAC permission
        const perm = this._resolvePermission(req.method, pathname);
        if (perm && !this._hasPermission(payload.role, perm)) {
          if (pathname.startsWith('/api/')) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: `Insufficient permissions. Required: ${perm}, your role: ${payload.role}` }));
          }
        }

        next();
      } catch (e) {
        if (pathname.startsWith('/api/')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid or expired token' }));
        }
        next();
      }
    };
  }

  _resolvePermission(method, pathname) {
    // Exact match first
    const exact = ROUTE_PERMS[`${method} ${pathname}`];
    if (exact !== undefined) return exact;

    // Prefix match: /api/agents/xxx → check POST /api/agents
    const basePath = pathname.replace(/\/[^/]+$/, '');
    const prefixMatch = ROUTE_PERMS[`${method} ${basePath}`];
    if (prefixMatch !== undefined) return prefixMatch;

    // Broader prefix: /api/kanban/boards/main → /api/kanban
    const parts = pathname.split('/');
    if (parts.length >= 3) {
      const broad = `/${parts[1]}/${parts[2]}`;
      const broadMatch = ROUTE_PERMS[`${method} ${broad}`];
      if (broadMatch !== undefined) return broadMatch;
    }

    // Default: require read for GET, write for everything else
    if (method === 'GET') return 'read';
    if (method === 'DELETE') return 'delete';
    return 'write';
  }

  _hasPermission(role, required) {
    if (!required) return true; // Public
    const perms = PERMISSIONS[role] || [];
    return perms.includes(required);
  }

  // ─── WebSocket auth ──────────────────────────────────────────

  wsAuth(req) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    if (!token) return null;
    try { return jwt.verify(token, this.jwtSecret); }
    catch { return null; }
  }

  // ─── Login/Logout ────────────────────────────────────────────

  async handleLogin(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { username, password } = JSON.parse(body);
        const uname = username || 'admin'; // Backwards compat: no username field = admin

        const user = this.s.getByUsername.get(uname);
        if (!user) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid credentials' }));
        }

        if (!user.enabled) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Account disabled' }));
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid credentials' }));
        }

        this.s.updateLogin.run(user.id);

        const token = jwt.sign(
          { userId: user.id, username: user.username, role: user.role, displayName: user.display_name },
          this.jwtSecret,
          { expiresIn: JWT_EXPIRY }
        );

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`,
        });
        res.end(JSON.stringify({ ok: true, token, user: { id: user.id, username: user.username, role: user.role, displayName: user.display_name } }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
    });
  }

  handleLogout(req, res) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
    });
    res.end(JSON.stringify({ ok: true }));
  }

  // ─── User management (admin only) ───────────────────────────

  listUsers() { return this.s.list.all(); }

  getUser(id) { return this.s.getById.get(id); }

  async createUser(data) {
    if (!data.username || !data.password) throw new Error('username and password required');
    if (!ROLES.includes(data.role || 'viewer')) throw new Error(`Invalid role. Must be: ${ROLES.join(', ')}`);
    if (this.s.getByUsername.get(data.username)) throw new Error('Username already exists');

    const id = 'user-' + crypto.randomUUID().slice(0, 8);
    const hash = await bcrypt.hash(data.password, 12);
    this.s.insert.run(id, data.username, hash, data.displayName || data.username, data.role || 'viewer');
    log.info('auth', `User created: ${data.username} (${data.role || 'viewer'})`);
    return this.s.getById.get(id);
  }

  async updateUser(id, updates) {
    const user = this.s.getById.get(id);
    if (!user) return null;

    if (updates.role && ROLES.includes(updates.role)) {
      this.s.updateRole.run(updates.role, id);
    }
    if (updates.displayName !== undefined) {
      this.s.updateProfile.run(updates.displayName, id);
    }
    if (updates.password) {
      const hash = await bcrypt.hash(updates.password, 12);
      this.s.updatePassword.run(hash, id);
    }
    if (updates.enabled !== undefined) {
      this.s.toggleEnabled.run(updates.enabled ? 1 : 0, id);
    }

    return this.s.getById.get(id);
  }

  deleteUser(id) {
    // Prevent deleting last admin
    const admins = this.s.list.all().filter(u => u.role === 'admin' && u.id !== id);
    if (admins.length === 0) throw new Error('Cannot delete the last admin user');
    this.s.delete.run(id);
    log.info('auth', `User deleted: ${id}`);
  }

  // ─── Current user info ──────────────────────────────────────

  handleMe(req, res) {
    if (!req.user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not authenticated' }));
    }
    const user = this.s.getById.get(req.user.userId);
    if (!user) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'User not found' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...user, permissions: PERMISSIONS[user.role] || [] }));
  }

  // ─── Helpers ─────────────────────────────────────────────────

  _extractToken(req) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
    const cookies = req.headers.cookie;
    if (cookies) {
      const match = cookies.split(';').find(c => c.trim().startsWith(`${COOKIE_NAME}=`));
      if (match) return match.split('=')[1].trim();
    }
    return null;
  }

  static get ROLES() { return ROLES; }
  static get PERMISSIONS() { return PERMISSIONS; }
}

module.exports = { AuthMiddleware };
