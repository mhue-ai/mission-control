/**
 * OpenClaw Gateway Connector — Protocol v3
 * 
 * Fixed issues from review:
 * - Correct connect handshake with minProtocol/maxProtocol negotiation
 * - Challenge-nonce exchange before RPC
 * - operator.write scope for chat.send and config.patch
 * - Request ID correlation (not method-name matching)
 * - Idempotency keys on side-effecting calls
 * - Loopback bind awareness: documents that gateways need bind:"lan" or tunnel
 * - Rate limit tracking for config.apply/config.patch (3/60s)
 * - Exponential backoff reconnect with jitter
 */

const WebSocket = require('ws');
const EventEmitter = require('events');
const crypto = require('crypto');

const PROTOCOL_VERSION = 3;
const CONFIG_RATE_LIMIT = { max: 3, windowMs: 60000 };

class GatewayConnector extends EventEmitter {
  constructor(config = {}) {
    super();
    this.gateways = new Map();
    this.agents = new Map();
    this.sessions = new Map();
    this.events = [];
    this._pendingRpc = new Map();      // reqId -> { resolve, reject, timeout, method }
    this._reconnectTimers = new Map();
    this._healthPollers = new Map();
    this._configRateLimits = new Map(); // gatewayId -> [timestamps]
    this.rpcTimeout = config.rpcTimeout || 15000;
    this.maxEvents = config.maxEvents || 2000;
  }

  // ─── Public API ──────────────────────────────────────────────────

  addGateway(id, host, port = 18789, token = null, options = {}) {
    if (this.gateways.has(id)) {
      this.removeGateway(id);
    }
    const gw = {
      config: { id, host, port, token, useTunnel: options.useTunnel || false },
      ws: null,
      state: {
        status: 'connecting',
        protocolVersion: null,
        version: null,
        uptime: null,
        agents: [],
        channels: [],
        tokensUsed: 0,
        tokensBudget: 0,
        lastHealthCheck: null,
        configHash: null,
      },
      handshakeState: 'pending', // pending -> challenged -> connected
    };
    this.gateways.set(id, gw);
    this._configRateLimits.set(id, []);
    this._connect(id);
    return this;
  }

  removeGateway(id) {
    const gw = this.gateways.get(id);
    if (gw?.ws) gw.ws.close(1000, 'removed');
    const timer = this._reconnectTimers.get(id);
    if (timer) clearTimeout(timer);
    this._reconnectTimers.delete(id);
    const poller = this._healthPollers.get(id);
    if (poller) clearInterval(poller);
    this._healthPollers.delete(id);
    // Reject pending RPCs for this gateway
    for (const [reqId, pending] of this._pendingRpc) {
      if (reqId.startsWith(id + ':')) {
        pending.reject(new Error('Gateway removed'));
        clearTimeout(pending.timeout);
        this._pendingRpc.delete(reqId);
      }
    }
    this.gateways.delete(id);
    this._configRateLimits.delete(id);
    // Clean up agents belonging to this gateway
    for (const [key] of this.agents) {
      if (key.startsWith(id + ':')) this.agents.delete(key);
    }
    this.emit('gateway:removed', { id });
  }

