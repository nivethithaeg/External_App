module.exports = { apps: [{ name: 'kickoff-api', script: 'dist/src/server.js', instances: 1, exec_mode: 'fork', max_memory_restart: '400M', env: { NODE_ENV: 'production' } }] };
