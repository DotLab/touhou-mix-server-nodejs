const debug = require('debug')('thmix:WebsocketSession');
const {User, Midi, Message, createDefaultUser, createDefaultMidi, serializeUser, serializeMidi} = require('./models');
const crypto = require('crypto');

const PASSWORD_HASHER = 'sha512';
function calcPasswordHash(password, salt) {
  const hasher = crypto.createHash(PASSWORD_HASHER);
  hasher.update(password);
  hasher.update(salt);
  return hasher.digest('base64');
}

module.exports = class WebsocketSession {
  constructor(server, sessionId, websocket) {
    /** @type {import('./WebsocketServer')} */
    this.server = server;
    this.sessionId = sessionId;
    this.websocket = websocket;

    this.callbackDict = {};

    websocket.on('message', this.handleRpc.bind(this));
    websocket.on('close', this.closeSession.bind(this));
    websocket.on('error', this.handleError.bind(this));
  }

  updateUser(spec) {
    return User.findByIdAndUpdate(this.user.id, spec, {new: true});
  }

  handleRpc(data) {
    data = String(data);

    try {
      const {id, command, args} = JSON.parse(data);
      debug(' handleRpc', command, args, id);

      switch (command) {
        case 'ClAppHandleRpcResponse': this.handleRpcResponse(id, args); break;
        case 'ClAppUserLogin': this.clAppUserLogin(id, args); break;
      }
    } catch (e) {
      this.handleError(e);
    }
  }

  handleRpcResponse(id, args) {
    const callbackId = args.id;
    if (this.callbackDict[callbackId]) {
      this.callbackDict[callbackId](args);
      delete this.callbackDict[callbackId];
    } else {
      debug('  rpcResponse to nothing');
    }
  }

  closeSession(code, reason) {
    debug('  closeSession', code, reason);
    this.server.closeSession(this);
  }

  handleError(error) {
    debug('  handleError', error);
    this.server.closeSession(this);
  }

  rpc(command, args, callback) {
    debug('  rpc', command);
    const id = crypto.randomBytes(16).toString('base64');
    if (typeof callback === 'function') {
      this.callbackDict[id] = callback;
    }
    this.websocket.send(JSON.stringify({id, command, args}));
  }

  returnSuccess(id, data) {
    this.rpc('SvAppHandleRpcResponse', {id, data});
  }

  returnError(id, message) {
    this.rpc('SvAppHandleRpcResponse', {id, error: message});
  }

  async clAppUserLogin(id, {name, password}) {
    debug('  onClAppUserLogin', name, password);

    const user = await User.findOne({name});
    if (!user) return this.returnError(id, 'wrong combination');

    const hash = calcPasswordHash(password, user.salt);
    if (hash === user.hash) { // matched
      this.user = user;
      this.user = await this.updateUser({seenDate: new Date()});
      return this.returnSuccess(id, serializeUser(this.user));
    }

    return this.returnError(id, 'wrong combination');
  }
};
