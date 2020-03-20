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

    wsServer.on('connection', this.connectClient.bind(this));
  }

  connectClient(websocket) {
    debug('connectClient');

    const sessionId = crypto.randomBytes(16).toString('base64');
    this.sessionDict[sessionId] = new WebsocketSession(this, sessionId, websocket);
  }

  closeSession(session) {
    delete this.sessionDict[session.sessionId];
  }
};
