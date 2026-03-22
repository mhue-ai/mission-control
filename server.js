/**
 * OpenClaw Mission Control — Main Server (Fixed)
 *
 * Fixes from review:
 * - Authentication middleware on all routes (JWT + cookie)
 * - WebSocket auth via token query parameter
 * - Structured logging (JSON-lines capable)
 * - /api/metrics endpoint for Prometheus-style monitoring
 * - Secret redaction in config API responses
 * - Workplan persistence via WorkplanStore
 * - Execution engine + watchdog wired to real services
 * - Phase dependency gating in dispatch
 * - Config backup/rollback support
 * - Rate limit awareness surfaced to API callers
 */

const http = require('http');
const { parse } = require('url');
const fs = require('fs');
const next = require('next');
const { WebSocketServer, WebSocket } = require('ws');
const Database = require('better-sqlite3');
const path = require('path');

// Load .env file (no dotenv dependency needed)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    if (eq < 0) return;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  });
}

const { GatewayConnector } = require('./lib/gateway-connector');
const { ExecutionEngine } = require('./lib/execution-engine');
const { AgentWatchdog } = require('./lib/agent-watchdog');
const { AuthMiddleware } = require('./lib/auth');
const { WorkplanStore } = require('./lib/workplan-store');
const { InfrastructureRegistry } = require('./lib/infrastructure-registry');
const { registerInfraRoutes } = require('./lib/infra-routes');
const { AgentStore } = require('./lib/agent-store');
const { KanbanStore } = require('./lib/kanban-store');
const log = require('./lib/logger');

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.MC_PORT || '3100', 10);
const hostname = process.env.MC_HOST || '127.0.0.1';

// ─── Database ─────────────────────────────────────────────────────
const dbPath = process.env.MC_DB_PATH || path.join(__dirname, 'data', 'mission-control.db');
require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
log.info('db', `SQLite opened at ${dbPath}`);

// Run schema migration
require('./scripts/setup-db');

// ─── Services ─────────────────────────────────────────────────────
const connector = new GatewayConnector();
const auth = new AuthMiddleware();
const workplanStore = new WorkplanStore(db);
const executionEngine = new ExecutionEngine(connector, db);
const watchdog = new AgentWatchdog(connector, db, {
  enabled: process.env.MC_WATCHDOG_ENABLED !== 'false',
  webhookUrl: process.env.MC_WATCHDOG_WEBHOOK_URL || null,
  slackWebhookUrl: process.env.MC_WATCHDOG_SLACK_URL || null,
});
const infraRegistry = new InfrastructureRegistry(db, process.env.MC_VAULT_KEY);
const agentStore = new AgentStore(db);
const kanbanStore = new KanbanStore(db);

// Periodic lease cleanup
setInterval(() => infraRegistry.cleanupExpiredLeases(), 3600000);

// ─── Connect gateways ─────────────────────────────────────────────
const gwConfig = process.env.MC_GATEWAYS || '';
if (gwConfig) {
  gwConfig.split(',').filter(Boolean).forEach(entry => {
    const [id, host, gwPort, token] = entry.split(':');
    if (id && host) {
      connector.addGateway(id, host, parseInt(gwPort || '18789'), token || null);
      log.info('gateway', `Registered ${id} → ${host}:${gwPort || 18789}`);
    }
  });
} else {
  log.warn('gateway', 'No gateways configured. Set MC_GATEWAYS in .env');
}

// ─── Service event wiring ─────────────────────────────────────────
const dashboardClients = new Set();
const startTime = Date.now();
let metricsCounters = { rpcCalls: 0, tasksDispatched: 0, tasksCompleted: 0, tasksFailed: 0, watchdogRestarts: 0, wsMessages: 0 };

