const debug = require('debug')('thmix:WebsocketServer');
const WebsocketSession = require('./WebsocketSession');
const crypto = require('crypto');

module.exports = class WebsocketServer {
  constructor(wsServer, {bucketService, translationService}) {
    /** @type {import('ws').Server} */
    this.wsServer = wsServer;

    /** @type {import('./BucketService')} */
    this.bucketService = bucketService;

    /** @type {import('./TranslationService')} */
    this.translationService = translationService;

    /** @type {Object.<string, WebsocketSession} */
    this.sessionDict = {};

    this.wsServer.on('connection', this.onClientConnection.bind(this));
  }

  onClientConnection(socket) {
    debug('onClientConnection');

    const sessionId = crypto.randomBytes(16).toString('base64');
    this.sessionDict[sessionId] = new WebsocketSession(this, sessionId, socket);
  }

  closeSession(session) {
    session;
    delete this.sessionDict[session.sessionId];
  }
};
