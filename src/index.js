const debug = require('debug')('thmix');

const env = process.env.NODE_ENV;

let port;
let portWebsocket;
let database;
if (env !== 'staging') {
  port = '6003';
  portWebsocket = 6008;
  database = 'thmix';
} else {
  port = '6004';
  portWebsocket = 6009;
  database = 'thmix-staging';
}
debug('running as', env, 'on port', port, 'using database', database);

const mongoose = require('mongoose');
mongoose.connect(`mongodb://localhost:27017/${database}`, {
  useNewUrlParser: true, useUnifiedTopology: true, useCreateIndex: true,
});
mongoose.set('useFindAndModify', false);
mongoose.set('debug', true);

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
  const {User} = require('./models');
  User.deleteMany({name: 'Test'}).exec();
  const crypto = require('crypto');
  const salt = crypto.randomBytes(256).toString('base64');
  const hasher = crypto.createHash('sha512');
  hasher.update('test');
  hasher.update(salt);
  const hash = hasher.digest('base64');
  User.create({
    name: 'Test', email: 'test@test.com', salt, hash,
    joinedDate: new Date(), seenDate: new Date(),
  });
}

const TranslationService = require('./TranslationService');
const translationService = new TranslationService('microvolt-0');

const io = require('socket.io')(port);
const Server = require('./Server');
new Server(io, storage, tempPath, translationService);

const WebSocket = require('ws');

debug('websocket on', portWebsocket);

const wsServer = new WebSocket.Server({
  port: portWebsocket,
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

const WebsocketServer = require('./WebsocketServer');
new WebsocketServer(wsServer, {bucketService, translationService});
