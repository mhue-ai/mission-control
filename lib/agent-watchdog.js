/**
 * Agent Watchdog v2 — Fixed
 *
 * Fixes from review:
 * - Per-agent restart sequence: heartbeat probe → config.reload → gateway restart (last resort)
 * - Session-aware health: checks if agent has active sessions before declaring dead
 *   (a 10-minute code review won't trigger false-positive restarts)
 * - Webhook/Slack escalation when retries are exhausted
 * - Clear distinction between "agent crashed" vs "agent busy on long task"
 * - Structured event log for audit trail
 */

const EventEmitter = require('events');
const https = require('https');
const http = require('http');

class AgentWatchdog extends EventEmitter {
  constructor(connector, db, options = {}) {
    super();
    this.connector = connector;
    this.db = db;
    this.enabled = options.enabled !== false;

    this.policy = {
      checkIntervalMs: options.checkIntervalMs || 60000,
      heartbeatStaleThresholdMs: options.heartbeatStaleThresholdMs || 300000,
      maxRestartAttempts: options.maxRestartAttempts || 5,
      cooldownMs: options.cooldownMs || 30000,
      escalateAfterConsecutive: options.escalateAfterConsecutive || 3,
      // New: don't restart agents that have active sessions with recent tool calls
      busyAgentGracePeriodMs: options.busyAgentGracePeriodMs || 600000, // 10min
    };

    // Escalation targets
    this.escalation = {
      webhookUrl: options.webhookUrl || null,
      slackWebhookUrl: options.slackWebhookUrl || null,
      emailTo: options.emailTo || null,
    };

    this.agentHealth = new Map();
    this._checkInterval = null;
    this._eventLog = [];

    if (this.enabled) this.start();
  }

  // ─── Lifecycle ───────────────────────────────────────────────────

  start() {
    this.enabled = true;
    this.connector.on('event', (ev) => this._handleEvent(ev));
    this.connector.on('gateway:connected', (d) => this._onGatewayUp(d));
    this.connector.on('gateway:disconnected', (d) => this._onGatewayDown(d));

    this._checkInterval = setInterval(() => this._runHealthCheck(), this.policy.checkIntervalMs);
    this._logAction(null, null, 'watchdog_started', `Policy: check every ${this.policy.checkIntervalMs / 1000}s, stale after ${this.policy.heartbeatStaleThresholdMs / 1000}s`);
    this.emit('watchdog:started', { policy: this.policy });
  }

  stop() {
    this.enabled = false;
    if (this._checkInterval) clearInterval(this._checkInterval);
    this._checkInterval = null;
    this._logAction(null, null, 'watchdog_stopped', 'Watchdog disabled');
    this.emit('watchdog:stopped');
  }

  updatePolicy(updates) {
    Object.assign(this.policy, updates);
    if (updates.checkIntervalMs && this._checkInterval) {
      clearInterval(this._checkInterval);
      this._checkInterval = setInterval(() => this._runHealthCheck(), this.policy.checkIntervalMs);
    }
    this._logAction(null, null, 'policy_updated', JSON.stringify(this.policy));
    this.emit('watchdog:policy-updated', { policy: this.policy });
  }

  updateEscalation(targets) {
    Object.assign(this.escalation, targets);
  }

  // ─── Health Check Loop ───────────────────────────────────────────

