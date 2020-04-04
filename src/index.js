const debug = require('debug')('thmix');

const env = process.env.NODE_ENV;

const port = '6003';
const portWebsocket = 6008;
const database = 'thmix';
debug('running as', env, 'on port', port, 'using database', database);

const mongoose = require('mongoose');
mongoose.connect(`mongodb://localhost:27017/${database}`, {
  useNewUrlParser: true, useUnifiedTopology: true, useCreateIndex: true,
});
mongoose.set('useFindAndModify', false);

const tempPath = './temp';

const BucketService = require('./BucketService');
const bucketService = new BucketService(tempPath, 'microvolt-bucket-1');

const TranslationService = require('./TranslationService');
const translationService = new TranslationService('microvolt-0');

const io = require('socket.io')(port);
const Server = require('./Server');
new Server(io, {bucketService, translationService});

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

const WebsocketServer = require('./WebsocketServer');
new WebsocketServer(wsServer, {bucketService, translationService});
