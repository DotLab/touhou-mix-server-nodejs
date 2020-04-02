const crypto = require('crypto');
const sharp = require('sharp');
const fs = require('fs');
const MidiParser = require('../node_modules/midi-parser-js/src/midi-parser');
const {Translate} = require('@google-cloud/translate').v2;
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;

const debug = require('debug')('thmix:Session');

const {User, Midi, Message, createDefaultUser, createDefaultMidi, serializeUser, serializeMidi, Translation, Build, serializeBuild,
  Album, serializeAlbum, Song, serializeSong, Person, serializePerson} = require('./models');

const {verifyRecaptcha, verifyObjectId, emptyHandle, sendCodeEmail, filterUndefinedKeys} = require('./utils');

/** @typedef {import('./Server')} Server */
/** @typedef {import('socket.io').Socket} Socket */

const INTENT_WEB = 'web';
const PASSWORD_HASHER = 'sha512';
const MB = 1048576;
const USER_LIST_PAGE_LIMIT = 50;
const MIDI_LIST_PAGE_LIMIT = 50;
const ROLE_MIDI_MOD = 'midi-mod';
const ROLE_MIDI_ADMIN = 'midi-admin';
const ROLE_SITE_OWNER = 'site-owner';


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

function calcFileHash(buffer) {
  const hasher = crypto.createHash('md5');
  hasher.update(buffer);
  return hasher.digest('hex');
}

function genPendingCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
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
    debug('  onClHandshake', version, intent);

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
    this.socket.on('cl_web_user_register', this.onClWebUserRegister.bind(this));
    this.socket.on('cl_web_user_register_pre', this.onClWebUserRegisterPre.bind(this));
    this.socket.on('cl_web_user_login', this.onClWebUserLogin.bind(this));
    this.socket.on('cl_web_user_get', this.onClWebUserGet.bind(this));
    this.socket.on('cl_web_user_list', this.onClWebUserList.bind(this));
    this.socket.on('cl_web_user_update_bio', this.onClWebUserUpdateBio.bind(this));
    this.socket.on('cl_web_user_update_password', this.onClWebUserUpdatePassword.bind(this));
    this.socket.on('cl_web_user_upload_avatar', this.onClWebUserUploadAvatar.bind(this));
    this.socket.on('cl_web_midi_get', this.onClWebMidiGet.bind(this));
    this.socket.on('cl_web_midi_list', this.onClWebMidiList.bind(this));
    this.socket.on('cl_web_midi_upload', this.onClWebMidiUpload.bind(this));
    this.socket.on('cl_web_midi_update', this.onClWebMidiUpdate.bind(this));
    this.socket.on('cl_web_midi_upload_cover', this.onClWebMidiUploadCover.bind(this));
    this.socket.on('cl_web_board_get_messages', this.onClWebBoardGetMessages.bind(this));
    this.socket.on('cl_web_board_request_message_update', this.onClWebBoardRequestMessageUpdate.bind(this));
    this.socket.on('cl_web_board_stop_message_update', this.onClWebBoardStopMessageUpdate.bind(this));
    this.socket.on('cl_web_board_send_message', this.onClWebBoardSendMessage.bind(this));
    this.socket.on('cl_web_translate', this.onClWebTranslate.bind(this));
    this.socket.on('cl_web_build_get', this.onClWebBuildGet.bind(this));
    this.socket.on('cl_web_build_upload', this.onClWebBuildUpload.bind(this));
    this.socket.on('cl_web_build_update', this.onClWebBuildUpdate.bind(this));
    this.socket.on('cl_web_album_create', this.onClWebAlbumCreate.bind(this));
    this.socket.on('cl_web_album_get', this.onClWebAlbumGet.bind(this));
    this.socket.on('cl_web_album_update', this.onClWebAlbumUpdate.bind(this));
    this.socket.on('cl_web_album_upload_cover', this.onClWebAlbumUploadCover.bind(this));
    this.socket.on('cl_web_album_list', this.onClWebAlbumList.bind(this));
    this.socket.on('cl_web_song_create', this.onClWebSongCreate.bind(this));
    this.socket.on('cl_web_song_get', this.onClWebSongGet.bind(this));
    this.socket.on('cl_web_song_update', this.onClWebSongUpdate.bind(this));
    this.socket.on('cl_web_song_list', this.onClWebSongList.bind(this));
    this.socket.on('cl_web_person_create', this.onClWebPersonCreate.bind(this));
    this.socket.on('cl_web_person_get', this.onClWebPersonGet.bind(this));
    this.socket.on('cl_web_person_update', this.onClWebPersonUpdate.bind(this));
    this.socket.on('cl_web_person_upload_avatar', this.onClWebPersonUploadAvatar.bind(this));
    this.socket.on('cl_web_person_list', this.onClWebPersonList.bind(this));
  }

  listenAppClient() {
    this.socket.on('cl_app_user_login', this.onClAppUserLogin.bind(this));
  }

  async onClWebUserRegisterPre({recaptcha, name, email}, done) {
    debug('  onClWebUserRegisterPre', name, email);

    const res = await verifyRecaptcha(recaptcha, this.socketIp);
    if (res !== true) return error(done, 'invalid recaptcha');

    const user = await User.findOne({$or: [{name}, {email}]});
    if (user) return error(done, 'existing name or email');

    this.pendingCode = genPendingCode();
    await sendCodeEmail(name, email, 'register', this.pendingCode);

    success(done);
  }

  async onClWebUserRegister({code, name, email, password}, done) {
    debug('  onClWebUserRegister', code, name, email, password);

    if (!this.pendingCode || code != this.pendingCode) return error(done, 'wrong code');
    this.pendingCode = null;

    const user = await User.findOne({$or: [{name}, {email}]});
    if (user) return error(done, 'existing name or email');

    const salt = genPasswordSalt();
    const hash = calcPasswordHash(password, salt);

    const now = new Date();
    await User.create({
      ...createDefaultUser(),

      name, email, salt, hash,
      joinedDate: now, seenDate: now,
    });

    success(done);
  }

  async onClWebUserLogin({recaptcha, email, password}, done) {
    debug('  onClWebUserLogin', email, password);

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

  async onClWebUserGet({id}, done) {
    debug('  onClWebUserGet', id);

    if (!verifyObjectId(id)) return error(done, 'not found');

    const user = await User.findById(id);
    if (!user) return error(done, 'not found');

    success(done, serializeUser(user));
  }

  async onClWebUserList({page}, done) {
    debug('  onClWebUserList', page);

    if (!(page > 0)) page = 0; // filter null and undefined

    const users = await User.find()
        .sort('-performance')
        .skip(page * USER_LIST_PAGE_LIMIT)
        .limit(USER_LIST_PAGE_LIMIT);
    if (!users) return error(done, 'not found');

    success(done, users.map((user) => serializeUser(user)));
  }

  async onClWebUserUpdateBio({bio}, done) {
    debug('  onClWebUserUpdateBio', bio);

    if (!this.user) return error(done, 'forbidden');

    this.user = await this.updateUser({bio});
    success(done, serializeUser(this.user));
  }

  async onClWebUserUpdatePassword({currentPassword, password}, done) {
    debug('  onClWebUserUpdatePassword', currentPassword, password);

    if (!this.user) return error(done, 'forbidden');
    const hash = calcPasswordHash(currentPassword, this.user.salt);
    if (hash !== this.user.hash) return error(done, 'forbidden');

    const newSalt = genPasswordSalt();
    const newHash = calcPasswordHash(password, newSalt);
    this.user = await this.updateUser({hash: newHash, salt: newSalt});

    success(done);
  }

  async onClWebUserUploadAvatar({size, buffer}, done) {
    debug('  onClWebUserUploadAvatar', size, buffer.length);

    if (!this.user) return error(done, 'forbidden');
    if (size !== buffer.length) return error(done, 'tampering with api');
    if (size > MB) return error(done, 'tampering with api');

    const hash = calcFileHash(buffer);
    const remotePath = `/imgs/${hash}.jpg`;
    const avatarUrl = this.server.bucketGetPublicUrl(remotePath);

    if (remotePath === this.user.avatarPath) return success(done, serializeUser(this.user));

    const localPath = `${this.server.tempPath}/${hash}.jpg`;
    await sharp(buffer).resize(256, 256).jpeg({quality: 80}).toFile(localPath);
    await this.server.bucketUploadPublic(localPath, remotePath);
    fs.unlink(localPath, emptyHandle);

    this.user = await this.updateUser({avatarUrl, avatarPath: remotePath});
    success(done, serializeUser(this.user));
  }

  async onClWebMidiUpload({name, size, buffer}, done) {
    debug('  onClWebMidiUpload', name, size, buffer.length);

    if (!this.user) return error(done, 'forbidden');
    if (size !== buffer.length) return error(done, 'tampering with api');
    if (size > MB) return error(done, 'tampering with api');

    const hash = calcFileHash(buffer);
    const midiFile = MidiParser.parse(buffer);
    if (!midiFile || !(midiFile.tracks > 0)) return error(done, 'tampering with api');

    let midi = await Midi.findOne({hash});
    if (midi) return success(done, {duplicated: true, id: midi.id});

    const remotePath = `/midis/${hash}.mid`;
    const localPath = `${this.server.tempPath}/${hash}.mid`;

    fs.writeFileSync(localPath, buffer);
    await this.server.bucketUploadPublic(localPath, remotePath);
    fs.unlink(localPath, emptyHandle);

    midi = await Midi.create({
      ...createDefaultMidi(),

      uploaderId: this.user.id,
      uploaderName: this.user.name,
      uploaderAvatarUrl: this.user.avatarUrl,

      name, desc: name,
      hash, path: remotePath,

      uploadedDate: new Date(),
    });

    success(done, {id: midi.id});
  }

  async onClWebMidiUpdate(update, done) {
    debug('  onClWebMidiUpdate', update.id);

    const {
      id, name, desc, artistName, artistUrl, albumId, songId, authorId,
      sourceArtistName, sourceAlbumName, sourceSongName,
    } = update;

    if (!this.user) return error(done, 'forbidden');
    if (!verifyObjectId(id)) return error(done, 'forbidden');

    let midi = await Midi.findById(id);
    if (!midi) return error(done, 'not found');
    if (!midi.uploaderId.equals(this.user.id)) return error(done, 'forbidden');

    update = filterUndefinedKeys({
      name, desc, artistName, artistUrl, albumId, songId, authorId,
      sourceArtistName, sourceAlbumName, sourceSongName,
    });

    midi = await Midi.findByIdAndUpdate(id, {$set: update}, {new: true});
    success(done, serializeMidi(midi));
  }

  async onClWebMidiUploadCover({id, size, buffer}, done) {
    debug('  onClWebMidiUploadCover', id, size, buffer.length);

    if (!this.user) return error(done, 'forbidden');
    if (!verifyObjectId(id)) return error(done, 'forbidden');
    if (size !== buffer.length) return error(done, 'tampering with api');
    if (size > MB) return error(done, 'tampering with api');

    let midi = await Midi.findById(id);
    if (!midi) return error(done, 'not found');
    if (!midi.uploaderId.equals(this.user.id)) return error(done, 'forbidden');

    const hash = calcFileHash(buffer);
    const remotePath = `/imgs/${hash}.jpg`;
    const blurRemotePath = `/imgs/${hash}.png`;
    const localPath = `${this.server.tempPath}/${hash}.jpg`;
    const blurLocalPath = `${this.server.tempPath}/${hash}.png`;

    const cover = sharp(buffer).resize(256, 256);
    await cover.jpeg({quality: 80}).toFile(localPath);
    cover.modulate({brightness: 1.05, saturation: 2}).blur(12).resize(128, 128);
    await cover.png().toFile(blurLocalPath);

    await this.server.bucketUploadPublic(localPath, remotePath);
    fs.unlink(localPath, emptyHandle);
    await this.server.bucketUploadPublic(blurLocalPath, blurRemotePath);
    fs.unlink(blurLocalPath, emptyHandle);

    midi = await Midi.findByIdAndUpdate(id, {$set: {
      coverUrl: this.server.bucketGetPublicUrl(remotePath), coverPath: remotePath,
      coverBlurUrl: this.server.bucketGetPublicUrl(blurRemotePath), coverBlurPath: blurRemotePath,
    }}, {new: true});
    success(done, serializeMidi(midi));
  }

  async onClWebMidiGet({id}, done) {
    debug('  onClWebMidiGet', id);

    if (!verifyObjectId(id)) return error(done, 'not found');

    const midi = await Midi.findById(id);
    if (!midi) return error(done, 'not found');

    success(done, serializeMidi(midi));
  }

  async onClWebMidiList({touhouAlbumIndex, touhouSongIndex, status, sort, page}, done) {
    touhouAlbumIndex = parseInt(touhouAlbumIndex);
    touhouSongIndex = parseInt(touhouSongIndex);
    status = String(status);
    sort = String(sort || '-uploadedDate');
    page = parseInt(page || 0);
    debug('  onClWebMidiList', touhouAlbumIndex, touhouSongIndex, status, sort, page);

    const query = {};

    if (touhouAlbumIndex > 0) {
      query.touhouAlbumIndex = touhouAlbumIndex;
      if (!isNaN(touhouSongIndex)) {
        query.touhouSongIndex = touhouSongIndex;
      }
    } else if (touhouAlbumIndex === -1) {
      query.touhouAlbumIndex = -1;
    }

    if (status !== 'undefined') {
      query.status = status;
    }

    const midis = await Midi.find(query)
        .sort(sort)
        .skip(MIDI_LIST_PAGE_LIMIT * page)
        .limit(MIDI_LIST_PAGE_LIMIT);

    success(done, midis.map((midi) => serializeMidi(midi)));
  }

  async onClWebBoardGetMessages(done) {
    debug('  onClWebBoardGetMessages');
    const messages = await Message.find().sort({date: -1}).limit(50).lean().exec();
    success(done, messages);
  }

  async onClWebBoardSendMessage({recaptcha, text}, done) {
    text = String(text);
    debug('  onClWebBoardSendMessages', text);

    const res = await verifyRecaptcha(recaptcha, this.socketIp);
    if (res !== true) return error(done, 'invalid recaptcha');

    const message = await Message.create({
      userId: this.user.id,
      userName: this.user.name,
      userAvatarUrl: this.user.avatarUrl,
      text,
      date: new Date(),
    });
    this.server.sendBoardMessage(message.toObject());
    success(done);
  }

  async onClWebBoardRequestMessageUpdate() {
    this.server.addBoardListener(this);
  }

  async onClWebBoardStopMessageUpdate() {
    this.server.removeBoardListener(this);
  }

  async onClAppUserLogin({email, password}, done) {
    debug('  onClAppUserLogin', email, password);

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

  async onClWebTranslate({src, lang}, done) {
    debug('  onClWebTranslate', src, lang);

    try {
      const text = await this.server.translationService.translate(src, lang);
      return success(done, text);
    } catch (e) {
      debug(e);
      return error(done, String(e));
    }
  }

  async onClWebBuildUpload({name, size, buffer}, done) {
    debug('  onClWebBuildUpload', name, size, buffer.length);

    if (!this.user) return error(done, 'forbidden');
    if (!this.checkUserRole(ROLE_SITE_OWNER)) return error(done, 'forbidden');
    if (size !== buffer.length) return error(done, 'tampering with api');

    let doc = await Build.findOne({name});
    if (doc) return success(done, {duplicated: true, id: doc.id});

    const remotePath = `/builds/${name}`;
    const localPath = `${this.server.tempPath}/${name}`;

    fs.writeFileSync(localPath, buffer);
    await this.server.bucketUploadPublic(localPath, remotePath);
    fs.unlink(localPath, emptyHandle);

    const tokens = name.split('-');
    const buildName = tokens[0];
    const build = tokens[1];
    const version = build.substr(0, build.length - 4);
    const nums = version.split('.');
    const buildInt = parseInt(nums[nums.length - 1]);

    doc = await Build.create({
      uploaderId: this.user.id,
      uploaderName: this.user.name,
      uploaderAvatarUrl: this.user.avatarUrl,

      name: buildName, desc: name,
      path: remotePath,
      build: buildInt, version,

      date: new Date(),
    });

    success(done, {id: doc.id});
  }

  async onClWebBuildUpdate(update, done) {
    debug('  onClWebBuildUpdate', update.id);

    const {
      id, build, version, name, desc,
    } = update;

    if (!this.user) return error(done, 'forbidden');
    if (!this.checkUserRole(ROLE_SITE_OWNER)) return error(done, 'forbidden');
    if (!verifyObjectId(id)) return error(done, 'forbidden');

    let doc = await Build.findById(id);
    if (!doc) return error(done, 'not found');
    if (!doc.uploaderId.equals(this.user.id)) return error(done, 'forbidden');

    update = filterUndefinedKeys({
      build, version, name, desc,
    });

    doc = await Build.findByIdAndUpdate(id, {$set: update}, {new: true});
    success(done, serializeBuild(doc));
  }

  async onClWebBuildGet({id}, done) {
    debug('  onClWebBuildGet', id);

    if (!verifyObjectId(id)) return error(done, 'not found');

    const build = await Build.findById(id);
    if (!build) return error(done, 'not found');

    success(done, serializeBuild(build));
  }

  checkUserRole(role) {
    if (!this.user || !this.user.roles || this.user.roles.length == 0) {
      return false;
    }
    if (this.user.roles.includes(role)) {
      return true;
    }
    return false;
  }

  async onClWebAlbumCreate(done) {
    const album = await Album.create({
      name: '',
      desc: '',
      date: new Date(),
      coverPath: null,
      coverBlurPath: null,
    });
    success(done, {id: album.id});
  }

  async onClWebAlbumGet({id}, done) {
    debug('  onClWebAlbumGet', id);

    if (!verifyObjectId(id)) return error(done, 'not found');

    const album = await Album.findById(id);
    if (!album) return error(done, 'not found');

    success(done, serializeAlbum(album));
  }

  async onClWebAlbumUploadCover({id, size, buffer}, done) {
    debug('  onClWebAlbumUploadCover', id, size, buffer.length);

    if (!this.user) return error(done, 'forbidden');
    if (!verifyObjectId(id)) return error(done, 'forbidden');
    if (size !== buffer.length) return error(done, 'tampering with api');
    if (size > MB) return error(done, 'tampering with api');

    let album = await Album.findById(id);
    if (!album) return error(done, 'not found');

    const hash = calcFileHash(buffer);
    const remotePath = `/imgs/${hash}.jpg`;
    const blurRemotePath = `/imgs/${hash}.png`;
    const localPath = `${this.server.tempPath}/${hash}.jpg`;
    const blurLocalPath = `${this.server.tempPath}/${hash}.png`;

    const cover = sharp(buffer).resize(256, 256);
    await cover.jpeg({quality: 80}).toFile(localPath);
    cover.modulate({brightness: 1.05, saturation: 2}).blur(12).resize(128, 128);
    await cover.png().toFile(blurLocalPath);

    await this.server.bucketUploadPublic(localPath, remotePath);
    fs.unlink(localPath, emptyHandle);
    await this.server.bucketUploadPublic(blurLocalPath, blurRemotePath);
    fs.unlink(blurLocalPath, emptyHandle);

    album = await Album.findByIdAndUpdate(id, {$set: {
      coverPath: remotePath,
      coverBlurPath: blurRemotePath,
    }}, {new: true});
    success(done, serializeAlbum(album));
  }

  async onClWebAlbumUpdate(update, done) {
    debug('  onClWebAlbumUpdate', update.id);

    const {
      id, name, desc,
    } = update;

    if (!this.user) return error(done, 'forbidden');
    if (!verifyObjectId(id)) return error(done, 'forbidden');

    let doc = await Album.findById(id);
    if (!doc) return error(done, 'not found');

    update = filterUndefinedKeys({
      name, desc,
    });

    doc = await Album.findByIdAndUpdate(id, {$set: update}, {new: true});
    success(done, serializeAlbum(doc));
  }

  async onClWebSongCreate(done) {
    debug('  onClWebSongCreate');

    if (!this.user) return error(done, 'forbidden');
    const song = await Song.create({
      albumId: null,
      composerId: null,
      name: '',
      desc: '',
      track: 0,
    });
    success(done, {id: song.id});
  }

  async onClWebSongGet({id}, done) {
    debug('  onClWebSongGet', id);

    if (!verifyObjectId(id)) return error(done, 'not found');

    const song = await Song.findById(id);
    if (!song) return error(done, 'not found');

    success(done, serializeSong(song));
  }

  async onClWebSongUpdate(update, done) {
    debug('  onClWebSongUpdate', update.id);

    const {
      id, albumId, composerId, name, desc, track,
    } = update;

    if (!this.user) return error(done, 'forbidden');
    if (!verifyObjectId(id)) return error(done, 'forbidden');

    let doc = await Song.findById(id);
    if (!doc) return error(done, 'not found');

    update = filterUndefinedKeys({
      albumId, composerId, name, desc, track,
    });

    doc = await Song.findByIdAndUpdate(id, {$set: update}, {new: true});
    success(done, serializeSong(doc));
  }

  async onClWebPersonCreate(done) {
    const person = await Person.create({
      name: '',
      desc: '',
      url: '',
      avatarPath: null,
    });
    success(done, {id: person.id});
  }

  async onClWebPersonGet({id}, done) {
    debug('  onClWebPersonGet', id);

    if (!verifyObjectId(id)) return error(done, 'not found');

    const person = await Person.findById(id);
    if (!person) return error(done, 'not found');

    success(done, serializePerson(person));
  }

  async onClWebPersonUploadAvatar({id, size, buffer}, done) {
    debug('  onClWebPersonUploadAvatar', id, size, buffer.length);

    if (!this.user) return error(done, 'forbidden');
    if (!verifyObjectId(id)) return error(done, 'forbidden');
    if (size !== buffer.length) return error(done, 'tampering with api');
    if (size > MB) return error(done, 'tampering with api');

    let person = await Person.findById(id);
    if (!person) return error(done, 'not found');

    const hash = calcFileHash(buffer);
    const remotePath = `/imgs/${hash}.jpg`;
    const localPath = `${this.server.tempPath}/${hash}.jpg`;

    const cover = sharp(buffer).resize(256, 256);
    await cover.jpeg({quality: 80}).toFile(localPath);

    await this.server.bucketUploadPublic(localPath, remotePath);
    fs.unlink(localPath, emptyHandle);

    person = await Person.findByIdAndUpdate(id, {$set: {
      avatarPath: remotePath,
    }}, {new: true});
    success(done, serializePerson(person));
  }

  async onClWebPersonUpdate(update, done) {
    debug('  onClWebPersonUpdate', update.id);

    const {
      id, name, desc, url,
    } = update;

    if (!this.user) return error(done, 'forbidden');
    if (!verifyObjectId(id)) return error(done, 'forbidden');

    let doc = await Person.findById(id);
    if (!doc) return error(done, 'not found');

    update = filterUndefinedKeys({
      name, desc, url,
    });

    doc = await Person.findByIdAndUpdate(id, {$set: update}, {new: true});
    success(done, serializePerson(doc));
  }

  async onClWebAlbumList(done) {
    const sort = String('-date');
    debug('  onClWebAlbumList');

    const albums = await Album.find({})
        .sort(sort);

    success(done, albums.map((album) => serializeAlbum(album)));
  }

  async onClWebSongList({albumId, page}, done) {
    page = parseInt(page || 0);
    debug('  onClWebSongList', albumId, page);

    const query = Song.aggregate([
      {$match: {albumId: new ObjectId(albumId)}},
      {
        $lookup: {
          from: 'persons',
          let: {'id': 'composerId'},
          pipeline: [{$project: {'name': 1, '_id': 0}}],
          as: 'composerName',
        },
      },
    ]);

    const songs = await query.exec();
    success(done, songs);
  }

  async onClWebPersonList(done) {
    const sort = String('-date');
    debug('  onClWebPersonList');

    const persons = await Person.find({})
        .sort(sort);

    success(done, persons.map((person) => serializePerson(person)));
  }
};