  async _runHealthCheck() {
    if (!this.enabled) return;
    const now = Date.now();

    for (const [agentKey, agent] of this.connector.agents) {
      const health = this._getHealth(agentKey);

      // Skip if in cooldown
      if (now < health.cooldownUntil) continue;

      // Skip if already escalated — operator must manually reset
      if (health.status === 'escalated') continue;

      const lastActivity = Math.max(
        health.lastSeen,
        agent.lastHeartbeat || 0,
        agent.lastSeen || 0
      );
      const staleness = now - lastActivity;

      if (staleness > this.policy.heartbeatStaleThresholdMs) {
        // Agent appears stale — but is it busy or actually dead?
        const [gatewayId, agentId] = agentKey.split(':');

        const isBusy = await this._isAgentBusy(gatewayId, agentId, agentKey);

        if (isBusy) {
          // Agent has an active session with recent tool activity
          // This is likely a long-running task, not a crash
          if (staleness < this.policy.busyAgentGracePeriodMs) {
            health.status = 'busy';
            this._logAction(gatewayId, agentId, 'busy_grace',
              `Agent appears busy (active session). Grace period: ${Math.round((this.policy.busyAgentGracePeriodMs - staleness) / 1000)}s remaining`);
            continue;
          }
          // Even busy agents get checked if they exceed the grace period
          this._logAction(gatewayId, agentId, 'busy_timeout',
            `Busy agent exceeded grace period (${Math.round(staleness / 1000)}s). Probing.`);
        }

        // Agent is stale and not busy — initiate recovery
        await this._handleUnhealthy(agentKey, gatewayId, agentId,
          isBusy ? 'busy but exceeded grace period' : `stale heartbeat (${Math.round(staleness / 1000)}s)`);
      } else {
        // Agent is healthy
        if (health.status !== 'healthy') {
          health.status = 'healthy';
          health.consecutiveFailures = 0;
        }
      }
    }
  }

  /**
   * Check if an agent is actively working (has sessions with recent tool calls).
   * This prevents restarting an agent that's doing a 10-minute code review.
   */
  async _isAgentBusy(gatewayId, agentId, agentKey) {
    try {
      const sessions = await this.connector.listSessions(gatewayId);
      if (!sessions?.sessions) return false;

      const agentSessions = sessions.sessions.filter(s =>
        s.sessionKey?.includes(agentId) && s.status === 'active'
      );

      for (const session of agentSessions) {
        // If the session has tool calls in flight, agent is busy
        if (session.toolCallsInFlight) return true;

        // If the session was updated recently, agent is busy
        const updatedAt = session.updatedAt ? new Date(session.updatedAt).getTime() : 0;
        if (Date.now() - updatedAt < this.policy.heartbeatStaleThresholdMs) return true;
      }

      return false;
    } catch (e) {
      // If we can't check session status, assume not busy (err on side of recovery)
      return false;
    }
  }

  // ─── Recovery Sequence ───────────────────────────────────────────
  // Graduated: probe → per-agent restart → config reload → gateway restart → escalate

  async _handleUnhealthy(agentKey, gatewayId, agentId, reason) {
    const health = this._getHealth(agentKey);
    health.consecutiveFailures++;
    health.status = 'unhealthy';

    this._logAction(gatewayId, agentId, 'unhealthy',
      `Failure #${health.consecutiveFailures}: ${reason}`);
    this.emit('watchdog:agent-unhealthy', {
      agentKey, gatewayId, agentId, reason,
      consecutiveFailures: health.consecutiveFailures,
      restartAttempts: health.restartAttempts,
    });

    const attempt = health.restartAttempts;

    if (attempt === 0) {
      // Step 1: Gentle probe — trigger an immediate heartbeat
      await this._probeAgent(agentKey, gatewayId, agentId);
    } else if (attempt === 1) {
      // Step 2: Trigger heartbeat with mode:"now" — more forceful
      await this._forceHeartbeat(agentKey, gatewayId, agentId);
    } else if (attempt === 2) {
      // Step 3: Config reload — resets stuck agent state without full restart
      await this._reloadConfig(agentKey, gatewayId, agentId);
    } else if (attempt < this.policy.maxRestartAttempts) {
      // Step 4: Full gateway restart — nuclear option, affects all agents on this gateway
      await this._restartGateway(agentKey, gatewayId, agentId);
    } else {
      // Step 5: Escalate — we've exhausted all recovery options
      await this._escalate(agentKey, gatewayId, agentId, reason);
    }
  }

  async _probeAgent(agentKey, gatewayId, agentId) {
    const health = this._getHealth(agentKey);
    health.restartAttempts++;
    health.lastAction = { type: 'probe', at: Date.now() };
    health.cooldownUntil = Date.now() + this.policy.cooldownMs;

    try {
      await this.connector.triggerHeartbeat(gatewayId, agentId);
      this._logAction(gatewayId, agentId, 'probe_sent', 'Triggered immediate heartbeat');
    } catch (e) {
      this._logAction(gatewayId, agentId, 'probe_failed', `Heartbeat trigger failed: ${e.message}`);
    }

    this.emit('watchdog:action', { action: 'probe', agentKey, gatewayId, agentId });
  }