  /**
   * Send an RPC call and return a promise for the response.
   * Uses request ID correlation per the protocol spec.
   */
  async call(gatewayId, method, params = {}, options = {}) {
    const gw = this.gateways.get(gatewayId);
    if (!gw || gw.handshakeState !== 'connected') {
      throw new Error(`Gateway ${gatewayId} not connected (state: ${gw?.handshakeState || 'unknown'})`);
    }
    if (!gw.ws || gw.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Gateway ${gatewayId} WebSocket not open`);
    }

    // Rate limit check for config operations
    if (method === 'config.apply' || method === 'config.patch') {
      if (!this._checkConfigRateLimit(gatewayId)) {
        throw new Error(`Rate limited: config operations capped at ${CONFIG_RATE_LIMIT.max} per ${CONFIG_RATE_LIMIT.windowMs / 1000}s`);
      }
    }

    const reqId = `${gatewayId}:${crypto.randomUUID()}`;
    const frame = {
      type: 'req',
      id: reqId,
      method,
      params,
    };

    // Add idempotency key for side-effecting methods
    if (this._isSideEffecting(method)) {
      frame.idempotencyKey = options.idempotencyKey || crypto.randomUUID();
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingRpc.delete(reqId);
        reject(new Error(`RPC timeout: ${method} on ${gatewayId} after ${this.rpcTimeout}ms`));
      }, options.timeout || this.rpcTimeout);

      this._pendingRpc.set(reqId, { resolve, reject, timeout, method, gatewayId });
      gw.ws.send(JSON.stringify(frame));
    });
  }

  /**
   * Fire-and-forget send (for cases where we don't need the response)
   */
  send(gatewayId, method, params = {}) {
    const gw = this.gateways.get(gatewayId);
    if (!gw?.ws || gw.ws.readyState !== WebSocket.OPEN || gw.handshakeState !== 'connected') return;
    const reqId = `${gatewayId}:${crypto.randomUUID()}`;
    const frame = { type: 'req', id: reqId, method, params };
    if (this._isSideEffecting(method)) {
      frame.idempotencyKey = crypto.randomUUID();
    }
    gw.ws.send(JSON.stringify(frame));
  }

  /**
   * Dispatch a message to an agent session (for task execution)
   * Requires operator.write scope
   */
  async sendAgentMessage(gatewayId, sessionKey, message, metadata = {}) {
    return this.call(gatewayId, 'chat.send', {
      sessionKey,
      message,
      metadata: { source: 'mission-control', ...metadata },
    }, {
      idempotencyKey: metadata.taskId ? `dispatch:${metadata.taskId}` : undefined,
      timeout: 30000,
    });
  }

  async triggerHeartbeat(gatewayId, agentId) {
    return this.call(gatewayId, 'system.heartbeat', { agentId, mode: 'now' });
  }

  async getConfig(gatewayId) {
    const result = await this.call(gatewayId, 'config.get', {});
    const gw = this.gateways.get(gatewayId);
    if (gw && result?.hash) gw.state.configHash = result.hash;
    return result;
  }

  async patchConfig(gatewayId, patch, options = {}) {
    const gw = this.gateways.get(gatewayId);
    if (!gw) throw new Error(`Gateway ${gatewayId} not found`);

    // Snapshot current config for rollback
    let backup = null;
    if (options.backup !== false) {
      try { backup = await this.getConfig(gatewayId); }
      catch (e) { console.warn(`[${gatewayId}] Could not snapshot config for backup: ${e.message}`); }
    }

    try {
      const result = await this.call(gatewayId, 'config.patch', {
        patch,
        baseHash: gw.state.configHash || undefined,
        sessionKey: options.sessionKey,
        restartDelayMs: options.restartDelayMs || 2000,
      });
      if (result?.hash) gw.state.configHash = result.hash;
      return { ok: true, result, backup };
    } catch (e) {
      return { ok: false, error: e.message, backup };
    }
  }

  async applyConfig(gatewayId, rawConfig, options = {}) {
    const gw = this.gateways.get(gatewayId);
    if (!gw) throw new Error(`Gateway ${gatewayId} not found`);

    let backup = null;
    if (options.backup !== false) {
      try { backup = await this.getConfig(gatewayId); }
      catch (e) { /* non-fatal */ }
    }

    try {
      const result = await this.call(gatewayId, 'config.apply', {
        raw: rawConfig,
        baseHash: gw.state.configHash || undefined,
        sessionKey: options.sessionKey,
        restartDelayMs: options.restartDelayMs || 2000,
      });
      if (result?.hash) gw.state.configHash = result.hash;
      return { ok: true, result, backup };
    } catch (e) {
      return { ok: false, error: e.message, backup };
    }
  }

  async rollbackConfig(gatewayId, backup) {
    if (!backup?.raw && !backup?.payload) {
      throw new Error('No backup data to rollback to');
    }
    const raw = backup.raw || JSON.stringify(backup.payload);
    return this.call(gatewayId, 'config.apply', { raw });
  }

  async getConfigSchema(gatewayId) {
    return this.call(gatewayId, 'config.schema', {});
  }

  async resolveApproval(gatewayId, approvalId, approved, reason = '') {
    return this.call(gatewayId, 'exec.approval.resolve', { id: approvalId, approved, reason });
  }

  /**
   * Get session status for an agent (used by execution engine to detect idle)
   */
  async getSessionStatus(gatewayId, sessionKey) {
    return this.call(gatewayId, 'sessions.get', { sessionKey });
  }

  /**
   * List active sessions on a gateway
   */
  async listSessions(gatewayId) {
    return this.call(gatewayId, 'sessions.list', {});
  }

  getFleetState() {
    const gatewayStates = [];
    for (const [id, gw] of this.gateways) {
      gatewayStates.push({
        id, host: gw.config.host, port: gw.config.port,
        ...gw.state, handshakeState: gw.handshakeState,
      });
    }
    return {
      gateways: gatewayStates,
      agents: Array.from(this.agents.values()),
      sessions: Array.from(this.sessions.values()),
      events: this.events.slice(0, 200),
      stats: {
        totalGateways: this.gateways.size,
        connectedGateways: gatewayStates.filter(g => g.handshakeState === 'connected').length,
        totalAgents: this.agents.size,
        onlineAgents: Array.from(this.agents.values()).filter(a => (Date.now() - (a.lastSeen || 0)) < 300000).length,
        totalSessions: this.sessions.size,
        totalTokens: gatewayStates.reduce((s, g) => s + (g.tokensUsed || 0), 0),
      },
    };
  }

  destroy() {
    for (const [id] of this.gateways) this.removeGateway(id);
    this._pendingRpc.clear();
  }

  // ─── Private: Connection ─────────────────────────────────────────

  _connect(id) {
    const gw = this.gateways.get(id);
    if (!gw) return;
    const { host, port, token } = gw.config;

    // IMPORTANT: OpenClaw gateway binds to loopback by default.
    // For cross-network access, the gateway must have:
    //   gateway.bind: "lan"   (or "tailnet", or a specific IP)
    //   gateway.auth.mode: "token"  (required for non-loopback)
    //   gateway.auth.token: "<secret>"
    //
    // Alternatively, use SSH tunnel: ssh -L 18789:127.0.0.1:18789 user@gateway-host
    // Or Tailscale: the gateway can use bind:"tailnet" with allowTailscale:true

    const url = `ws://${host}:${port}`;
    gw.handshakeState = 'pending';
    gw.state.status = 'connecting';

    try {
      const ws = new WebSocket(url, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        handshakeTimeout: 10000,
      });

      ws.on('open', () => {
        gw.ws = ws;
        gw.state.status = 'handshaking';
        // Wait for connect.challenge event from server before sending connect
      });

      ws.on('message', (data) => {
        try {
          const frame = JSON.parse(data.toString());
          this._handleFrame(id, frame);
        } catch (e) {
          console.error(`[${id}] Bad frame:`, e.message);
        }
      });

      ws.on('close', (code, reason) => {
        gw.state.status = 'disconnected';
        gw.handshakeState = 'pending';
        gw.ws = null;
        this.emit('gateway:disconnected', { id, code, reason: reason?.toString() });
        this._scheduleReconnect(id);
      });

      ws.on('error', (err) => {
        const msg = err.message;
        if (msg.includes('ECONNREFUSED')) {
          console.error(`[${id}] Connection refused at ${host}:${port}. Check: (1) gateway is running, (2) gateway.bind is set to "lan" or tunnel is active, (3) firewall allows port ${port}`);
        } else {
          console.error(`[${id}] WebSocket error: ${msg}`);
        }
        gw.state.status = 'error';
      });

    } catch (err) {
      console.error(`[${id}] Connection failed:`, err.message);
      gw.state.status = 'error';
      this._scheduleReconnect(id);
    }
  }

