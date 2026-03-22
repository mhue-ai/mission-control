/**
 * Network Scanner
 *
 * Discovers hosts and services on the local network.
 * Uses nmap if available, falls back to native TCP connect scan.
 * Results are written directly into the InfrastructureRegistry.
 *
 * Triggered by POST /api/infra/scan — one-shot, operator-initiated.
 */

const { execSync, exec } = require('child_process');
const net = require('net');
const os = require('os');
const crypto = require('crypto');
const log = require('./logger');

// Common ports to scan when nmap is unavailable
const COMMON_PORTS = [
  22, 80, 443, 3000, 3100, 3306, 5432, 5672, 6379, 8080, 8443,
  9090, 9200, 15672, 18789, 27017,
];

// Port → component type mapping
const PORT_TYPE_MAP = {
  22: { type: 'server', proto: 'ssh', label: 'SSH' },
  80: { type: 'web_service', proto: 'http', label: 'HTTP' },
  443: { type: 'web_service', proto: 'https', label: 'HTTPS' },
  3000: { type: 'web_service', proto: 'http', label: 'Web App (3000)' },
  3100: { type: 'web_service', proto: 'http', label: 'Mission Control' },
  3306: { type: 'database', proto: 'mysql', label: 'MySQL' },
  5432: { type: 'database', proto: 'postgres', label: 'PostgreSQL' },
  5672: { type: 'message_queue', proto: 'amqp', label: 'RabbitMQ' },
  6379: { type: 'cache', proto: 'redis', label: 'Redis' },
  8080: { type: 'web_service', proto: 'http', label: 'HTTP (8080)' },
  8443: { type: 'web_service', proto: 'https', label: 'HTTPS (8443)' },
  9090: { type: 'monitoring', proto: 'http', label: 'Prometheus' },
  9200: { type: 'database', proto: 'http', label: 'Elasticsearch' },
  15672: { type: 'message_queue', proto: 'http', label: 'RabbitMQ Management' },
  18789: { type: 'openclaw_gateway', proto: 'ws', label: 'OpenClaw Gateway' },
  27017: { type: 'database', proto: 'mongodb', label: 'MongoDB' },
};

function getLocalSubnet() {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        // Convert to /24 range
        const parts = addr.address.split('.');
        return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
      }
    }
  }
  return '192.168.1.0/24';
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return '127.0.0.1';
}

function hasNmap() {
  try { execSync('which nmap', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// ─── nmap-based scan ───────────────────────────────────────────────
function scanWithNmap(subnet) {
  return new Promise((resolve, reject) => {
    const cmd = `nmap -sV -T4 --open -oX - ${subnet} 2>/dev/null`;
    exec(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 120000 }, (err, stdout) => {
      if (err) return reject(err);
      const hosts = parseNmapXML(stdout);
      resolve(hosts);
    });
  });
}

function parseNmapXML(xml) {
  const hosts = [];
  const hostBlocks = xml.split('<host ').slice(1);

  for (const block of hostBlocks) {
    const ipMatch = block.match(/addr="([^"]+)".*addrtype="ipv4"/);
    if (!ipMatch) continue;
    const ip = ipMatch[1];

    const hostnameMatch = block.match(/hostname name="([^"]+)"/);
    const hostname = hostnameMatch ? hostnameMatch[1] : '';

    const ports = [];
    const portBlocks = block.split('<port ').slice(1);
    for (const pb of portBlocks) {
      const portMatch = pb.match(/portid="(\d+)" protocol="(\w+)"/);
      const stateMatch = pb.match(/state="(\w+)"/);
      const serviceMatch = pb.match(/name="([^"]*)".*product="([^"]*)"/);
      const serviceNameOnly = pb.match(/name="([^"]*)"/);
      if (portMatch && stateMatch && stateMatch[1] === 'open') {
        ports.push({
          port: parseInt(portMatch[1]),
          protocol: portMatch[2],
          service: serviceMatch ? serviceMatch[2] : (serviceNameOnly ? serviceNameOnly[1] : ''),
          state: 'open',
        });
      }
    }

    if (ports.length > 0) {
      hosts.push({ ip, hostname, ports });
    }
  }
  return hosts;
}