  async _forceHeartbeat(agentKey, gatewayId, agentId) {
    const health = this._getHealth(agentKey);
    health.restartAttempts++;
    health.lastAction = { type: 'force_heartbeat', at: Date.now() };
    health.cooldownUntil = Date.now() + this.policy.cooldownMs * 1.5;

    try {
      await this.connector.call(gatewayId, 'system.heartbeat', { agentId, mode: 'now' });
      this._logAction(gatewayId, agentId, 'force_heartbeat', 'Forced system heartbeat');
    } catch (e) {
      this._logAction(gatewayId, agentId, 'force_heartbeat_failed', e.message);
    }

    this.emit('watchdog:action', { action: 'force_heartbeat', agentKey, gatewayId, agentId });
  }

  async _reloadConfig(agentKey, gatewayId, agentId) {
    const health = this._getHealth(agentKey);
    health.restartAttempts++;
    health.lastAction = { type: 'config_reload', at: Date.now() };
    health.cooldownUntil = Date.now() + this.policy.cooldownMs * 2;

    try {
      await this.connector.call(gatewayId, 'config.reload', {});
      this._logAction(gatewayId, agentId, 'config_reload', 'Triggered config reload on gateway');
    } catch (e) {
      this._logAction(gatewayId, agentId, 'config_reload_failed', e.message);
    }

    this.emit('watchdog:action', { action: 'config_reload', agentKey, gatewayId, agentId });
  }

  async _restartGateway(agentKey, gatewayId, agentId) {
    const health = this._getHealth(agentKey);
    health.restartAttempts++;
    health.lastAction = { type: 'gateway_restart', at: Date.now() };
    health.cooldownUntil = Date.now() + this.policy.cooldownMs * 4; // Longer cooldown for restart

    this._logAction(gatewayId, agentId, 'gateway_restart',
      `GATEWAY RESTART (attempt ${health.restartAttempts}/${this.policy.maxRestartAttempts}) — this affects ALL agents on ${gatewayId}`);

    try {
      await this.connector.call(gatewayId, 'gateway.restart', {});
    } catch (e) {
      this._logAction(gatewayId, agentId, 'gateway_restart_failed', e.message);
    }

    this.emit('watchdog:action', { action: 'gateway_restart', agentKey, gatewayId, agentId, attempt: health.restartAttempts });
  }

  // ─── Escalation ──────────────────────────────────────────────────

  async _escalate(agentKey, gatewayId, agentId, reason) {
    const health = this._getHealth(agentKey);
    health.status = 'escalated';
    health.lastAction = { type: 'escalated', at: Date.now() };

    const message = `🚨 WATCHDOG ESCALATION: Agent ${agentId} on gateway ${gatewayId} unrecoverable after ${health.restartAttempts} attempts. Reason: ${reason}. Manual intervention required.`;

    this._logAction(gatewayId, agentId, 'escalation', message);
    this.emit('watchdog:escalation', { agentKey, gatewayId, agentId, reason, restartAttempts: health.restartAttempts, message });

    // Send to all configured escalation targets
    const promises = [];

    if (this.escalation.webhookUrl) {
      promises.push(this._sendWebhook(this.escalation.webhookUrl, {
        event: 'watchdog_escalation',
        agentId, gatewayId, reason,
        restartAttempts: health.restartAttempts,
        message,
        timestamp: new Date().toISOString(),
      }));
    }

    if (this.escalation.slackWebhookUrl) {
      promises.push(this._sendWebhook(this.escalation.slackWebhookUrl, {
        text: message,
        blocks: [{
          type: 'section',
          text: { type: 'mrkdwn', text: `*Watchdog Escalation*\n${message}` },
        }],
      }));
    }

    await Promise.allSettled(promises);
  }

  /**
   * Manual reset — operator acknowledges the escalation and resets the agent health
   */
  resetAgent(agentKey) {
    const health = this.agentHealth.get(agentKey);
    if (health) {
      health.status = 'unknown';
      health.consecutiveFailures = 0;
      health.restartAttempts = 0;
      health.cooldownUntil = 0;
      health.lastAction = { type: 'manual_reset', at: Date.now() };
      this._logAction(null, null, 'manual_reset', `Operator reset ${agentKey}`);
    }
  }