  // ─── Private: Frame handling ─────────────────────────────────────

  _handleFrame(id, frame) {
    switch (frame.type) {
      case 'event':
        this._handleEvent(id, frame);
        break;
      case 'res':
        this._handleResponse(id, frame);
        break;
      case 'req':
        // Server-initiated request (rare, e.g. exec.approval.requested)
        this._handleServerRequest(id, frame);
        break;
    }
  }

  _handleEvent(id, frame) {
    const { event, payload } = frame;
    const gw = this.gateways.get(id);

    switch (event) {
      case 'connect.challenge': {
        // Server sends challenge nonce; we respond with connect params
        if (gw && gw.handshakeState === 'pending') {
          gw.handshakeState = 'challenged';
          this._sendConnectRequest(id, payload?.nonce, payload?.ts);
        }
        break;
      }

      case 'tick':
        // Gateway liveness tick — update last-seen
        if (gw) gw.state.lastTick = Date.now();
        break;

      case 'shutdown':
        this.emit('gateway:shutdown', { id });
        break;

      case 'exec.approval.requested':
        this._pushEvent(id, 'approval_requested', `Exec approval: ${payload?.rawCommand || '?'}`, payload);
        this.emit('approval:requested', { gateway: id, ...payload });
        break;

      case 'snapshot':
        // Full state snapshot from gateway
        if (gw && payload) {
          this._processSnapshot(id, payload);
        }
        break;

      default:
        // Agent-level events
        this._pushEvent(id, event, `${event}: ${JSON.stringify(payload).slice(0, 120)}`, payload);
        this.emit('event', { id: crypto.randomUUID().slice(0, 8), ts: Date.now(), gateway: id, type: event, payload });
        break;
    }
  }

