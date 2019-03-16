module.exports = {
  apps: [{
    name: 'thmix-server',
    script: './src/index.js',

    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',

    env: {
      NODE_ENV: 'production',
    },
  }, {
    name: 'thmix-server-staging',
    script: './src/index.js',

    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',

    env: {
      NODE_ENV: 'staging',
    },
  }],
};
