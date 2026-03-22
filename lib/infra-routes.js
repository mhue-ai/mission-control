/**
 * Infrastructure & Vault API Routes
 * 
 * Mounted in server.js. Provides:
 * - /api/infra/* — Component CRUD, access matrix
 * - /api/vault/* — Credential storage, checkout/redeem/revoke
 * - /api/infra/agent-view — Agent-facing endpoint (filtered by access)
 * - /api/infra/types — Component type taxonomy
 */

function registerInfraRoutes(pathname, req, res, registry, auth) {

  // ─── Component type taxonomy ─────────────────────────────────
  if (pathname === '/api/infra/types' && req.method === 'GET') {
    return json(res, 200, {
      componentTypes: require('./infrastructure-registry').InfrastructureRegistry.COMPONENT_TYPES,
      accessLevels: require('./infrastructure-registry').InfrastructureRegistry.ACCESS_LEVELS,
    });
  }

  // ─── Agent-facing view (filtered by access rules) ────────────
  if (pathname === '/api/infra/agent-view' && req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const agentId = url.searchParams.get('agentId');
    const gatewayId = url.searchParams.get('gatewayId');
    if (!agentId) return json(res, 400, { error: 'agentId required' });
    const view = registry.getAgentView(agentId, gatewayId || '');
    return json(res, 200, view);
  }

  // ─── List components ─────────────────────────────────────────
  if (pathname === '/api/infra/components' && req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const relevantOnly = url.searchParams.get('relevant') === 'true';
    const type = url.searchParams.get('type');
    const components = type
      ? registry.listByType(type)
      : registry.listComponents({ relevantOnly });
    return json(res, 200, components);
  }

  // ─── Create component ────────────────────────────────────────
  if (pathname === '/api/infra/components' && req.method === 'POST') {
    return readBody(req, res, (body) => {
      try {
        const comp = registry.createComponent(body);
        json(res, 201, comp);
      } catch (e) { json(res, 400, { error: e.message }); }
    });
  }

  // ─── Get single component ────────────────────────────────────
  if (pathname.match(/^\/api\/infra\/components\/[^/]+$/) && req.method === 'GET') {
    const id = pathname.split('/').pop();
    const comp = registry.getComponent(id);
    return comp ? json(res, 200, comp) : json(res, 404, { error: 'Not found' });
  }

  // ─── Update component ────────────────────────────────────────
  if (pathname.match(/^\/api\/infra\/components\/[^/]+$/) && req.method === 'PATCH') {
    const id = pathname.split('/').pop();
    return readBody(req, res, (body) => {
      try {
        const comp = registry.updateComponent(id, body);
        comp ? json(res, 200, comp) : json(res, 404, { error: 'Not found' });
      } catch (e) { json(res, 400, { error: e.message }); }
    });
  }

  // ─── Delete component ────────────────────────────────────────
  if (pathname.match(/^\/api\/infra\/components\/[^/]+$/) && req.method === 'DELETE') {
    const id = pathname.split('/').pop();
    registry.deleteComponent(id);
    return json(res, 200, { ok: true });
  }

  // ─── Set access ──────────────────────────────────────────────
  if (pathname === '/api/infra/access' && req.method === 'POST') {
    return readBody(req, res, (body) => {
      try {
        registry.setAccess(body.componentId, body.agentPattern, body.accessLevel, body.grantedBy || 'operator');
        json(res, 200, { ok: true });
      } catch (e) { json(res, 400, { error: e.message }); }
    });
  }

  // ─── Remove access ───────────────────────────────────────────
  if (pathname === '/api/infra/access' && req.method === 'DELETE') {
    return readBody(req, res, (body) => {
      registry.removeAccess(body.componentId, body.agentPattern);
      json(res, 200, { ok: true });
    });
  }

  // ─── Get access rules for a component ────────────────────────
  if (pathname.match(/^\/api\/infra\/components\/[^/]+\/access$/) && req.method === 'GET') {
    const id = pathname.split('/')[4];
    const rules = registry.stmts.getAccess.all(id);
    return json(res, 200, rules);
  }

  // ═══ Vault Routes ════════════════════════════════════════════

  // ─── List credentials (metadata only, no values) ─────────────
  if (pathname === '/api/vault/credentials' && req.method === 'GET') {
    return json(res, 200, registry.listCredentials());
  }

  // ─── Store credential ────────────────────────────────────────
  if (pathname === '/api/vault/credentials' && req.method === 'POST') {
    return readBody(req, res, (body) => {
      try {
        if (!body.value) return json(res, 400, { error: 'value required' });
        const cred = registry.storeCredential(body);
        json(res, 201, cred);
      } catch (e) { json(res, 400, { error: e.message }); }
    });
  }

  // ─── Update credential value ─────────────────────────────────
  if (pathname.match(/^\/api\/vault\/credentials\/[^/]+$/) && req.method === 'PATCH') {
    const id = pathname.split('/').pop();
    return readBody(req, res, (body) => {
      try {
        if (body.value) registry.updateCredentialValue(id, body.value);
        json(res, 200, { ok: true });
      } catch (e) { json(res, 400, { error: e.message }); }
    });
  }

  // ─── Delete credential ───────────────────────────────────────
  if (pathname.match(/^\/api\/vault\/credentials\/[^/]+$/) && req.method === 'DELETE') {
    const id = pathname.split('/').pop();
    registry.deleteCredential(id);
    return json(res, 200, { ok: true });
  }

  // ─── Checkout credential (agent-facing) ──────────────────────
  if (pathname === '/api/vault/checkout' && req.method === 'POST') {
    return readBody(req, res, (body) => {
      try {
        if (!body.credentialId || !body.agentId) {
          return json(res, 400, { error: 'credentialId and agentId required' });
        }
        // Verify agent has access to the credential's component
        const cred = registry.stmts.getCredential.get(body.credentialId);
        if (!cred) return json(res, 404, { error: 'Credential not found' });
        if (cred.component_id) {
          const level = registry.resolveAccess(cred.component_id, body.agentId, body.gatewayId || '');
          if (level === 'none') {
            return json(res, 403, { error: 'Agent does not have access to this component' });
          }
        }
        const lease = registry.checkoutCredential(body.credentialId, body.agentId, body.taskId, body.leaseDurationMin || 60);
        json(res, 200, lease);
      } catch (e) { json(res, 400, { error: e.message }); }
    });
  }

  // ─── Redeem lease (agent-facing) ─────────────────────────────
  if (pathname === '/api/vault/redeem' && req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const leaseId = url.searchParams.get('leaseId');
    if (!leaseId) return json(res, 400, { error: 'leaseId required' });
    try {
      const value = registry.redeemLease(leaseId);
      return json(res, 200, value);
    } catch (e) { return json(res, 403, { error: e.message }); }
  }

  // ─── Revoke lease ────────────────────────────────────────────
  if (pathname === '/api/vault/revoke' && req.method === 'POST') {
    return readBody(req, res, (body) => {
      if (body.leaseId) {
        registry.revokeLease(body.leaseId);
      } else if (body.agentId) {
        registry.revokeAllAgentLeases(body.agentId);
      }
      json(res, 200, { ok: true });
    });
  }

  // ─── List active leases ──────────────────────────────────────
  if (pathname === '/api/vault/leases' && req.method === 'GET') {
    return json(res, 200, registry.getActiveLeases());
  }

  // No route matched
  return false;
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
  return true;
}

function readBody(req, res, cb) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try { cb(JSON.parse(body)); }
    catch (e) { json(res, 400, { error: 'Invalid JSON' }); }
  });
  return true;
}

module.exports = { registerInfraRoutes };
