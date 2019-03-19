const crypto = require('crypto');
const sharp = require('sharp');
const fs = require('fs');

const debug = require('debug')('thmix:Session');

const {User} = require('./models');

const {verifyRecaptcha, verifyObjectId, emptyHandle, sendCodeEmail} = require('./utils');

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

function genPasswordSalt() {
  return crypto.randomBytes(256).toString('base64');
}

function calcPasswordHash(password, salt) {
  const hasher = crypto.createHash(PASSWORD_HASHER);
  hasher.update(password);
  hasher.update(salt);
  return hasher.digest('base64');
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
    this.pendingCode = null;

    socket.on('cl_handshake', this.onClHandshake.bind(this));
  }

  updateUser(spec) {
    return User.findByIdAndUpdate(this.user.id, spec, {new: true});
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
    this.socket.on('cl_web_register_pre', this.onClWebRegisterPre.bind(this));
    this.socket.on('cl_web_login', this.onClWebLogin.bind(this));
    this.socket.on('cl_web_get_user', this.onClWebGetUser.bind(this));
    this.socket.on('cl_web_user_update_bio', this.onClWebUserUpdateBio.bind(this));
    this.socket.on('cl_web_user_update_password', this.onClWebUserUpdatePassword.bind(this));
    this.socket.on('cl_web_user_upload_avatar', this.onClWebUserUploadAvatar.bind(this));
  }

  listenAppClient() {
  }

  async onClWebRegisterPre({recaptcha, name, email}, done) {
    debug('  cl_web_register_pre', name, email);

    const res = await verifyRecaptcha(recaptcha, this.socketIp);
    if (res !== true) return error(done, 'invalid recaptcha');

    const user = await User.findOne({$or: [{name}, {email}]});
    if (user) return error(done, 'existing name or email');

    this.pendingCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    await sendCodeEmail(name, email, 'register', this.pendingCode);

    success(done);
  }

  async onClWebRegister({code, name, email, password}, done) {
    debug('  cl_web_register', code, name, email, password);

    if (!this.pendingCode || code != this.pendingCode) return error(done, 'wrong code');
    this.pendingCode = null;

    const user = await User.findOne({$or: [{name}, {email}]});
    if (user) return error(done, 'existing name or email');

    const salt = genPasswordSalt();
    const hash = calcPasswordHash(password, salt);

    const now = new Date();
    await User.create({
      name, email, salt, hash,
      joinedDate: now, seenDate: now,

      playCount: 0,
      totalScores: 0,
      maxCombo: 0,
      accuracy: 0,

      totalPlayTime: 0,
      weightedPp: 0,
      ranking: 0,
      sCount: 0,
      aCount: 0,
      bCount: 0,
      cCount: 0,
      dCount: 0,
      fCount: 0,
    });

    success(done);
  }

  async onClWebLogin({recaptcha, email, password}, done) {
    debug('cl_web_login', email, password);

    const res = await verifyRecaptcha(recaptcha, this.socketIp);
    if (res !== true) return error(done, 'invalid recaptcha');

    const user = await User.findOne({email: email});
    if (!user) return error(done, 'wrong combination');

    const hash = calcPasswordHash(password, user.salt);
    if (hash === user.hash) { // matched
      this.user = user;
      this.user = await this.updateUser({seenDate: new Date()});
      return success(done, serializeUser(this.user));
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

    success(done, serializeUser(user));
  }

  async onClWebUserUpdateBio({bio}, done) {
    debug('cl_web_user_update_bio', bio);

    if (!this.user) return error(done, 'forbidden');

    this.user = await this.updateUser({bio});
    success(done, serializeUser(this.user));
  }

  async onClWebUserUpdatePassword({currentPassword, password}, done) {
    debug('cl_web_user_update_password', currentPassword, password);

    if (!this.user) return error(done, 'forbidden');
    const hash = calcPasswordHash(currentPassword, this.user.salt);
    if (hash !== this.user.hash) return error(done, 'forbidden');

    const newSalt = genPasswordSalt();
    const newHash = calcPasswordHash(password, newSalt);
    this.user = await this.updateUser({hash: newHash, salt: newSalt});

    success(done);
  }

  async onClWebUserUploadAvatar({size, buffer}, done) {
    debug('cl_web_user_upload_avatar', size, buffer.length);

    if (!this.user) return error(done, 'forbidden');
    if (size !== buffer.length) return error(done, 'tampering with api');
    if (size > 1048576) return error(done, 'tampering with api');

    const hasher = crypto.createHash('md5');
    hasher.update(buffer);
    const hash = hasher.digest('hex');
    const remotePath = `/imgs/${hash}.jpg`;
    const avatarUrl = this.server.bucketGetPublicUrl(remotePath);

    if (remotePath === this.user.avatarPath) return success(done, serializeUser(this.user));

    const localPath = `${this.server.tempPath}/${hash}.jpg`;
    await sharp(buffer).resize(256, 256).jpeg({quality: 80}).toFile(localPath);
    await this.server.bucketUploadPublic(localPath, remotePath);
    fs.unlink(localPath, emptyHandle);

    // if (this.user.avatarPath) {  // delete old avatar (ignore dependents)
    //   this.server.bucket.file(this.user.avatarPath).delete().catch(emptyHandle);
    // }

    this.user = await User.findByIdAndUpdate(this.user.id, {$set: {avatarUrl, avatarPath: remotePath}}, {new: true});
    success(done, serializeUser(this.user));
  }
};

function serializeUser(user) {
  const {
    id, name, joinedDate, seenDate, bio, avatarUrl,
    playCount, totalScores, maxCombo, accuracy,
    totalPlayTime, weightedPp, ranking, sCount, aCount, bCount, cCount, dCount, fCount,
  } = user;
  return {
    id, name, joinedDate, seenDate, bio, avatarUrl,
    playCount, totalScores, maxCombo, accuracy,
    totalPlayTime, weightedPp, ranking, sCount, aCount, bCount, cCount, dCount, fCount,
  };
}