  _handleResponse(id, frame) {
    const { ok, payload, error } = frame;
    const reqId = frame.id;
    const pending = this._pendingRpc.get(reqId);

    if (!pending) {
      // Check if this is the connect response (hello-ok)
      if (payload?.type === 'hello-ok') {
        this._onConnected(id, payload);
      }
      return;
    }

    clearTimeout(pending.timeout);
    this._pendingRpc.delete(reqId);

    if (ok) {
      // Process specific response types for state updates
      this._processRpcResult(id, pending.method, payload);
      pending.resolve(payload);
    } else {
      const errMsg = error?.message || error?.code || 'Unknown RPC error';
      console.error(`[${id}] RPC error for ${pending.method}: ${errMsg}`);
      pending.reject(new Error(errMsg));
    }
  }

  _handleServerRequest(id, frame) {
    // Server-initiated requests (e.g., requesting approval resolution)
    this.emit('gateway:server-request', { gateway: id, ...frame });
  }

  // ─── Private: Handshake ──────────────────────────────────────────

  _sendConnectRequest(id, nonce, ts) {
    const gw = this.gateways.get(id);
    if (!gw?.ws) return;

    const connectFrame = {
      type: 'req',
      id: `${id}:connect:${Date.now()}`,
      method: 'connect',
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: 'mission-control',
          version: '2.0.0',
          platform: 'linux',
          mode: 'operator',
        },
        role: 'operator',
        scopes: [
          'operator.read',
          'operator.write',      // Required for chat.send, config operations
          'operator.approvals',  // Required for exec.approval.resolve
          'operator.admin',      // Required for config.apply persistent writes
        ],
        caps: [],
        commands: [],
        permissions: {},
        auth: gw.config.token ? { token: gw.config.token } : {},
        locale: 'en-US',
        userAgent: 'mission-control/2.0.0',
        device: {
          id: `mc-${crypto.createHash('sha256').update(require('os').hostname()).digest('hex').slice(0, 16)}`,
        },
        // Echo nonce for challenge verification
        ...(nonce ? { challenge: { nonce, ts } } : {}),
      },
    };

    gw.ws.send(JSON.stringify(connectFrame));
  }

  _onConnected(id, helloPayload) {
    const gw = this.gateways.get(id);
    if (!gw) return;

    gw.handshakeState = 'connected';
    gw.state.status = 'connected';
    gw.state.protocolVersion = helloPayload.protocol;
    gw.state.tickIntervalMs = helloPayload.policy?.tickIntervalMs || 15000;

    // If hello-ok includes a device token, store it for reconnection
    if (helloPayload.deviceToken) {
      gw.config.deviceToken = helloPayload.deviceToken;
    }

    console.log(`[${id}] Connected. Protocol v${helloPayload.protocol}`);
    this.emit('gateway:connected', { id, host: gw.config.host, port: gw.config.port, protocol: helloPayload.protocol });

    // Start health polling
    this._startHealthPolling(id);

    // Fetch initial state
    this._fetchInitialState(id);
  }

  // ─── Private: State management ───────────────────────────────────

  async _fetchInitialState(id) {
    try {
      await this.call(id, 'health', {});
      await this.call(id, 'status', {});
      await this.call(id, 'channels.status', {});
      const configResult = await this.call(id, 'config.get', {});
      const gw = this.gateways.get(id);
      if (gw && configResult?.hash) gw.state.configHash = configResult.hash;
    } catch (e) {
      console.error(`[${id}] Initial state fetch failed: ${e.message}`);
    }
  }

  _processRpcResult(id, method, payload) {
    if (!payload) return;
    const gw = this.gateways.get(id);
    if (!gw) return;

    switch (method) {
      case 'health':
        gw.state.lastHealthCheck = Date.now();
        gw.state.uptime = payload.uptime;
        gw.state.version = payload.version;
        this.emit('gateway:health', { id, health: payload });
        break;

      case 'status':
        this._processSnapshot(id, payload);
        break;

      case 'channels.status':
        gw.state.channels = payload.channels || [];
        break;

      case 'sessions.list':
        if (payload.sessions) {
          payload.sessions.forEach(s => {
            this.sessions.set(s.id || s.sessionKey, { ...s, gateway: id });
          });
        }
        break;

      case 'sessions.get':
        // Individual session status — used by execution engine
        break;

      case 'config.get':
        if (payload.hash) gw.state.configHash = payload.hash;
        break;
    }
  }

  _processSnapshot(id, snapshot) {
    const gw = this.gateways.get(id);
    if (!gw) return;

    if (snapshot.agents) {
      snapshot.agents.forEach(agent => {
        const agentKey = `${id}:${agent.id}`;
        this.agents.set(agentKey, {
          ...agent,
          gateway: id,
          gatewayHost: gw.config.host,
          lastSeen: Date.now(),
        });
      });
      gw.state.agents = snapshot.agents.map(a => a.id);
    }

    if (snapshot.usage) {
      gw.state.tokensUsed = snapshot.usage.totalTokens || 0;
      gw.state.tokensBudget = snapshot.usage.budget || 5000000;
    }

    this.emit('status:updated', { gateway: id });
  }

  _startHealthPolling(id) {
    if (this._healthPollers.has(id)) clearInterval(this._healthPollers.get(id));

    const gw = this.gateways.get(id);
    const interval = gw?.state.tickIntervalMs || 15000;

    const poller = setInterval(() => {
      if (this.gateways.get(id)?.handshakeState === 'connected') {
        // Fire-and-forget health polls
        this.send(id, 'health', {});
        this.send(id, 'status', {});
      }
    }, interval);

    this._healthPollers.set(id, poller);
  }

  // ─── Private: Utilities ──────────────────────────────────────────

  _isSideEffecting(method) {
    const sideEffecting = new Set([
      'chat.send', 'config.apply', 'config.patch', 'config.reload',
      'exec.approval.resolve', 'system.heartbeat', 'cron.add',
      'cron.enable', 'cron.disable', 'cron.remove', 'cron.run',
      'sessions.reset', 'sessions.delete', 'update.run',
    ]);
    return sideEffecting.has(method);
  }

  _checkConfigRateLimit(gatewayId) {
    const timestamps = this._configRateLimits.get(gatewayId) || [];
    const now = Date.now();
    const recent = timestamps.filter(t => (now - t) < CONFIG_RATE_LIMIT.windowMs);
    if (recent.length >= CONFIG_RATE_LIMIT.max) return false;
    recent.push(now);
    this._configRateLimits.set(gatewayId, recent);
    return true;
  }

  _pushEvent(gatewayId, type, message, payload) {
    const event = {
      id: crypto.randomUUID().slice(0, 8),
      ts: Date.now(),
      gateway: gatewayId,
      type,
      message,
      payload,
    };
    this.events.unshift(event);
    if (this.events.length > this.maxEvents) {
      this.events.length = this.maxEvents;
    }
    this.emit('event', event);
  }

  _scheduleReconnect(id) {
    if (this._reconnectTimers.has(id)) return;
    const gw = this.gateways.get(id);
    if (!gw) return;

    // Track reconnect attempts for exponential backoff
    gw._reconnectAttempt = (gw._reconnectAttempt || 0) + 1;
    const baseDelay = 3000;
    const maxDelay = 120000;
    const delay = Math.min(baseDelay * Math.pow(1.5, gw._reconnectAttempt - 1), maxDelay);
    // Add jitter: ±25%
    const jitter = delay * (0.75 + Math.random() * 0.5);

    console.log(`[${id}] Reconnecting in ${Math.round(jitter / 1000)}s (attempt ${gw._reconnectAttempt})`);

    const timer = setTimeout(() => {
      this._reconnectTimers.delete(id);
      if (this.gateways.has(id)) {
        this._connect(id);
      }
    }, jitter);

    this._reconnectTimers.set(id, timer);
  }
}

module.exports = { GatewayConnector };
