const debug = require('debug')('thmix:Server');

const Session = require('./Session');

module.exports = class Server {
  constructor(io, {bucketService, translationService}) {
    /** @type {import('socket.io').Server} */
    this.io = io;

    /** @type {import('./BucketService')} */
    this.bucketService = bucketService;

    /** @type {import('./TranslationService')} */
    this.translationService = translationService;

    /** @type {Object.<string, Session>} */
    this.sessionDict = {};

    io.on('connection', this.onClientConnection.bind(this));
  }

  onClientConnection(socket) {
    debug('onClientConnection', socket.id);

    this.sessionDict[socket.id] = new Session(this, socket);
  }

  // /**
  //  * @param {Session} session
  //  */
  // addBoardListener(session) {
  //   this.boardListeners[session.socketId] = session;
  // }

  // /**
  //  * @param {Session} session
  //  */
  // removeBoardListener(session) {
  //   delete this.boardListeners[session.socketId];
  // }

  // sendBoardMessage(message) {
  //   Object.values(this.boardListeners).forEach((x) => {
  //     x.socket.emit('sv_board_update_message', message);
  //   });
  // }

  /**
   * @param {string} socketId
   */
  endSession(socketId) {
    if (typeof this.sessionDict[socketId] === 'object') {
      this.sessionDict[socketId].socket.disconnect();
    } else {
      debug('ending mal-formed session', socketId);
    }
    delete this.sessionDict[socketId];
    // delete this.boardListeners[socketId];
  }

  // bucketUploadPublic(file, destination) {
  //   return this.bucket.upload(file, {
  //     destination,
  //     metadata: {
  //       gzip: true,
  //       cacheControl: 'public, max-age=31536000',
  //       acl: [{entity: 'allUsers', role: this.storage.acl.READER_ROLE}],
  //     },
  //   });
  // }

  // bucketUploadPrivate(file, destination) {
  //   return this.bucket.upload(file, {destination});
  // }

  // bucketGetPublicUrl(path) {
  //   return 'https://storage.googleapis.com/' + this.bucketName + path;
  // }
};
