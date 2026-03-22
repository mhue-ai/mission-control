/**
 * Infrastructure Registry + Credential Vault
 * 
 * A CMDB (Configuration Management Database) for defining the complete
 * operating environment: networks, servers, gateways, WAFs, databases,
 * APIs, services — any system component.
 * 
 * Each component has:
 *   - Type, name, host/address, metadata
 *   - Relevance flag (is this part of our active environment?)
 *   - Per-agent access level: none | read | read-write
 *   - Optional credential references (stored encrypted in the vault)
 *
 * Credentials are AES-256-GCM encrypted at rest. Agents receive
 * time-limited, scoped credential leases — never raw secrets.
 */

const crypto = require('crypto');
const log = require('./logger');

// ─── Encryption ────────────────────────────────────────────────────
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function deriveKey(masterKey) {
  return crypto.scryptSync(masterKey, 'mc-vault-salt-v1', 32);
}

function encrypt(plaintext, masterKey) {
  const key = deriveKey(masterKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
}

function decrypt(ciphertext, masterKey) {
  const key = deriveKey(masterKey);
  const [ivHex, tagHex, encHex] = ciphertext.split(':');
  if (!ivHex || !tagHex || !encHex) throw new Error('Malformed ciphertext');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ─── Component types taxonomy ──────────────────────────────────────
const COMPONENT_TYPES = [
  'network', 'subnet', 'vlan', 'vpn', 'firewall', 'waf', 'load_balancer',
  'server', 'vm', 'container', 'cluster',
  'gateway', 'openclaw_gateway', 'api_gateway', 'reverse_proxy',
  'database', 'cache', 'message_queue', 'object_storage',
  'api_service', 'web_service', 'microservice', 'webhook_endpoint',
  'dns', 'certificate', 'secret_manager',
  'monitoring', 'log_aggregator', 'alerting',
  'cicd_pipeline', 'repository', 'artifact_registry',
  'saas_integration', 'third_party_api',
  'custom',
];

const ACCESS_LEVELS = ['none', 'read', 'read_write'];

// ═══════════════════════════════════════════════════════════════════
class InfrastructureRegistry {
  constructor(db, vaultKey) {
    this.db = db;
    this.vaultKey = vaultKey || process.env.MC_VAULT_KEY;
    if (!this.vaultKey) {
      log.warn('vault', 'MC_VAULT_KEY not set — credentials will be stored in PLAINTEXT. Generate with: openssl rand -hex 32');
      this.vaultKey = 'INSECURE_DEFAULT_KEY_CHANGE_ME_NOW';
    }
    this._migrate();
    this._prepare();
  }

  _migrate() {
    this.db.exec(`
      -- Infrastructure components
      CREATE TABLE IF NOT EXISTS infra_components (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        host TEXT DEFAULT '',
        port INTEGER,
        protocol TEXT DEFAULT '',
        environment TEXT DEFAULT 'production',
        tags TEXT DEFAULT '[]',
        metadata TEXT DEFAULT '{}',
        relevant INTEGER DEFAULT 1,
        health_check_url TEXT,
        status TEXT DEFAULT 'unknown',
        last_health_check TEXT,
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      -- Per-agent access matrix
      CREATE TABLE IF NOT EXISTS infra_access (
        component_id TEXT NOT NULL,
        agent_pattern TEXT NOT NULL,
        access_level TEXT NOT NULL DEFAULT 'none' CHECK(access_level IN ('none','read','read_write')),
        granted_by TEXT DEFAULT 'operator',
        granted_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (component_id, agent_pattern),
        FOREIGN KEY (component_id) REFERENCES infra_components(id) ON DELETE CASCADE
      );

      -- Credential vault
      CREATE TABLE IF NOT EXISTS vault_credentials (
        id TEXT PRIMARY KEY,
        component_id TEXT,
        name TEXT NOT NULL,
        credential_type TEXT NOT NULL DEFAULT 'api_key',
        encrypted_value TEXT NOT NULL,
        username TEXT DEFAULT '',
        metadata TEXT DEFAULT '{}',
        rotation_policy TEXT DEFAULT '',
        last_rotated TEXT,
        expires_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (component_id) REFERENCES infra_components(id) ON DELETE SET NULL
      );

      -- Credential access log (audit trail)
      CREATE TABLE IF NOT EXISTS vault_access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credential_id TEXT NOT NULL,
        agent_id TEXT,
        action TEXT NOT NULL,
        ip_address TEXT,
        lease_expires TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Credential leases (time-limited access tokens)
      CREATE TABLE IF NOT EXISTS vault_leases (
        id TEXT PRIMARY KEY,
        credential_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        task_id TEXT,
        expires_at TEXT NOT NULL,
        revoked INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (credential_id) REFERENCES vault_credentials(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_infra_type ON infra_components(type);
      CREATE INDEX IF NOT EXISTS idx_infra_relevant ON infra_components(relevant);
      CREATE INDEX IF NOT EXISTS idx_infra_access_agent ON infra_access(agent_pattern);
      CREATE INDEX IF NOT EXISTS idx_vault_component ON vault_credentials(component_id);
      CREATE INDEX IF NOT EXISTS idx_vault_log_cred ON vault_access_log(credential_id);
      CREATE INDEX IF NOT EXISTS idx_vault_leases_agent ON vault_leases(agent_id);
      CREATE INDEX IF NOT EXISTS idx_vault_leases_expires ON vault_leases(expires_at);
    `);
  }

  _prepare() {
    this.stmts = {
      // Components
      insertComponent: this.db.prepare(`INSERT INTO infra_components (id, type, name, description, host, port, protocol, environment, tags, metadata, relevant, health_check_url, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      updateComponent: this.db.prepare(`UPDATE infra_components SET type=?, name=?, description=?, host=?, port=?, protocol=?, environment=?, tags=?, metadata=?, relevant=?, health_check_url=?, notes=?, updated_at=datetime('now') WHERE id=?`),
      deleteComponent: this.db.prepare(`DELETE FROM infra_components WHERE id=?`),
      getComponent: this.db.prepare(`SELECT * FROM infra_components WHERE id=?`),
      listComponents: this.db.prepare(`SELECT * FROM infra_components ORDER BY type, name`),
      listRelevant: this.db.prepare(`SELECT * FROM infra_components WHERE relevant=1 ORDER BY type, name`),
      listByType: this.db.prepare(`SELECT * FROM infra_components WHERE type=? ORDER BY name`),
      updateStatus: this.db.prepare(`UPDATE infra_components SET status=?, last_health_check=datetime('now') WHERE id=?`),

      // Access
      setAccess: this.db.prepare(`INSERT OR REPLACE INTO infra_access (component_id, agent_pattern, access_level, granted_by) VALUES (?, ?, ?, ?)`),
      removeAccess: this.db.prepare(`DELETE FROM infra_access WHERE component_id=? AND agent_pattern=?`),
      getAccess: this.db.prepare(`SELECT * FROM infra_access WHERE component_id=?`),
      getAgentAccess: this.db.prepare(`SELECT ic.*, ia.access_level FROM infra_components ic JOIN infra_access ia ON ic.id = ia.component_id WHERE ia.agent_pattern=? AND ic.relevant=1 AND ia.access_level != 'none' ORDER BY ic.type, ic.name`),

      // Credentials
      insertCredential: this.db.prepare(`INSERT INTO vault_credentials (id, component_id, name, credential_type, encrypted_value, username, metadata, rotation_policy, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      updateCredential: this.db.prepare(`UPDATE vault_credentials SET name=?, credential_type=?, encrypted_value=?, username=?, metadata=?, rotation_policy=?, expires_at=?, updated_at=datetime('now') WHERE id=?`),
      deleteCredential: this.db.prepare(`DELETE FROM vault_credentials WHERE id=?`),
      getCredential: this.db.prepare(`SELECT * FROM vault_credentials WHERE id=?`),
      listCredentials: this.db.prepare(`SELECT id, component_id, name, credential_type, username, metadata, rotation_policy, last_rotated, expires_at, created_at FROM vault_credentials ORDER BY name`),
      listByComponent: this.db.prepare(`SELECT id, name, credential_type, username FROM vault_credentials WHERE component_id=?`),

      // Leases
      insertLease: this.db.prepare(`INSERT INTO vault_leases (id, credential_id, agent_id, task_id, expires_at) VALUES (?, ?, ?, ?, ?)`),
      revokeLease: this.db.prepare(`UPDATE vault_leases SET revoked=1 WHERE id=?`),
      revokeAgentLeases: this.db.prepare(`UPDATE vault_leases SET revoked=1 WHERE agent_id=?`),
      getActiveLease: this.db.prepare(`SELECT * FROM vault_leases WHERE id=? AND revoked=0 AND expires_at > datetime('now')`),
      listActiveLeases: this.db.prepare(`SELECT * FROM vault_leases WHERE revoked=0 AND expires_at > datetime('now') ORDER BY expires_at`),
      cleanExpiredLeases: this.db.prepare(`DELETE FROM vault_leases WHERE expires_at < datetime('now', '-1 day')`),

      // Audit
      logAccess: this.db.prepare(`INSERT INTO vault_access_log (credential_id, agent_id, action, ip_address, lease_expires) VALUES (?, ?, ?, ?, ?)`),
    };
  }

  // ─── Component CRUD ──────────────────────────────────────────────

  createComponent(c) {
    const id = c.id || crypto.randomUUID().slice(0, 12);
    if (!COMPONENT_TYPES.includes(c.type) && c.type !== 'custom') {
      throw new Error(`Invalid component type: ${c.type}. Valid: ${COMPONENT_TYPES.join(', ')}`);
    }
    this.stmts.insertComponent.run(
      id, c.type, c.name, c.description || '', c.host || '', c.port || null,
      c.protocol || '', c.environment || 'production',
      JSON.stringify(c.tags || []), JSON.stringify(c.metadata || {}),
      c.relevant !== false ? 1 : 0, c.healthCheckUrl || null, c.notes || ''
    );
    log.info('infra', `Component created: ${c.name} (${c.type})`, { id });
    return this.getComponent(id);
  }

  getComponent(id) {
    const c = this.stmts.getComponent.get(id);
    if (!c) return null;
    c.tags = JSON.parse(c.tags || '[]');
    c.metadata = JSON.parse(c.metadata || '{}');
    c.credentials = this.stmts.listByComponent.all(id);
    c.accessRules = this.stmts.getAccess.all(id);
    return c;
  }

  listComponents(options = {}) {
    const rows = options.relevantOnly ? this.stmts.listRelevant.all() : this.stmts.listComponents.all();
    return rows.map(c => {
      c.tags = JSON.parse(c.tags || '[]');
      c.metadata = JSON.parse(c.metadata || '{}');
      return c;
    });
  }

  listByType(type) {
    return this.stmts.listByType.all(type).map(c => {
      c.tags = JSON.parse(c.tags || '[]');
      c.metadata = JSON.parse(c.metadata || '{}');
      return c;
    });
  }

  updateComponent(id, updates) {
    const existing = this.stmts.getComponent.get(id);
    if (!existing) return null;
    this.stmts.updateComponent.run(
      updates.type ?? existing.type,
      updates.name ?? existing.name,
      updates.description ?? existing.description,
      updates.host ?? existing.host,
      updates.port !== undefined ? updates.port : existing.port,
      updates.protocol ?? existing.protocol,
      updates.environment ?? existing.environment,
      updates.tags ? JSON.stringify(updates.tags) : existing.tags,
      updates.metadata ? JSON.stringify(updates.metadata) : existing.metadata,
      updates.relevant !== undefined ? (updates.relevant ? 1 : 0) : existing.relevant,
      updates.healthCheckUrl !== undefined ? updates.healthCheckUrl : existing.health_check_url,
      updates.notes ?? existing.notes,
      id
    );
    return this.getComponent(id);
  }

  deleteComponent(id) {
    this.stmts.deleteComponent.run(id);
    log.info('infra', `Component deleted: ${id}`);
  }

  updateComponentStatus(id, status) {
    this.stmts.updateStatus.run(status, id);
  }

  // ─── Access Control ──────────────────────────────────────────────

  /**
   * Set access level for an agent pattern on a component.
   * agent_pattern can be:
   *   - Specific agent ID: "Atlas-42"
   *   - Wildcard: "*" (all agents)
   *   - Gateway-scoped: "gw-0:*" (all agents on gateway 0)
   */
  setAccess(componentId, agentPattern, level, grantedBy = 'operator') {
    if (!ACCESS_LEVELS.includes(level)) {
      throw new Error(`Invalid access level: ${level}. Valid: ${ACCESS_LEVELS.join(', ')}`);
    }
    this.stmts.setAccess.run(componentId, agentPattern, level, grantedBy);
    log.info('infra', `Access set: ${agentPattern} → ${componentId} = ${level}`, { grantedBy });
  }

  removeAccess(componentId, agentPattern) {
    this.stmts.removeAccess.run(componentId, agentPattern);
  }

  /**
   * Resolve effective access level for a specific agent on a component.
   * Checks patterns in order: specific agent > gateway:* > *
   */
  resolveAccess(componentId, agentId, gatewayId) {
    const rules = this.stmts.getAccess.all(componentId);
    // Check most specific first
    const specific = rules.find(r => r.agent_pattern === agentId);
    if (specific) return specific.access_level;
    const gwWild = rules.find(r => r.agent_pattern === `${gatewayId}:*`);
    if (gwWild) return gwWild.access_level;
    const allWild = rules.find(r => r.agent_pattern === '*');
    if (allWild) return allWild.access_level;
    return 'none';
  }

  /**
   * Get all components an agent can access (filtered by access rules).
   * This is what gets served to agents via the API.
   */
  getAgentView(agentId, gatewayId) {
    // Get all relevant components
    const components = this.listComponents({ relevantOnly: true });
    const result = [];

    for (const comp of components) {
      const level = this.resolveAccess(comp.id, agentId, gatewayId);
      if (level === 'none') continue;

      // Build the agent-visible view (strip internal fields)
      const view = {
        id: comp.id,
        type: comp.type,
        name: comp.name,
        description: comp.description,
        host: comp.host,
        port: comp.port,
        protocol: comp.protocol,
        environment: comp.environment,
        tags: comp.tags,
        status: comp.status,
        accessLevel: level,
        // Only include metadata keys the agent needs
        metadata: comp.metadata,
        notes: level === 'read_write' ? comp.notes : undefined,
        // List available credentials (names only, not values)
        credentials: this.stmts.listByComponent.all(comp.id).map(cr => ({
          id: cr.id, name: cr.name, type: cr.credential_type,
        })),
      };
      result.push(view);
    }

    return result;
  }

  // ─── Credential Vault ────────────────────────────────────────────

  storeCredential(cred) {
    const id = cred.id || crypto.randomUUID().slice(0, 12);
    const encrypted = encrypt(cred.value, this.vaultKey);
    this.stmts.insertCredential.run(
      id, cred.componentId || null, cred.name,
      cred.type || 'api_key', encrypted,
      cred.username || '', JSON.stringify(cred.metadata || {}),
      cred.rotationPolicy || '', cred.expiresAt || null
    );
    log.info('vault', `Credential stored: ${cred.name}`, { id, type: cred.type });
    return { id, name: cred.name };
  }

  updateCredentialValue(credId, newValue) {
    const existing = this.stmts.getCredential.get(credId);
    if (!existing) throw new Error('Credential not found');
    const encrypted = encrypt(newValue, this.vaultKey);
    this.db.prepare(`UPDATE vault_credentials SET encrypted_value=?, last_rotated=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(encrypted, credId);
    log.info('vault', `Credential rotated: ${existing.name}`, { id: credId });
  }

  deleteCredential(credId) {
    this.stmts.deleteCredential.run(credId);
    log.info('vault', `Credential deleted: ${credId}`);
  }

  listCredentials() {
    return this.stmts.listCredentials.all().map(c => {
      c.metadata = JSON.parse(c.metadata || '{}');
      return c;
    });
  }

  /**
   * Checkout a credential — issues a time-limited lease.
   * The agent receives a lease ID, NOT the raw secret.
   * The raw value is only returned to the agent through a separate
   * redemption call that validates the lease + access level.
   */
  checkoutCredential(credId, agentId, taskId, leaseDurationMin = 60) {
    const cred = this.stmts.getCredential.get(credId);
    if (!cred) throw new Error('Credential not found');

    // Verify agent has access to the component this credential belongs to
    if (cred.component_id) {
      const component = this.stmts.getComponent.get(cred.component_id);
      if (!component) throw new Error('Associated component not found');
      // Access check is done at the API layer — caller must verify
    }

    const leaseId = crypto.randomUUID().slice(0, 16);
    const expiresAt = new Date(Date.now() + leaseDurationMin * 60000).toISOString();

    this.stmts.insertLease.run(leaseId, credId, agentId, taskId || null, expiresAt);
    this.stmts.logAccess.run(credId, agentId, 'checkout', null, expiresAt);

    log.info('vault', `Credential checked out: ${cred.name} → ${agentId}`, { leaseId, expiresMin: leaseDurationMin });

    return { leaseId, expiresAt, credentialName: cred.name, credentialType: cred.credential_type };
  }

  /**
   * Redeem a lease — returns the actual decrypted credential value.
   * Only valid leases that haven't expired or been revoked are honored.
   */
  redeemLease(leaseId) {
    const lease = this.stmts.getActiveLease.get(leaseId);
    if (!lease) throw new Error('Lease not found, expired, or revoked');

    const cred = this.stmts.getCredential.get(lease.credential_id);
    if (!cred) throw new Error('Credential no longer exists');

    this.stmts.logAccess.run(lease.credential_id, lease.agent_id, 'redeem', null, lease.expires_at);

    try {
      const value = decrypt(cred.encrypted_value, this.vaultKey);
      return {
        value,
        username: cred.username || undefined,
        type: cred.credential_type,
        expiresAt: lease.expires_at,
      };
    } catch (e) {
      log.error('vault', `Decryption failed for credential ${cred.id}: ${e.message}`);
      throw new Error('Credential decryption failed — vault key may have changed');
    }
  }

  revokeLease(leaseId) {
    this.stmts.revokeLease.run(leaseId);
    log.info('vault', `Lease revoked: ${leaseId}`);
  }

  revokeAllAgentLeases(agentId) {
    this.stmts.revokeAgentLeases.run(agentId);
    log.info('vault', `All leases revoked for agent: ${agentId}`);
  }

  getActiveLeases() {
    return this.stmts.listActiveLeases.all();
  }

  cleanupExpiredLeases() {
    this.stmts.cleanExpiredLeases.run();
  }

  // ─── Static Data ─────────────────────────────────────────────────

  static get COMPONENT_TYPES() { return COMPONENT_TYPES; }
  static get ACCESS_LEVELS() { return ACCESS_LEVELS; }
}

module.exports = { InfrastructureRegistry };
