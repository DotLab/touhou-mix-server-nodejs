const crypto = require('crypto');

const debug = require('debug')('thmix:Session');

const {User} = require('./models');

const {verifyRecaptcha, verifyObjectId} = require('./utils');

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
    this.socket.on('cl_web_get_user', this.onClWebGetUser.bind(this));
  }

  listenAppClient() {
  }

  async onClWebRegister({recaptcha, name, email, password}, done) {
    debug('  cl_web_register', name, email, password);
    const res = await verifyRecaptcha(recaptcha, this.socketIp);
    if (res !== true) return error(done, 'invalid recaptcha');

    const user = await User.findOne({$or: [{name}, {email}]});
    if (user) return error(done, 'existing name or email');

    const salt = crypto.randomBytes(256).toString('base64');
    const hasher = crypto.createHash(PASSWORD_HASHER);
    hasher.update(password);
    hasher.update(salt);
    const hash = hasher.digest('base64');

    const now = new Date();
    await User.create({
      name, email, salt, hash,
      joinedDate: now, seenDate: now,
      playCount: 0,
      totalScores: 0,
      maxCombo: 0,
      accuracy: 0,
    });

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
      User.findByIdAndUpdate(user.id, {$set: {seenDate: new Date()}}).exec();
      return success(done, {id: user.id, name: user.name});
    }

    error(done, 'wrong combination');
  }

  async onClWebGetUser({userId}, done) {
    debug('cl_web_get_user', userId);

    if (typeof userId !== 'string' || !verifyObjectId(userId)) {
      return error(done, 'not found');
    }

    const user = await User.findById(userId);
    if (!user) return error(done, 'not found');

    const {
      id, name, joinedDate, seenDate, bio,
      playCount, totalScores, maxCombo, accuracy,
      totalPlayTime, weightedPp, ranking, sCount, aCount, bCount, cCount, dCount, fCount,
    } = user;
    success(done, {
      id, name, joinedDate, seenDate, bio,
      playCount, totalScores, maxCombo, accuracy,
      totalPlayTime, weightedPp, ranking, sCount, aCount, bCount, cCount, dCount, fCount,
    });
  }
};
