const debug = require('debug')('thmix:SocketIoServer');
const SocketIoSession = require('./SocketIoSession');
const {User} = require('./models');

const VERSION = 0;

module.exports = class SocketIoServer {
  constructor(io, storage, tempPath, translationService) {
    /** @type {import('socket.io').Server} */
    this.io = io;
    this.storage = storage;
    this.tempPath = tempPath;

    this.bucketName = 'microvolt-bucket-1';
    /** @type {import('@google-cloud/storage').Bucket} */
    this.bucket = storage.bucket(this.bucketName);

    /** @type {import('./TranslationService')} */
    this.translationService = translationService;

    /** @type {Object.<string, SocketIoSession>} */
    this.sessions = {};
    this.version = VERSION;

    this.boardListeners = {};

    this.peakOnlineCount = 0;

    /** @type {import('./WebSocketServer')} */
    this.webSocketServer = null;

    setInterval(() => {
      debug('new day login');
      User.updateMany({newDay: false}, {$set: {newDay: true}}).exec();
    }, 1000 * 60 * 60 * 24);

    this.revision = require('child_process')
        .execSync('git rev-parse HEAD')
        .toString().trim();

    io.on('connection', (socket) => {
      debug('onConnection', socket.id);
      this.sessions[socket.id] = new SocketIoSession(this, socket);
    });
  }

  async shutdown() {
    debug('shutdown');
    await Promise.all(Object.values(this.sessions).map((x) => x.onDisconnect()));
  }

  /**
   * @param {SocketIoSession} session
   */
  addBoardListener(session) {
    this.boardListeners[session.socketId] = session;
  }

  /**
   * @param {SocketIoSession} session
   */
  removeBoardListener(session) {
    delete this.boardListeners[session.socketId];
  }

  sendBoardMessage(message) {
    Object.values(this.boardListeners).forEach((x) => {
      x.socket.emit('sv_board_update_message', message);
    });
  }

  /**
   * @param {string} socketId
   */
  endSession(socketId) {
    if (typeof this.sessions[socketId] === 'object') {
      this.sessions[socketId].socket.disconnect();
    } else debug('ending mal-formed session', socketId);
    this.disposeSession(socketId);
  }

  disposeSession(socketId) {
    debug('disposeSession', socketId);
    delete this.sessions[socketId];
    delete this.boardListeners[socketId];
  }

  bucketUploadPublic(file, destination) {
    return this.bucket.upload(file, {
      destination,
      metadata: {
        gzip: true,
        cacheControl: 'public, max-age=31536000',
        acl: [{entity: 'allUsers', role: this.storage.acl.READER_ROLE}],
      },
    });
  }

  bucketUploadPrivate(file, destination) {
    return this.bucket.upload(file, {destination});
  }

  bucketGetPublicUrl(path) {
    return 'https://storage.googleapis.com/' + this.bucketName + path;
  }
};
