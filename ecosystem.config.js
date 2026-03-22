module.exports = {
  apps: [{
    name: 'mission-control',
    script: './server.js',
    cwd: '/opt/mission-control/app',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env_file: '.env',
    env: {
      NODE_ENV: 'production',
      MC_PORT: 3100,
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: '/var/log/mission-control/error.log',
    out_file: '/var/log/mission-control/out.log',
    merge_logs: true,
    time: true,
  }]
};