// ─── Native TCP connect scan (fallback) ────────────────────────────
function scanWithTCP(subnet) {
  return new Promise(async (resolve) => {
    const parts = subnet.replace('/24', '').split('.');
    const base = `${parts[0]}.${parts[1]}.${parts[2]}`;
    const hosts = [];

    // Scan .1 through .254
    const scanHost = (ip) => {
      return new Promise((res) => {
        const openPorts = [];
        let pending = COMMON_PORTS.length;
        const done = () => { if (--pending <= 0) res(openPorts.length > 0 ? { ip, hostname: '', ports: openPorts } : null); };

        for (const port of COMMON_PORTS) {
          const sock = new net.Socket();
          sock.setTimeout(800);
          sock.on('connect', () => {
            const info = PORT_TYPE_MAP[port] || { type: 'custom', proto: 'tcp', label: `Port ${port}` };
            openPorts.push({ port, protocol: 'tcp', service: info.label, state: 'open' });
            sock.destroy();
            done();
          });
          sock.on('timeout', () => { sock.destroy(); done(); });
          sock.on('error', () => { sock.destroy(); done(); });
          sock.connect(port, ip);
        }
      });
    };

    // Scan in batches of 20 to avoid fd exhaustion
    for (let batch = 1; batch <= 254; batch += 20) {
      const promises = [];
      for (let i = batch; i < Math.min(batch + 20, 255); i++) {
        promises.push(scanHost(`${base}.${i}`));
      }
      const results = await Promise.all(promises);
      for (const r of results) {
        if (r) hosts.push(r);
      }
    }

    resolve(hosts);
  });
}

// ─── Convert scan results to infrastructure components ─────────────
function resultsToComponents(hosts, localIP) {
  const components = [];

  for (const host of hosts) {
    // Skip self
    if (host.ip === localIP) continue;

    for (const port of host.ports) {
      const info = PORT_TYPE_MAP[port.port] || { type: 'custom', proto: 'tcp', label: port.service || `Port ${port.port}` };
      const name = host.hostname
        ? `${host.hostname} (${info.label})`
        : `${host.ip} — ${info.label}`;

      components.push({
        id: 'scan-' + crypto.randomUUID().slice(0, 8),
        type: info.type,
        name,
        description: `Discovered via network scan. Service: ${port.service || info.label}`,
        host: host.ip,
        port: port.port,
        protocol: info.proto,
        environment: 'production',
        relevant: true,
        tags: ['discovered'],
        metadata: {
          discoveredAt: new Date().toISOString(),
          scanMethod: hasNmap() ? 'nmap' : 'tcp-connect',
          hostname: host.hostname || '',
          rawService: port.service || '',
        },
      });
    }
  }

  return components;
}

// ─── Main scan function ────────────────────────────────────────────
async function runNetworkScan(registry, options = {}) {
  const subnet = options.subnet || getLocalSubnet();
  const localIP = getLocalIP();
  const useNmap = hasNmap();

  log.info('scanner', `Starting network scan on ${subnet} (method: ${useNmap ? 'nmap' : 'tcp-connect'})`);

  const startTime = Date.now();
  let hosts;

  try {
    hosts = useNmap ? await scanWithNmap(subnet) : await scanWithTCP(subnet);
  } catch (e) {
    log.error('scanner', `Scan failed: ${e.message}`);
    throw e;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log.info('scanner', `Scan complete: ${hosts.length} hosts found in ${elapsed}s`);

  const components = resultsToComponents(hosts, localIP);
  let added = 0, skipped = 0;

  // Add to registry, skip duplicates (same host:port)
  const existing = registry.listComponents();
  for (const comp of components) {
    const dup = existing.find(e => e.host === comp.host && e.port === comp.port);
    if (dup) { skipped++; continue; }
    try {
      registry.createComponent(comp);
      added++;
    } catch (e) {
      log.warn('scanner', `Failed to add ${comp.name}: ${e.message}`);
    }
  }

  const result = {
    subnet,
    method: useNmap ? 'nmap' : 'tcp-connect',
    hostsFound: hosts.length,
    servicesFound: components.length,
    added,
    skipped,
    elapsed: parseFloat(elapsed),
    timestamp: new Date().toISOString(),
  };

  log.info('scanner', `Registry updated: ${added} added, ${skipped} duplicates skipped`);
  return result;
}

module.exports = { runNetworkScan, getLocalSubnet, hasNmap };