function broadcast(event) {
  const payload = JSON.stringify(event);
  for (const client of dashboardClients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

connector.on('event', (ev) => { broadcast({ type: 'event', data: ev }); metricsCounters.wsMessages++; });
connector.on('gateway:connected', (d) => { broadcast({ type: 'gateway:connected', data: d }); log.info('gateway', `Connected: ${d.id}`); });
connector.on('gateway:disconnected', (d) => { broadcast({ type: 'gateway:disconnected', data: d }); log.warn('gateway', `Disconnected: ${d.id}`, d); });
connector.on('status:updated', () => broadcast({ type: 'state:updated', data: connector.getFleetState() }));
connector.on('approval:requested', (d) => broadcast({ type: 'approval:requested', data: d }));

executionEngine.on('task:dispatched', (d) => { broadcast({ type: 'task:dispatched', data: d }); metricsCounters.tasksDispatched++; });
executionEngine.on('task:completed', (d) => {
  broadcast({ type: 'task:completed', data: d });
  metricsCounters.tasksCompleted++;
  // Check phase progression
  if (d.workplanId) {
    const unlocked = workplanStore.checkPhaseProgression(d.workplanId);
    if (unlocked.length > 0) {
      broadcast({ type: 'phase:unlocked', data: { workplanId: d.workplanId, unlockedTasks: unlocked } });
      log.info('exec', `Phase progression: ${unlocked.length} tasks unlocked in workplan ${d.workplanId}`);
    }
  }
});
executionEngine.on('task:failed', (d) => { broadcast({ type: 'task:failed', data: d }); metricsCounters.tasksFailed++; });
executionEngine.on('task:retrying', (d) => broadcast({ type: 'task:retrying', data: d }));

watchdog.on('watchdog:action', (d) => { broadcast({ type: 'watchdog:action', data: d }); metricsCounters.watchdogRestarts++; });
watchdog.on('watchdog:escalation', (d) => { broadcast({ type: 'watchdog:escalation', data: d }); log.error('watchdog', d.message); });
watchdog.on('watchdog:agent-unhealthy', (d) => broadcast({ type: 'watchdog:unhealthy', data: d }));

// ─── Redact secrets from config objects ───────────────────────────
function redactSecrets(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const redacted = Array.isArray(obj) ? [...obj] : { ...obj };
  const secretKeys = ['token', 'apiKey', 'api_key', 'secret', 'password', 'apikey'];
  for (const key of Object.keys(redacted)) {
    if (secretKeys.some(sk => key.toLowerCase().includes(sk)) && typeof redacted[key] === 'string') {
      redacted[key] = redacted[key].slice(0, 4) + '••••••••';
    } else if (typeof redacted[key] === 'object') {
      redacted[key] = redactSecrets(redacted[key]);
    }
  }
  return redacted;
}

// ─── Start Server ─────────────────────────────────────────────────
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    const { pathname } = parsedUrl;

    // ─── Auth middleware ──────────────────────────────────
    const authMw = auth.httpAuth();
    authMw(req, res, () => {

      // ─── Auth routes (public) ──────────────────────────
      if (pathname === '/api/auth/login' && req.method === 'POST') {
        return auth.handleLogin(req, res);
      }
      if (pathname === '/api/auth/logout' && req.method === 'POST') {
        return auth.handleLogout(req, res);
      }

      // ─── Health (public) ───────────────────────────────
      if (pathname === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          status: 'ok', uptime: Math.round((Date.now() - startTime) / 1000),
          gateways: connector.gateways.size,
          connectedGateways: Array.from(connector.gateways.values()).filter(g => g.handshakeState === 'connected').length,
          watchdog: watchdog.enabled ? 'active' : 'disabled',
          activeWorkplans: workplanStore.listWorkplans().filter(w => w.status === 'active').length,
          timestamp: new Date().toISOString(),
        }));
      }

      // ─── Metrics (for Prometheus scraping) ─────────────
      if (pathname === '/api/metrics') {
        const fleet = connector.getFleetState();
        const wdStatus = watchdog.getStatus();
        const execStatus = executionEngine.getStatus();
        const lines = [
          `# HELP mc_gateways_total Total gateways configured`,
          `mc_gateways_total ${fleet.stats.totalGateways}`,
          `mc_gateways_connected ${fleet.stats.connectedGateways}`,
          `mc_agents_total ${fleet.stats.totalAgents}`,
          `mc_agents_online ${fleet.stats.onlineAgents}`,
          `mc_tokens_total ${fleet.stats.totalTokens}`,
          `mc_tasks_active ${execStatus.totalRunning}`,
          `mc_tasks_dispatched_total ${metricsCounters.tasksDispatched}`,
          `mc_tasks_completed_total ${metricsCounters.tasksCompleted}`,
          `mc_tasks_failed_total ${metricsCounters.tasksFailed}`,
          `mc_watchdog_restarts_total ${metricsCounters.watchdogRestarts}`,
          `mc_watchdog_healthy ${wdStatus.stats.healthy}`,
          `mc_watchdog_unhealthy ${wdStatus.stats.unhealthy}`,
          `mc_watchdog_escalated ${wdStatus.stats.escalated}`,
          `mc_ws_clients ${dashboardClients.size}`,
          `mc_uptime_seconds ${Math.round((Date.now() - startTime) / 1000)}`,
        ];
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end(lines.join('\n') + '\n');
      }

      // ─── Fleet state ───────────────────────────────────
      if (pathname === '/api/fleet' && req.method === 'GET') {
        const fleet = connector.getFleetState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(fleet));
      }

      // ─── Gateways ──────────────────────────────────────
      if (pathname === '/api/gateways' && req.method === 'GET') {
        const gateways = [];
        for (const [id, gw] of connector.gateways) {
          gateways.push({ id, host: gw.config.host, port: gw.config.port, ...gw.state, handshakeState: gw.handshakeState });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(gateways));
      }
      if (pathname === '/api/gateways' && req.method === 'POST') {
        return readBody(req, (body) => {
          try {
            const { id, host, port: gp, token } = body;
            connector.addGateway(id, host, gp || 18789, token || null);
            json(res, 201, { ok: true, id });
          } catch (e) { json(res, 400, { error: e.message }); }
        });
      }
      if (pathname.startsWith('/api/gateways/') && req.method === 'DELETE') {
        const gwId = pathname.split('/').pop();
        connector.removeGateway(gwId);
        return json(res, 200, { ok: true });
      }

      // ─── Config management ─────────────────────────────
      if (pathname.match(/^\/api\/gateways\/[^/]+\/config$/) && req.method === 'GET') {
        const gwId = pathname.split('/')[3];
        connector.getConfig(gwId)
          .then(cfg => json(res, 200, { config: redactSecrets(cfg?.payload || cfg), hash: cfg?.hash }))
          .catch(e => json(res, 500, { error: e.message }));
        return;
      }
      if (pathname.match(/^\/api\/gateways\/[^/]+\/config$/) && req.method === 'PATCH') {
        const gwId = pathname.split('/')[3];
        return readBody(req, async (body) => {
          try {
            const result = await connector.patchConfig(gwId, body.patch, { backup: true });
            json(res, result.ok ? 200 : 500, result);
          } catch (e) { json(res, 500, { error: e.message }); }
        });
      }
      if (pathname.match(/^\/api\/gateways\/[^/]+\/config\/schema$/) && req.method === 'GET') {
        const gwId = pathname.split('/')[3];
        connector.getConfigSchema(gwId)
          .then(schema => json(res, 200, schema))
          .catch(e => json(res, 500, { error: e.message }));
        return;
      }
      if (pathname.match(/^\/api\/gateways\/[^/]+\/config\/rollback$/) && req.method === 'POST') {
        const gwId = pathname.split('/')[3];
        return readBody(req, async (body) => {
          try {
            const result = await connector.rollbackConfig(gwId, body.backup);
            json(res, 200, { ok: true, result });
          } catch (e) { json(res, 500, { error: e.message }); }
        });
      }

      // ─── Workplans ─────────────────────────────────────
      if (pathname === '/api/workplans' && req.method === 'GET') {
        return json(res, 200, workplanStore.listWorkplans());
      }
      if (pathname === '/api/workplans' && req.method === 'POST') {
        return readBody(req, (body) => {
          try {
            const wp = workplanStore.createWorkplan(body);
            json(res, 201, wp);
          } catch (e) { json(res, 400, { error: e.message }); }
        });
      }
      if (pathname.match(/^\/api\/workplans\/[^/]+$/) && req.method === 'GET') {
        const wpId = pathname.split('/').pop();
        const wp = workplanStore.getWorkplan(wpId);
        return wp ? json(res, 200, wp) : json(res, 404, { error: 'Not found' });
      }
      if (pathname.match(/^\/api\/workplans\/[^/]+$/) && req.method === 'PATCH') {
        const wpId = pathname.split('/').pop();
        return readBody(req, (body) => {
          const wp = workplanStore.updateWorkplan(wpId, body);
          wp ? json(res, 200, wp) : json(res, 404, { error: 'Not found' });
        });
      }
      if (pathname.match(/^\/api\/workplans\/[^/]+$/) && req.method === 'DELETE') {
        const wpId = pathname.split('/').pop();
        workplanStore.deleteWorkplan(wpId);
        return json(res, 200, { ok: true });
      }
      if (pathname.match(/^\/api\/workplans\/[^/]+\/activate$/) && req.method === 'POST') {
        const wpId = pathname.split('/')[3];
        try {
          const wp = workplanStore.activateWorkplan(wpId);
          json(res, 200, wp);
        } catch (e) { json(res, 400, { error: e.message }); }
        return;
      }
      if (pathname.match(/^\/api\/workplans\/[^/]+\/dispatch$/) && req.method === 'POST') {
        const wpId = pathname.split('/')[3];
        const wp = workplanStore.getWorkplan(wpId);
        if (!wp) return json(res, 404, { error: 'Not found' });
        const agents = Array.from(connector.agents.values());
        executionEngine.dispatchWorkplan(wp, agents)
          .then(d => json(res, 200, { dispatched: d }))
          .catch(e => json(res, 500, { error: e.message }));
        return;
      }

      // ─── Task operations ───────────────────────────────
      if (pathname.match(/^\/api\/tasks\/[^/]+$/) && req.method === 'PATCH') {
        const taskId = pathname.split('/').pop();
        return readBody(req, (body) => {
          const task = workplanStore.updateTask(taskId, body);
          task ? json(res, 200, task) : json(res, 404, { error: 'Not found' });
        });
      }
      if (pathname.match(/^\/api\/tasks\/[^/]+\/dispatch$/) && req.method === 'POST') {
        const taskId = pathname.split('/')[3];
        return readBody(req, async (body) => {
          try {
            const taskRow = db.prepare('SELECT * FROM workplan_tasks WHERE id=?').get(taskId);
            if (!taskRow) return json(res, 404, { error: 'Task not found' });
            const agent = connector.agents.get(`${body.gatewayId}:${body.agentId}`);
            if (!agent) return json(res, 400, { error: 'Agent not found' });
            const result = await executionEngine.dispatch({
              id: taskRow.id, name: taskRow.name, instruction: taskRow.instruction,
              priority: taskRow.priority, retries: taskRow.retries,
              maxRetries: taskRow.max_retries, timeoutMs: taskRow.timeout_ms,
              workplanId: taskRow.workplan_id,
            }, body.agentId, body.gatewayId);
            workplanStore.updateTaskStatus(taskId, 'running');
            json(res, 200, { ok: true, activeTask: result });
          } catch (e) { json(res, 500, { error: e.message }); }
        });
      }

      // ─── Approvals ─────────────────────────────────────
      if (pathname === '/api/approvals/resolve' && req.method === 'POST') {
        return readBody(req, async (body) => {
          try {
            await connector.resolveApproval(body.gatewayId, body.approvalId, body.approved, body.reason);
            json(res, 200, { ok: true });
          } catch (e) { json(res, 500, { error: e.message }); }
        });
      }

      // ─── Heartbeat trigger ─────────────────────────────
      if (pathname === '/api/heartbeat' && req.method === 'POST') {
        return readBody(req, async (body) => {
          try {
            await connector.triggerHeartbeat(body.gatewayId, body.agentId);
            json(res, 200, { ok: true });
          } catch (e) { json(res, 500, { error: e.message }); }
        });
      }

      // ─── Watchdog ──────────────────────────────────────
      if (pathname === '/api/watchdog' && req.method === 'GET') {
        return json(res, 200, watchdog.getStatus());
      }
      if (pathname === '/api/watchdog/policy' && req.method === 'PATCH') {
        return readBody(req, (body) => {
          watchdog.updatePolicy(body);
          json(res, 200, { ok: true, policy: watchdog.policy });
        });
      }
      if (pathname === '/api/watchdog/toggle' && req.method === 'POST') {
        return readBody(req, (body) => {
          body.enabled ? watchdog.start() : watchdog.stop();
          json(res, 200, { ok: true, enabled: watchdog.enabled });
        });
      }
      if (pathname.match(/^\/api\/watchdog\/reset\//) && req.method === 'POST') {
        const agentKey = decodeURIComponent(pathname.split('/').pop());
        watchdog.resetAgent(agentKey);
        return json(res, 200, { ok: true });
      }

      // ─── Execution engine status ───────────────────────
      if (pathname === '/api/execution' && req.method === 'GET') {
        return json(res, 200, executionEngine.getStatus());
      }

      // ─── Events ────────────────────────────────────────
      if (pathname === '/api/events' && req.method === 'GET') {
        return json(res, 200, connector.events.slice(0, 200));
      }

      // ─── Infrastructure & Vault ──────────────────────────
      if (pathname.startsWith('/api/infra/') || pathname.startsWith('/api/vault/')) {
        const handled = registerInfraRoutes(pathname, req, res, infraRegistry, auth);
        if (handled) return;
      }

      // ─── Managed Agents ─────────────────────────────────
      if (pathname === '/api/agents' && req.method === 'GET') {
        return json(res, 200, agentStore.listAgents());
      }
      if (pathname === '/api/agents' && req.method === 'POST') {
        return readBody(req, (body) => {
          try { json(res, 201, agentStore.createAgent(body)); }
          catch (e) { json(res, 400, { error: e.message }); }
        });
      }
      if (pathname.match(/^\/api\/agents\/[^/]+$/) && req.method === 'GET') {
        const id = pathname.split('/').pop();
        const agent = agentStore.getAgent(id);
        return agent ? json(res, 200, agent) : json(res, 404, { error: 'Not found' });
      }
      if (pathname.match(/^\/api\/agents\/[^/]+$/) && req.method === 'PATCH') {
        const id = pathname.split('/').pop();
        return readBody(req, (body) => {
          const agent = agentStore.updateAgent(id, body);
          agent ? json(res, 200, agent) : json(res, 404, { error: 'Not found' });
        });
      }
      if (pathname.match(/^\/api\/agents\/[^/]+$/) && req.method === 'DELETE') {
        const id = pathname.split('/').pop();
        agentStore.deleteAgent(id);
        return json(res, 200, { ok: true });
      }
      if (pathname.match(/^\/api\/agents\/[^/]+\/start$/) && req.method === 'POST') {
        agentStore.startAgent(pathname.split('/')[3]);
        return json(res, 200, { ok: true });
      }
      if (pathname.match(/^\/api\/agents\/[^/]+\/pause$/) && req.method === 'POST') {
        agentStore.pauseAgent(pathname.split('/')[3]);
        return json(res, 200, { ok: true });
      }
      if (pathname.match(/^\/api\/agents\/[^/]+\/stop$/) && req.method === 'POST') {
        agentStore.stopAgent(pathname.split('/')[3]);
        return json(res, 200, { ok: true });
      }
      if (pathname.match(/^\/api\/agents\/[^/]+\/restart$/) && req.method === 'POST') {
        agentStore.restartAgent(pathname.split('/')[3]);
        return json(res, 200, { ok: true });
      }
      if (pathname.match(/^\/api\/agents\/[^/]+\/activate$/) && req.method === 'POST') {
        agentStore.activateAgent(pathname.split('/')[3]);
        return json(res, 200, { ok: true });
      }

      // ─── Managed Gateways ───────────────────────────────
      if (pathname === '/api/managed-gateways' && req.method === 'GET') {
        return json(res, 200, agentStore.listGateways());
      }
      if (pathname === '/api/managed-gateways' && req.method === 'POST') {
        return readBody(req, (body) => {
          try { json(res, 201, agentStore.createGateway(body)); }
          catch (e) { json(res, 400, { error: e.message }); }
        });
      }
      if (pathname.match(/^\/api\/managed-gateways\/[^/]+$/) && req.method === 'PATCH') {
        const id = pathname.split('/').pop();
        return readBody(req, (body) => {
          const gw = agentStore.updateGateway(id, body);
          gw ? json(res, 200, gw) : json(res, 404, { error: 'Not found' });
        });
      }
      if (pathname.match(/^\/api\/managed-gateways\/[^/]+$/) && req.method === 'DELETE') {
        agentStore.deleteGateway(pathname.split('/').pop());
        return json(res, 200, { ok: true });
      }

      // ─── Kanban ─────────────────────────────────────────
      if (pathname === '/api/kanban/boards' && req.method === 'GET') {
        return json(res, 200, kanbanStore.listBoards());
      }
      if (pathname.match(/^\/api\/kanban\/boards\/[^/]+$/) && req.method === 'GET') {
        const board = kanbanStore.getFullBoard(pathname.split('/').pop());
        return board ? json(res, 200, board) : json(res, 404, { error: 'Not found' });
      }
      if (pathname === '/api/kanban/boards' && req.method === 'POST') {
        return readBody(req, (body) => {
          json(res, 201, kanbanStore.createBoard(body.name, body.description));
        });
      }
      if (pathname === '/api/kanban/cards' && req.method === 'POST') {
        return readBody(req, (body) => {
          try {
            const card = kanbanStore.createCard(body.boardId, body.columnId, body);
            json(res, 201, card);
          } catch (e) { json(res, 400, { error: e.message }); }
        });
      }
      if (pathname.match(/^\/api\/kanban\/cards\/[^/]+$/) && req.method === 'PATCH') {
        const id = pathname.split('/').pop();
        return readBody(req, (body) => {
          const card = kanbanStore.updateCard(id, body);
          card ? json(res, 200, card) : json(res, 404, { error: 'Not found' });
        });
      }
      if (pathname.match(/^\/api\/kanban\/cards\/[^/]+\/move$/) && req.method === 'POST') {
        const id = pathname.split('/')[4];
        return readBody(req, (body) => {
          try {
            const card = kanbanStore.moveCard(id, body.columnId, body.order);
            json(res, 200, card);
          } catch (e) { json(res, 400, { error: e.message }); }
        });
      }
      if (pathname.match(/^\/api\/kanban\/cards\/[^/]+$/) && req.method === 'DELETE') {
        kanbanStore.deleteCard(pathname.split('/').pop());
        return json(res, 200, { ok: true });
      }

      // ─── Next.js fallthrough ───────────────────────────
      handle(req, res, parsedUrl);
    });
  });

  // ─── WebSocket with auth ────────────────────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url);
    if (pathname !== '/ws') { socket.destroy(); return; }

    // Authenticate WebSocket connection
    const user = auth.wsAuth(req);
    if (!user) {
      log.warn('ws', 'WebSocket connection rejected: no valid token');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    log.info('ws', `Dashboard client connected from ${req.socket.remoteAddress}`);
    dashboardClients.add(ws);

    ws.send(JSON.stringify({ type: 'state:initial', data: connector.getFleetState() }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        metricsCounters.wsMessages++;
        switch (msg.type) {
          case 'gateway:call':
            connector.call(msg.gatewayId, msg.method, msg.params || {}).catch(() => {});
            metricsCounters.rpcCalls++;
            break;
          case 'approval:resolve':
            connector.resolveApproval(msg.gatewayId, msg.approvalId, msg.approved, msg.reason).catch(() => {});
            break;
          case 'heartbeat:trigger':
            connector.triggerHeartbeat(msg.gatewayId, msg.agentId).catch(() => {});
            break;
        }
      } catch (e) {
        log.warn('ws', `Bad message from client: ${e.message}`);
      }
    });

    ws.on('close', () => {
      dashboardClients.delete(ws);
      log.debug('ws', 'Dashboard client disconnected');
    });
  });

  // ─── Periodic state broadcast ───────────────────────────────────
  setInterval(() => {
    if (dashboardClients.size > 0) {
      broadcast({ type: 'state:updated', data: connector.getFleetState() });
    }
  }, parseInt(process.env.MC_HEALTH_POLL_INTERVAL || '15000'));

  // ─── Listen ─────────────────────────────────────────────────────
  server.listen(port, hostname, () => {
    log.info('server', `Mission Control listening on http://${hostname}:${port}`);
    log.info('server', `Gateways: ${connector.gateways.size} configured`);
    log.info('server', `Watchdog: ${watchdog.enabled ? 'active' : 'disabled'}`);
    log.info('server', `Auth: ${process.env.MC_ADMIN_PASSWORD ? 'configured' : 'NOT CONFIGURED — set MC_ADMIN_PASSWORD'}`);
  });

  // ─── Graceful shutdown ──────────────────────────────────────────
  const shutdown = (signal) => {
    log.info('server', `${signal} received, shutting down...`);
    watchdog.stop();
    executionEngine.destroy();
    connector.destroy();
    wss.close();
    db.close();
    server.close(() => {
      log.info('server', 'Shutdown complete');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
});

// ─── Helpers ──────────────────────────────────────────────────────
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req, cb) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try { cb(JSON.parse(body)); }
    catch (e) { json(req.res || arguments[1], 400, { error: 'Invalid JSON' }); }
  });
}