  // ─── Event Handling ──────────────────────────────────────────────

  _handleEvent(event) {
    if (!this.enabled) return;

    // Extract agent key from event
    let agentKey = null;
    if (event.payload?.agentId && event.gateway) {
      agentKey = `${event.gateway}:${event.payload.agentId}`;
    }

    switch (event.type) {
      case 'agent.heartbeat':
      case 'tick':
        if (agentKey) this._markHealthy(agentKey);
        break;

      case 'session.created':
      case 'session.message':
        if (agentKey) this._markHealthy(agentKey);
        break;

      case 'agent_stopped':
      case 'agent.disconnected':
        if (agentKey) {
          const [gw, ag] = agentKey.split(':');
          this._handleUnhealthy(agentKey, gw, ag, `event: ${event.type}`);
        }
        break;
    }
  }

  _onGatewayUp(data) {
    for (const [key, health] of this.agentHealth) {
      if (key.startsWith(data.id + ':')) {
        health.status = 'unknown';
      }
    }
  }

  _onGatewayDown(data) {
    for (const [key, health] of this.agentHealth) {
      if (key.startsWith(data.id + ':')) {
        health.status = 'gateway-down';
        this.emit('watchdog:gateway-down', { gatewayId: data.id, agentKey: key });
      }
    }
  }

  // ─── Utilities ───────────────────────────────────────────────────

  _getHealth(agentKey) {
    if (!this.agentHealth.has(agentKey)) {
      this.agentHealth.set(agentKey, {
        lastSeen: Date.now(),
        consecutiveFailures: 0,
        restartAttempts: 0,
        cooldownUntil: 0,
        status: 'unknown',
        lastAction: null,
      });
    }
    return this.agentHealth.get(agentKey);
  }

  _markHealthy(agentKey) {
    const health = this._getHealth(agentKey);
    health.lastSeen = Date.now();
    if (health.status === 'unhealthy' || health.status === 'busy') {
      this._logAction(null, null, 'recovered', `${agentKey} recovered`);
    }
    health.status = 'healthy';
    health.consecutiveFailures = 0;
    health.restartAttempts = 0;
  }

  _logAction(gatewayId, agentId, type, message) {
    const entry = { ts: Date.now(), gatewayId, agentId, type, message };
    this._eventLog.unshift(entry);
    if (this._eventLog.length > 500) this._eventLog.length = 500;

    if (this.db) {
      try {
        this.db.prepare(
          `INSERT INTO events (gateway_id, agent_id, event_type, message, created_at) VALUES (?, ?, ?, ?, datetime('now'))`
        ).run(gatewayId, agentId, `watchdog:${type}`, message);
      } catch (e) { /* non-fatal */ }
    }
  }

  async _sendWebhook(url, payload) {
    return new Promise((resolve) => {
      try {
        const urlObj = new URL(url);
        const body = JSON.stringify(payload);
        const lib = urlObj.protocol === 'https:' ? https : http;
        const req = lib.request(urlObj, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
          timeout: 10000,
        }, (res) => resolve({ status: res.statusCode }));
        req.on('error', (e) => { console.error(`[watchdog] Webhook failed: ${e.message}`); resolve({ error: e.message }); });
        req.write(body);
        req.end();
      } catch (e) {
        console.error(`[watchdog] Webhook error: ${e.message}`);
        resolve({ error: e.message });
      }
    });
  }

  getStatus() {
    const agents = Array.from(this.agentHealth.entries()).map(([key, h]) => ({ agentKey: key, ...h }));
    return {
      enabled: this.enabled,
      policy: this.policy,
      escalation: {
        webhookConfigured: !!this.escalation.webhookUrl,
        slackConfigured: !!this.escalation.slackWebhookUrl,
      },
      agents,
      eventLog: this._eventLog.slice(0, 100),
      stats: {
        healthy: agents.filter(a => a.status === 'healthy').length,
        unhealthy: agents.filter(a => a.status === 'unhealthy').length,
        busy: agents.filter(a => a.status === 'busy').length,
        escalated: agents.filter(a => a.status === 'escalated').length,
        totalRestarts: agents.reduce((s, a) => s + a.restartAttempts, 0),
      },
    };
  }
}

module.exports = { AgentWatchdog };
