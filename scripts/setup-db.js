/**
 * Database Schema — Mission Control v2 (Fixed)
 * Now includes: workplan tables, config backups, and audit log
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.MC_DB_PATH || path.join(__dirname, '..', 'data', 'mission-control.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- Gateway configurations
  CREATE TABLE IF NOT EXISTS gateways (
    id TEXT PRIMARY KEY,
    host TEXT NOT NULL,
    port INTEGER DEFAULT 18789,
    token TEXT,
    label TEXT,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Tasks (standalone, not workplan-linked)
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    agent_id TEXT,
    gateway_id TEXT,
    state TEXT DEFAULT 'queued' CHECK(state IN ('queued','running','completed','failed','paused','cancelled','retrying')),
    priority TEXT DEFAULT 'normal' CHECK(priority IN ('critical','high','normal','low')),
    retries INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    error TEXT,
    result TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT
  );

  -- Event log
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gateway_id TEXT,
    agent_id TEXT,
    event_type TEXT NOT NULL,
    message TEXT,
    payload TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Workplans
  CREATE TABLE IF NOT EXISTS workplans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft','active','paused','completed','archived')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workplan_phases (
    id TEXT PRIMARY KEY,
    workplan_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phase_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (workplan_id) REFERENCES workplans(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workplan_tasks (
    id TEXT PRIMARY KEY,
    phase_id TEXT NOT NULL,
    workplan_id TEXT NOT NULL,
    name TEXT NOT NULL,
    instruction TEXT DEFAULT '',
    assigned_agent TEXT,
    status TEXT DEFAULT 'idle' CHECK(status IN ('idle','queued','running','completed','failed','paused','retrying')),
    priority TEXT DEFAULT 'normal' CHECK(priority IN ('critical','high','normal','low')),
    retries INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    timeout_ms INTEGER DEFAULT 300000,
    error TEXT,
    result TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (phase_id) REFERENCES workplan_phases(id) ON DELETE CASCADE,
    FOREIGN KEY (workplan_id) REFERENCES workplans(id) ON DELETE CASCADE
  );

  -- Config backup snapshots
  CREATE TABLE IF NOT EXISTS config_backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gateway_id TEXT NOT NULL,
    config_hash TEXT,
    config_json TEXT NOT NULL,
    reason TEXT DEFAULT 'pre-apply backup',
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Approval audit trail
  CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    gateway_id TEXT NOT NULL,
    agent_id TEXT,
    command TEXT,
    approved INTEGER,
    resolved_by TEXT,
    reason TEXT,
    requested_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
  CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
  CREATE INDEX IF NOT EXISTS idx_wt_status ON workplan_tasks(status);
  CREATE INDEX IF NOT EXISTS idx_wt_phase ON workplan_tasks(phase_id);
  CREATE INDEX IF NOT EXISTS idx_wt_workplan ON workplan_tasks(workplan_id);
  CREATE INDEX IF NOT EXISTS idx_wp_phase_workplan ON workplan_phases(workplan_id);
  CREATE INDEX IF NOT EXISTS idx_config_backups_gw ON config_backups(gateway_id);

  -- Prune old events (keep 30 days by default)
  DELETE FROM events WHERE created_at < datetime('now', '-30 days');
`);

console.log('✓ Database schema initialized at', DB_PATH);
db.close();
