const debug = require('debug')('thmix');

const env = process.env.NODE_ENV;

let portSocketIo;
let portWebSocket;
let database;
if (env !== 'staging') {
  portSocketIo = '6003';
  portWebSocket = 6008;
  database = 'thmix';
} else {
  portSocketIo = '6004';
  portWebSocket = 6009;
  database = 'thmix-staging';
}
debug('running as', env, 'on portSocketIo', portSocketIo, 'on portWebSocket', portWebSocket, 'using database', database);

const {connectDatabase} = require('./models');
connectDatabase(database);

const {Storage} = require('@google-cloud/storage');
const storage = new Storage();

const tempPath = './temp';
const fs = require('fs');
const path = require('path');
if (fs.existsSync(tempPath)) {
  const files = fs.readdirSync(tempPath);
  for (const file of files) {
    fs.unlinkSync(path.join(tempPath, file));
  }
} else {
  fs.mkdirSync(tempPath);
}

if (env === 'development') {
  // create test user
  (async function() {
    debug('create test user');
    const crypto = require('crypto');
    const salt = crypto.randomBytes(256).toString('base64');
    const hasher = crypto.createHash('sha512');
    hasher.update('test');
    hasher.update(salt);
    const hash = hasher.digest('base64');
    const {User} = require('./models');
    await User.findOneAndUpdate({name: 'Test'}, {
      name: 'Test', email: 'test@test.com', salt, hash,
      joinedDate: new Date(), seenDate: new Date(),
      roles: ['site-owner'],
    }, {upsert: true});
  })();
}

const TranslationService = require('./TranslationService');
const translationService = new TranslationService('microvolt-0');

const io = require('socket.io')(portSocketIo);
const SocketIoServer = require('./SocketIoServer');
const socketIoServer = new SocketIoServer(io, storage, tempPath, translationService);

const ws = require('ws');

debug('websocket on', portWebSocket);

const wsServer = new ws.Server({
  port: portWebSocket,
  perMessageDeflate: {
    zlibDeflateOptions: {
      // See zlib defaults.
      chunkSize: 1024,
      memLevel: 7,
      level: 3,
    },
    zlibInflateOptions: {
      chunkSize: 10 * 1024,
    },
    // Other options settable:
    clientNoContextTakeover: true, // Defaults to negotiated value.
    serverNoContextTakeover: true, // Defaults to negotiated value.
    serverMaxWindowBits: 10, // Defaults to negotiated value.
    // Below options specified as default values.
    concurrencyLimit: 10, // Limits zlib concurrency for perf.
    threshold: 1024, // Size (in bytes) below which messages
    // should not be compressed.
  },
});

const BucketService = require('./BucketService');
const bucketService = new BucketService(storage, tempPath, 'microvolt-bucket-1');

const WebSocketServer = require('./WebSocketServer');
const webSocketServer = new WebSocketServer(wsServer, {bucketService, translationService});

process.stdin.resume();

async function exitHandler(shouldExit, exitCode) {
  debug('shutdown', exitCode);
  try {
    await socketIoServer.shutdown();
    await webSocketServer.shutdown();
  } catch (e) {
    debug(e);
  }

  if (shouldExit) process.exit();
}

process.on('SIGINT', async () => {

});

// do something when app is closing
process.on('exit', exitHandler.bind(null, false));

// catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, true));

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler.bind(null, true));
process.on('SIGUSR2', exitHandler.bind(null, true));

// catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, true));
