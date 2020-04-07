const debug = require('debug')('thmix:WebSocketServer');
const WebSocketSession = require('./WebSocketSession');
const crypto = require('crypto');

module.exports = class WebSocketServer {
  constructor(wsServer, {bucketService, translationService}) {
    /** @type {import('ws').Server} */
    this.wsServer = wsServer;

    /** @type {import('./BucketService')} */
    this.bucketService = bucketService;

    /** @type {import('./TranslationService')} */
    this.translationService = translationService;

    /** @type {Object.<string, WebSocketSession} */
    this.sessionDict = {};

    wsServer.on('connection', this.connectClient.bind(this));
  }

  async shutdown() {
    debug('shutdown');
  }

  connectClient(websocket) {
    debug('connectClient');

    const sessionId = crypto.randomBytes(16).toString('base64');
    this.sessionDict[sessionId] = new WebSocketSession(this, sessionId, websocket);
  }

  closeSession(session) {
    delete this.sessionDict[session.sessionId];
  }
};
