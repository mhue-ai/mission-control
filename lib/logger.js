/**
 * Structured Logger
 * Outputs JSON-lines for machine parsing + human-readable console output.
 */

const os = require('os');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[process.env.MC_LOG_LEVEL || 'info'] ?? LEVELS.info;

function log(level, component, message, data = {}) {
  if (LEVELS[level] > currentLevel) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    message,
    ...data,
    host: os.hostname(),
    pid: process.pid,
  };

  // Remove undefined values
  Object.keys(entry).forEach(k => entry[k] === undefined && delete entry[k]);

  if (process.env.MC_LOG_FORMAT === 'json') {
    process.stdout.write(JSON.stringify(entry) + '\n');
  } else {
    const color = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m', debug: '\x1b[90m' }[level] || '';
    const reset = '\x1b[0m';
    const extra = Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : '';
    console.log(`${color}[${entry.ts.slice(11, 19)}] [${level.toUpperCase().padEnd(5)}] [${component}]${reset} ${message}${extra}`);
  }
}

module.exports = {
  error: (component, message, data) => log('error', component, message, data),
  warn: (component, message, data) => log('warn', component, message, data),
  info: (component, message, data) => log('info', component, message, data),
  debug: (component, message, data) => log('debug', component, message, data),
};
