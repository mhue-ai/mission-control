/**
 * Agent & Gateway Store
 * 
 * Manages the lifecycle of gateways and agents:
 * - Gateway CRUD (add, edit, remove, test connection)
 * - Agent onboarding (register, set access, activate)
 * - Agent lifecycle (start, pause, stop, restart, remove)
 * - Seeds two demo agents on first run
 */

const crypto = require('crypto');
const log = require('./logger');

class AgentStore {
  constructor(db) {
    this.db = db;
    this._migrate();
    this._prepare();
    this._seedDemoAgents();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS managed_gateways (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER DEFAULT 18789,
        token TEXT DEFAULT '',
        status TEXT DEFAULT 'disconnected',
        version TEXT DEFAULT '',
        last_seen TEXT,
        enabled INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS managed_agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        gateway_id TEXT,
        model TEXT DEFAULT '',
        role TEXT DEFAULT 'general',
        status TEXT DEFAULT 'idle' CHECK(status IN ('idle','running','paused','stopped','error','onboarding')),
        channel TEXT DEFAULT '',
        workspace TEXT DEFAULT '',
        heartbeat_interval TEXT DEFAULT '30m',
        max_concurrent INTEGER DEFAULT 5,
        tokens_used INTEGER DEFAULT 0,
        cost_usd REAL DEFAULT 0,
        sessions_active INTEGER DEFAULT 0,
        memory_mb INTEGER DEFAULT 0,
        last_heartbeat TEXT,
        restarts INTEGER DEFAULT 0,
        notes TEXT DEFAULT '',
        enabled INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (gateway_id) REFERENCES managed_gateways(id) ON DELETE SET NULL
      );
    `);
  }

  _prepare() {
    this.s = {
      // Gateways
      insertGw: this.db.prepare(`INSERT INTO managed_gateways (id, label, host, port, token, status) VALUES (?, ?, ?, ?, ?, ?)`),
      updateGw: this.db.prepare(`UPDATE managed_gateways SET label=?, host=?, port=?, token=?, enabled=?, updated_at=datetime('now') WHERE id=?`),
      deleteGw: this.db.prepare(`DELETE FROM managed_gateways WHERE id=?`),
      getGw: this.db.prepare(`SELECT * FROM managed_gateways WHERE id=?`),
      listGw: this.db.prepare(`SELECT * FROM managed_gateways ORDER BY created_at`),
      updateGwStatus: this.db.prepare(`UPDATE managed_gateways SET status=?, version=?, last_seen=datetime('now') WHERE id=?`),

      // Agents
      insertAgent: this.db.prepare(`INSERT INTO managed_agents (id, name, gateway_id, model, role, status, channel, workspace, heartbeat_interval, max_concurrent, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      updateAgent: this.db.prepare(`UPDATE managed_agents SET name=?, gateway_id=?, model=?, role=?, channel=?, workspace=?, heartbeat_interval=?, max_concurrent=?, notes=?, updated_at=datetime('now') WHERE id=?`),
      deleteAgent: this.db.prepare(`DELETE FROM managed_agents WHERE id=?`),
      getAgent: this.db.prepare(`SELECT * FROM managed_agents WHERE id=?`),
      listAgents: this.db.prepare(`SELECT a.*, g.label as gateway_label, g.host as gateway_host, g.port as gateway_port FROM managed_agents a LEFT JOIN managed_gateways g ON a.gateway_id = g.id ORDER BY a.created_at`),
      updateAgentStatus: this.db.prepare(`UPDATE managed_agents SET status=?, updated_at=datetime('now') WHERE id=?`),
      updateAgentStats: this.db.prepare(`UPDATE managed_agents SET tokens_used=?, cost_usd=?, sessions_active=?, memory_mb=?, last_heartbeat=datetime('now'), updated_at=datetime('now') WHERE id=?`),
      incrementRestarts: this.db.prepare(`UPDATE managed_agents SET restarts=restarts+1, updated_at=datetime('now') WHERE id=?`),
    };
  }

