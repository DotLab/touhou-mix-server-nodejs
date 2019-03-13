const crypto = require('crypto');

const debug = require('debug')('thmix:Session');

const {User} = require('./models');

const {verifyRecaptcha} = require('./utils');

/** @typedef {import('./Server')} Server */
/** @typedef {import('socket.io').Socket} Socket */

const INTENT_WEB = 'web';
const PASSWORD_HASHER = 'sha512';

function success(done, data) {
  debug('    success');
  if (typeof done === 'function') done({success: true, data});
  else debug('  done is not a function');
}

function error(done, data) {
  debug('    error');
  if (typeof done === 'function') done({error: true, data});
  else debug('  done is not a function');
}

module.exports = class Session {
  /**
   * @param {Server} server
   * @param {Socket} socket
   */
  constructor(server, socket) {
    /** @type {Server} */
    this.server = server;
    /** @type {Socket} */
    this.socket = socket;
    /** @type {string} */
    this.socketId = socket.id;
    /** @type {string} */
    this.socketIp = socket.handshake.headers['x-forwarded-for'];

    this.user = null;

    socket.on('cl_handshake', this.onClHandshake.bind(this));
  }

  onClHandshake({version, intent}, done) {
    debug('  cl_handshake', version, intent);

    if (version !== this.server.version) {
      return this.server.endSession(this.socket.id);
    }

    if (intent === INTENT_WEB) {
      this.listenWebClient();
    } else {
      this.listenAppClient();
    }

    success(done, {version: this.server.version});
  }

  listenWebClient() {
    this.socket.on('cl_web_register', this.onClWebRegister.bind(this));
    this.socket.on('cl_web_login', this.onClWebLogin.bind(this));
  }

  listenAppClient() {
  }

  async onClWebRegister({recaptcha, username, email, password}, done) {
    debug('  cl_web_register', username, email, password);
    const res = await verifyRecaptcha(recaptcha, this.socketIp);
    if (res !== true) return error(done, 'invalid recaptcha');

    const user = await User.findOne({$or: [{username}, {email}]});
    if (user) return error(done, 'existing username or email');

    const salt = crypto.randomBytes(256).toString('base64');
    const hasher = crypto.createHash(PASSWORD_HASHER);
    hasher.update(password);
    hasher.update(salt);
    const hash = hasher.digest('base64');

    await User.create({username, email, salt, hash});

    success(done);
  }

  async onClWebLogin({recaptcha, email, password}, done) {
    debug('cl_web_login', email, password);
    const res = await verifyRecaptcha(recaptcha, this.socketIp);
    if (res !== true) return error(done, 'invalid recaptcha');

    const user = await User.findOne({email: email});
    if (!user) return error(done, 'wrong combination');

    const hasher = crypto.createHash(PASSWORD_HASHER);
    hasher.update(password);
    hasher.update(user.salt);
    const hash = hasher.digest('base64');

    if (hash === user.hash) { // matched
      this.user = user;
      return success(done, {id: user.id, username: user.username});
    }

    error(done, 'wrong combination');
  }
};