  _seedDemoAgents() {
    const existing = this.s.listAgents.all();
    if (existing.length > 0) return;

    log.info('agent-store', 'Seeding demo gateway and agents');

    // Demo gateway
    this.s.insertGw.run('demo-gw', 'Demo Gateway', '127.0.0.1', 18789, '', 'disconnected');

    // Two demo agents
    this.s.insertAgent.run(
      'demo-atlas', 'Atlas', 'demo-gw', 'claude-sonnet-4-6', 'Software Development',
      'idle', 'webchat', '~/.openclaw/workspace-atlas', '30m', 5,
      'Demo agent for software development tasks. Handles code reviews, bug fixes, and feature implementation.'
    );
    this.s.insertAgent.run(
      'demo-nova', 'Nova', 'demo-gw', 'claude-sonnet-4-6', 'Operations & Monitoring',
      'idle', 'webchat', '~/.openclaw/workspace-nova', '30m', 3,
      'Demo agent for infrastructure monitoring, email triage, and operational tasks.'
    );

    log.info('agent-store', 'Demo agents seeded: Atlas (dev), Nova (ops)');
  }

  // ─── Gateway CRUD ──────────────────────────────────────────────

  createGateway(gw) {
    const id = gw.id || 'gw-' + crypto.randomUUID().slice(0, 8);
    this.s.insertGw.run(id, gw.label || gw.host, gw.host, gw.port || 18789, gw.token || '', gw.status || 'disconnected');
    log.info('agent-store', `Gateway created: ${id} → ${gw.host}:${gw.port || 18789}`);
    return this.s.getGw.get(id);
  }

  updateGateway(id, updates) {
    const existing = this.s.getGw.get(id);
    if (!existing) return null;
    this.s.updateGw.run(
      updates.label ?? existing.label,
      updates.host ?? existing.host,
      updates.port ?? existing.port,
      updates.token ?? existing.token,
      updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : existing.enabled,
      id
    );
    return this.s.getGw.get(id);
  }

  deleteGateway(id) {
    this.s.deleteGw.run(id);
    log.info('agent-store', `Gateway deleted: ${id}`);
  }

  getGateway(id) { return this.s.getGw.get(id); }
  listGateways() { return this.s.listGw.all(); }

  updateGatewayStatus(id, status, version) {
    this.s.updateGwStatus.run(status, version || '', id);
  }

  // ─── Agent CRUD ────────────────────────────────────────────────

  createAgent(agent) {
    const id = agent.id || 'agent-' + crypto.randomUUID().slice(0, 8);
    this.s.insertAgent.run(
      id, agent.name, agent.gatewayId || null, agent.model || '',
      agent.role || 'general', agent.status || 'onboarding',
      agent.channel || '', agent.workspace || '',
      agent.heartbeatInterval || '30m', agent.maxConcurrent || 5,
      agent.notes || ''
    );
    log.info('agent-store', `Agent created: ${id} (${agent.name})`);
    return this.getAgent(id);
  }

  updateAgent(id, updates) {
    const existing = this.s.getAgent.get(id);
    if (!existing) return null;
    this.s.updateAgent.run(
      updates.name ?? existing.name,
      updates.gatewayId !== undefined ? updates.gatewayId : existing.gateway_id,
      updates.model ?? existing.model,
      updates.role ?? existing.role,
      updates.channel ?? existing.channel,
      updates.workspace ?? existing.workspace,
      updates.heartbeatInterval ?? existing.heartbeat_interval,
      updates.maxConcurrent ?? existing.max_concurrent,
      updates.notes ?? existing.notes,
      id
    );
    return this.getAgent(id);
  }

  deleteAgent(id) {
    this.s.deleteAgent.run(id);
    log.info('agent-store', `Agent removed: ${id}`);
  }

  getAgent(id) { return this.s.getAgent.get(id); }
  listAgents() { return this.s.listAgents.all(); }

  // ─── Agent lifecycle ───────────────────────────────────────────

  setAgentStatus(id, status) {
    this.s.updateAgentStatus.run(status, id);
    log.info('agent-store', `Agent ${id} → ${status}`);
  }

  startAgent(id) { this.setAgentStatus(id, 'running'); }
  pauseAgent(id) { this.setAgentStatus(id, 'paused'); }
  stopAgent(id) { this.setAgentStatus(id, 'stopped'); }
  restartAgent(id) {
    this.s.incrementRestarts.run(id);
    this.setAgentStatus(id, 'running');
  }

  updateAgentStats(id, stats) {
    this.s.updateAgentStats.run(
      stats.tokensUsed || 0,
      stats.costUsd || 0,
      stats.sessionsActive || 0,
      stats.memoryMb || 0,
      id
    );
  }

  activateAgent(id) {
    this.setAgentStatus(id, 'idle');
    log.info('agent-store', `Agent ${id} onboarding complete → idle`);
  }
}

module.exports = { AgentStore };
