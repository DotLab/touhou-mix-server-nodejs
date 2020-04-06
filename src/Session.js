const crypto = require('crypto');
const sharp = require('sharp');
const fs = require('fs');
const MidiParser = require('../node_modules/midi-parser-js/src/midi-parser');
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;
const util = require('util');
const exec = util.promisify(require('child_process').exec);

const debug = require('debug')('thmix:Session');

const {
  User, createDefaultUser, serializeUser,
  Midi, createDefaultMidi, serializeMidi,
  Message,
  Build, serializeBuild,
  Album, serializeAlbum,
  Song, serializeSong,
  Person, serializePerson,
  Soundfont, createDefaultSoundfont, serializeSoundfont,
  Resource, createDefaultResource, serializeResource,
  Trial, serializeTrial, serializePlay,
  Translation,
} = require('./models');

const {verifyRecaptcha, verifyObjectId, emptyHandle, sendCodeEmail, filterUndefinedKeys, sortQueryToSpec} = require('./utils');

/** @typedef {import('./Server')} Server */
/** @typedef {import('socket.io').Socket} Socket */

const INTENT_WEB = 'web';
const PASSWORD_HASHER = 'sha512';
const MB = 1048576;
const USER_LIST_PAGE_LIMIT = 50;
const MIDI_LIST_PAGE_LIMIT = 50;

const ROLE_MIDI_MOD = 'midi-mod';
const ROLE_MIDI_ADMIN = 'midi-admin';
const ROLE_TRANSLATION_MOD = 'translation-mod';
const ROLE_SITE_OWNER = 'site-owner';
const ROLE_ROOT = 'root';

const ROLE_PARENT_DICT = {
  [ROLE_MIDI_MOD]: ROLE_MIDI_ADMIN,
  [ROLE_MIDI_ADMIN]: ROLE_SITE_OWNER,

  [ROLE_TRANSLATION_MOD]: ROLE_SITE_OWNER,

  [ROLE_SITE_OWNER]: ROLE_ROOT,
};

const IMAGE = 'image';
const SOUND = 'sound';
const TRIAL_SCORING_VERSION = 3;

const ERROR_FORBIDDEN = 'no you cannot';

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

const COVER_HEIGHT = 250;
const COVER_WIDTH = 900;

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

  async uploadCover(buffer) {
    const hash = calcFileHash(buffer);
    const image = sharp(buffer);
    const meta = await image.metadata();

    // original
    const fileName = `${hash}.${meta.format}`;
    // cover size jpg
    const coverFileName = `${hash}-cover.jpg`;
    // blur png
    const blurFileName = `${hash}-blur.png`;

    const localPath = this.server.tempPath + '/' + fileName;
    const coverLocalPath = this.server.tempPath + '/' + coverFileName;
    const blurLocalPath = this.server.tempPath + '/' + blurFileName;

    const remotePath = '/imgs/' + fileName;
    const coverRemotePath = '/imgs/' + coverFileName;
    const blurRemotePath = '/imgs/' + blurFileName;

    // generate
    await Promise.all([
      image.toFile(localPath),
      meta.width > COVER_WIDTH && meta.height > COVER_HEIGHT ?
          // crop
          image.resize(COVER_WIDTH, COVER_HEIGHT).jpeg({quality: 80}).toFile(coverLocalPath) :
          image.jpeg({quality: 80}).toFile(coverLocalPath),
      image.resize(256, 256).modulate({brightness: 1.05, saturation: 2}).blur(12)
          .resize(128, 128).png().toFile(blurLocalPath),
    ]);

    // upload
    await Promise.all([
      this.server.bucketUploadPublic(localPath, remotePath),
      this.server.bucketUploadPublic(coverLocalPath, coverRemotePath),
      this.server.bucketUploadPublic(blurLocalPath, blurRemotePath),
    ]);

    fs.unlink(localPath, emptyHandle);
    fs.unlink(coverLocalPath, emptyHandle);
    fs.unlink(blurLocalPath, emptyHandle);

    return {
      path: remotePath,
      coverPath: coverRemotePath,
      blurPath: blurRemotePath,
    };
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
    this.socket.on('cl_web_midi_record_list', this.onClWebMidiRecordList.bind(this));
    this.socket.on('cl_web_midi_best_performance', this.onClWebMidiBestPerformance.bind(this));
    this.socket.on('cl_web_midi_most_played', this.onClWebMidiMostPlayed.bind(this));
    this.socket.on('cl_web_midi_recently_played', this.onClWebMidiRecentlyPlayed.bind(this));
    this.socket.on('cl_web_midi_play_history', this.onClWebMidiPlayHistory.bind(this));

    this.socket.on('cl_web_soundfont_get', this.onClWebSoundfontGet.bind(this));
    this.socket.on('cl_web_soundfont_list', this.onClWebSoundfontList.bind(this));
    this.socket.on('cl_web_soundfont_upload', this.onClWebSoundfontUpload.bind(this));
    this.socket.on('cl_web_soundfont_update', this.onClWebSoundfontUpdate.bind(this));
    this.socket.on('cl_web_soundfont_upload_cover', this.onClWebSoundfontUploadCover.bind(this));

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

    this.socket.on('cl_web_resource_get', this.onClWebResourceGet.bind(this));
    this.socket.on('cl_web_resource_list', this.onClWebResourceList.bind(this));
    this.socket.on('cl_web_resource_upload', this.onClWebResourceUpload.bind(this));
    this.socket.on('cl_web_resource_update', this.onClWebResourceUpdate.bind(this));

    this.socket.on('cl_web_translation_list', this.onClWebTranslationList.bind(this));
    this.socket.on('cl_web_translation_update', this.onClWebTranslationUpdate.bind(this));
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
        .sort('-performance -score')
        .skip(page * USER_LIST_PAGE_LIMIT)
        .limit(USER_LIST_PAGE_LIMIT);
    if (!users) return error(done, 'not found');

    success(done, users.map((user) => serializeUser(user)));
  }

  async onClWebUserUpdateBio({bio}, done) {
    debug('  onClWebUserUpdateBio', bio);

    if (!this.user) return error(done, ERROR_FORBIDDEN);

    this.user = await this.updateUser({bio});
    success(done, serializeUser(this.user));
  }

  async onClWebUserUpdatePassword({currentPassword, password}, done) {
    debug('  onClWebUserUpdatePassword', currentPassword, password);

    if (!this.user) return error(done, ERROR_FORBIDDEN);
    const hash = calcPasswordHash(currentPassword, this.user.salt);
    if (hash !== this.user.hash) return error(done, ERROR_FORBIDDEN);

    const newSalt = genPasswordSalt();
    const newHash = calcPasswordHash(password, newSalt);
    this.user = await this.updateUser({hash: newHash, salt: newSalt});

    success(done);
  }

  async onClWebUserUploadAvatar({size, buffer}, done) {
    debug('  onClWebUserUploadAvatar', size, buffer.length);

    if (!this.user) return error(done, ERROR_FORBIDDEN);
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

    if (!this.user) return error(done, ERROR_FORBIDDEN);
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

    let mp3RemotePath = `/sounds/${hash}.mp3`;
    const mp3LocalPath = `${this.server.tempPath}/${hash}.mp3`;
    try {
      debug('    generating mp3');
      await exec(`timidity ${localPath} -Ow -o - | ffmpeg -i - -acodec libmp3lame -ab 64k ${mp3LocalPath}`);
      await this.server.bucketUploadPublic(mp3LocalPath, mp3RemotePath);
      fs.unlink(mp3LocalPath, emptyHandle);
    } catch (e) {
      // cannot generate mp3
      debug('    generate mp3 failed');
      mp3RemotePath = null;
    }

    await this.server.bucketUploadPublic(localPath, remotePath);
    fs.unlink(localPath, emptyHandle);

    midi = await Midi.create({
      ...createDefaultMidi(),

      uploaderId: this.user.id,
      uploaderName: this.user.name,
      uploaderAvatarUrl: this.user.avatarUrl,

      mp3Path: mp3RemotePath,
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

    if (!this.user) return error(done, ERROR_FORBIDDEN);
    if (!verifyObjectId(id)) return error(done, ERROR_FORBIDDEN);

    let midi = await Midi.findById(id);
    if (!midi) return error(done, 'not found');
    if (!midi.uploaderId.equals(this.user.id) && !this.checkUserRole(ROLE_MIDI_MOD)) return error(done, ERROR_FORBIDDEN);

    update = filterUndefinedKeys({
      name, desc, artistName, artistUrl, albumId, songId, authorId: authorId ? authorId : undefined,
      sourceArtistName, sourceAlbumName, sourceSongName,
    });

    midi = await Midi.findByIdAndUpdate(id, {$set: update}, {new: true});
    success(done, serializeMidi(midi));
  }

  async onClWebMidiUploadCover({id, size, buffer}, done) {
    debug('  onClWebMidiUploadCover', id, size, buffer.length);

    if (!this.user) return error(done, ERROR_FORBIDDEN);
    if (!verifyObjectId(id)) return error(done, ERROR_FORBIDDEN);
    if (size !== buffer.length) return error(done, 'tampering with api');
    if (size > MB) return error(done, 'too large');

    let midi = await Midi.findById(id);
    if (!midi) return error(done, 'not found');
    if (!midi.uploaderId.equals(this.user.id) && !this.checkUserRole(ROLE_MIDI_MOD)) return error(done, ERROR_FORBIDDEN);

    const paths = await this.uploadCover(buffer);
    midi = await Midi.findByIdAndUpdate(id, {$set: {
      imagePath: paths.path,
      coverPath: paths.coverPath,
      coverBlurPath: paths.blurPath,
    }}, {new: true});

    success(done, serializeMidi(midi));
  }

  async onClWebMidiRecordList({id}, done) {
    debug('  onClWebMidiRecordList', id);

    const midi = await Midi.findOne({_id: new ObjectId(id)});
    if (!midi) return error(done, 'not found');

    const trials = await Trial.aggregate([
      {$match: {midiId: midi._id, version: TRIAL_SCORING_VERSION}},
      {$sort: {score: -1}},
      {$group: {_id: '$userId', first: {$first: '$$ROOT'}}},
      {$replaceWith: '$first'},
      {$lookup: {from: 'users', localField: 'userId', foreignField: '_id', as: 'user'}},
      {$unwind: {path: '$user', preserveNullAndEmptyArrays: true}},
      {$addFields: {userName: '$user.name', userAvatarUrl: '$user.avatarUrl'}},
      {$project: {user: 0}},
      {$sort: {score: -1}}]).exec();

    return success(done, trials);
  }

  async onClWebMidiGet({id}, done) {
    debug('  onClWebMidiGet', id);

    if (!verifyObjectId(id)) return error(done, 'not found');

    // const midi = await Midi.findById(id);
    // if (!midi) return error(done, 'not found');
    const query = Midi.aggregate([
      {$match: {_id: new ObjectId(id)}},
      {$lookup: {from: 'songs', localField: 'songId', foreignField: '_id', as: 'song'}},
      {$unwind: {path: '$song', preserveNullAndEmptyArrays: true}},
      {$lookup: {from: 'albums', localField: 'song.albumId', foreignField: '_id', as: 'album'}},
      {$unwind: {path: '$album', preserveNullAndEmptyArrays: true}},
    ]);
    const midi = await query.exec();
    success(done, serializeMidi(midi[0]));
  }

  async onClWebMidiList({albumId, songId, status, sort, page, search}, done) {
    status = String(status);
    sort = String(sort || '-uploadedDate');
    page = parseInt(page || 0);
    debug('  onClWebMidiList', albumId, songId, status, sort, page, search);

    const pipeline = [];
    if (search) {
      pipeline.push({$match: {$text: {$search: search}}});
    }
    if (songId) {
      pipeline.push({$match: {songId: new ObjectId(songId)}});
    }
    if (status !== 'undefined') {
      pipeline.push({$match: {status: status}});
    }
    pipeline.push({$lookup: {from: 'songs', localField: 'songId', foreignField: '_id', as: 'song'}});
    pipeline.push({$unwind: {path: '$song'}});
    if (albumId) {
      pipeline.push({$match: {'song.albumId': new ObjectId(albumId)}});
    }
    pipeline.push({$sort: sortQueryToSpec(sort)});
    pipeline.push({$skip: page * MIDI_LIST_PAGE_LIMIT});
    pipeline.push({$limit: MIDI_LIST_PAGE_LIMIT});
    pipeline.push({$lookup: {from: 'albums', localField: 'song.albumId', foreignField: '_id', as: 'album'}});
    pipeline.push({$unwind: {path: '$album', preserveNullAndEmptyArrays: true}});
    pipeline.push({$lookup: {from: 'composers', localField: 'song.composerId', foreignField: '_id', as: 'composer'}});
    pipeline.push({$unwind: {path: '$composer', preserveNullAndEmptyArrays: true}});

    const midis = await Midi.aggregate(pipeline);
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

  async onClWebTranslationList({lang}, done) {
    debug('  onClWebTranslationList', lang);
    return success(done, await Translation.find({lang, active: true}).sort({src: 1}).lean());
  }

  async onClWebTranslationUpdate({lang, src, text}, done) {
    debug('  onClWebTranslationUpdate', lang, src, text);
    if (!this.checkUserRole(ROLE_TRANSLATION_MOD)) return error(done, ERROR_FORBIDDEN);

    await Translation.updateMany({lang, src}, {$set: {active: false}});
    await Translation.updateOne({
      lang, src, editorId: this.user._id,
    }, {
      lang, src, text,
      editorId: this.user._id,
      editorName: this.user.name,
      active: true,
      date: new Date(),
    }, {upsert: true});

    return success(done);
  }

  async onClWebBuildUpload({name, size, buffer}, done) {
    debug('  onClWebBuildUpload', name, size, buffer.length);

    if (!this.user) return error(done, ERROR_FORBIDDEN);
    if (!this.checkUserRole(ROLE_SITE_OWNER)) return error(done, ERROR_FORBIDDEN);
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

    if (!this.user) return error(done, ERROR_FORBIDDEN);
    if (!this.checkUserRole(ROLE_SITE_OWNER)) return error(done, ERROR_FORBIDDEN);
    if (!verifyObjectId(id)) return error(done, ERROR_FORBIDDEN);

    let doc = await Build.findById(id);
    if (!doc) return error(done, 'not found');
    if (!doc.uploaderId.equals(this.user.id)) return error(done, ERROR_FORBIDDEN);

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
    while (ROLE_PARENT_DICT[role]) {
      role = ROLE_PARENT_DICT[role];
      if (this.user.roles.includes(role)) return true;
    }
    return false;
  }

  async onClWebAlbumCreate(done) {
    if (!this.user || !this.checkUserRole(ROLE_MIDI_ADMIN)) return error(done, ERROR_FORBIDDEN);
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
    if (!this.user || !this.checkUserRole(ROLE_MIDI_ADMIN)) return error(done, ERROR_FORBIDDEN);
    debug('  onClWebAlbumUploadCover', id, size, buffer.length);

    if (!this.user) return error(done, ERROR_FORBIDDEN);
    if (!verifyObjectId(id)) return error(done, ERROR_FORBIDDEN);
    if (size !== buffer.length) return error(done, 'tampering with api');
    if (size > MB) return error(done, 'tampering with api');

    let album = await Album.findById(id);
    if (!album) return error(done, 'not found');

    const paths = await this.uploadCover(buffer);
    album = await Album.findByIdAndUpdate(id, {$set: {
      imagePath: paths.path,
      coverPath: paths.coverPath,
      coverBlurPath: paths.blurPath,
    }}, {new: true});
    success(done, serializeAlbum(album));
  }

  async onClWebAlbumUpdate(update, done) {
    if (!this.user || !this.checkUserRole(ROLE_MIDI_ADMIN)) return error(done, ERROR_FORBIDDEN);
    debug('  onClWebAlbumUpdate', update.id);

    const {
      id, name, desc,
    } = update;

    if (!this.user) return error(done, ERROR_FORBIDDEN);
    if (!verifyObjectId(id)) return error(done, ERROR_FORBIDDEN);

    let doc = await Album.findById(id);
    if (!doc) return error(done, 'not found');

    update = filterUndefinedKeys({
      name, desc,
    });

    doc = await Album.findByIdAndUpdate(id, {$set: update}, {new: true});
    success(done, serializeAlbum(doc));
  }

  async onClWebSongCreate(done) {
    if (!this.user || !this.checkUserRole(ROLE_MIDI_ADMIN)) return error(done, ERROR_FORBIDDEN);
    debug('  onClWebSongCreate');

    if (!this.user) return error(done, ERROR_FORBIDDEN);
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
    if (!this.user || !this.checkUserRole(ROLE_MIDI_ADMIN)) return error(done, ERROR_FORBIDDEN);
    debug('  onClWebSongUpdate', update.id);

    const {
      id, albumId, composerId, name, desc, track,
    } = update;

    if (!this.user) return error(done, ERROR_FORBIDDEN);
    if (!verifyObjectId(id)) return error(done, ERROR_FORBIDDEN);

    let doc = await Song.findById(id);
    if (!doc) return error(done, 'not found');

    update = filterUndefinedKeys({
      albumId, composerId, name, desc, track,
    });

    doc = await Song.findByIdAndUpdate(id, {$set: update}, {new: true});
    success(done, serializeSong(doc));
  }

  async onClWebPersonCreate(done) {
    if (!this.user || !this.checkUserRole(ROLE_MIDI_ADMIN)) return error(done, ERROR_FORBIDDEN);
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
    if (!this.user || !this.checkUserRole(ROLE_MIDI_ADMIN)) return error(done, ERROR_FORBIDDEN);
    debug('  onClWebPersonUploadAvatar', id, size, buffer.length);

    if (!this.user) return error(done, ERROR_FORBIDDEN);
    if (!verifyObjectId(id)) return error(done, ERROR_FORBIDDEN);
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
    if (!this.user || !this.checkUserRole(ROLE_MIDI_ADMIN)) return error(done, ERROR_FORBIDDEN);
    debug('  onClWebPersonUpdate', update.id);

    const {
      id, name, desc, url,
    } = update;

    if (!this.user) return error(done, ERROR_FORBIDDEN);
    if (!verifyObjectId(id)) return error(done, ERROR_FORBIDDEN);

    let doc = await Person.findById(id);
    if (!doc) return error(done, 'not found');

    update = filterUndefinedKeys({
      name, desc, url,
    });

    doc = await Person.findByIdAndUpdate(id, {$set: update}, {new: true});
    success(done, serializePerson(doc));
  }

  async onClWebAlbumList(done) {
    debug('  onClWebAlbumList');

    const albums = await Song.aggregate([
      {$lookup: {from: 'persons', localField: 'composerId', foreignField: '_id', as: 'composer'}},
      {$unwind: {path: '$composer', preserveNullAndEmptyArrays: true}},
      {$group: {_id: '$albumId', songs: {$push: '$$ROOT'}}},
      {$lookup: {from: 'albums', localField: '_id', foreignField: '_id', as: 'album'}},
      {$unwind: {path: '$album', preserveNullAndEmptyArrays: true}},
      {$addFields: {'album.songs': '$songs'}},
      {$replaceRoot: {newRoot: '$album'}},
      {$sort: {date: -1}},
    ]);

    success(done, albums.map((x) => serializeAlbum(x)));
  }

  async onClWebSongList({albumId, page}, done) {
    page = parseInt(page || 0);
    debug('  onClWebSongList', albumId, page);

    const songs = await Song.find({albumId: albumId});
    success(done, songs.map((song) => serializeSong(song)));
  }

  async onClWebPersonList(done) {
    const sort = String('-date');
    debug('  onClWebPersonList');

    const persons = await Person.find({})
        .sort(sort);

    success(done, persons.map((person) => serializePerson(person)));
  }

  async onClWebSoundfontUpload({name, size, buffer}, done) {
    debug('  onClWebSoundfontUpload', name, size, buffer.length);

    if (!this.user) return error(done, ERROR_FORBIDDEN);
    if (size !== buffer.length) return error(done, 'tampering with api');
    if (size > 50 * MB) return error(done, 'tampering with api');

    const hash = calcFileHash(buffer);
    const remotePath = `/soundfonts/${hash}.sf2`;
    const localPath = `${this.server.tempPath}/${hash}.sf2`;

    let soundfont = await Soundfont.findOne({hash});
    if (soundfont) return success(done, {duplicated: true, id: soundfont.id});

    fs.writeFileSync(localPath, buffer);
    await this.server.bucketUploadPublic(localPath, remotePath);
    fs.unlink(localPath, emptyHandle);

    soundfont = await Soundfont.create({
      ...createDefaultSoundfont(),

      uploaderId: this.user.id,
      uploaderName: this.user.name,
      uploaderAvatarUrl: this.user.avatarUrl,

      name, desc: name,
      hash, path: remotePath,

      uploadedDate: new Date(),
    });

    success(done, {id: soundfont.id});
  }

  async onClWebSoundfontUpdate(update, done) {
    debug('  onClWebSoundfontUpdate', update.id);

    const {
      id, uploaderId, uploaderName, uploaderAvatarUrl, name,
      nameEng, desc, hash, path, uploadedDate, status,
    } = update;

    if (!this.user) return error(done, ERROR_FORBIDDEN);
    if (!verifyObjectId(id)) return error(done, ERROR_FORBIDDEN);

    let soundfont = await Soundfont.findById(id);
    if (!soundfont) return error(done, 'not found');
    if (!soundfont.uploaderId.equals(this.user.id)) return error(done, ERROR_FORBIDDEN);

    update = filterUndefinedKeys({
      uploaderId, uploaderName, uploaderAvatarUrl, name,
      nameEng, desc, hash, path, uploadedDate, status,
    });

    soundfont = await Soundfont.findByIdAndUpdate(id, {$set: update}, {new: true});
    success(done, serializeMidi(soundfont));
  }

  async onClWebSoundfontUploadCover({id, size, buffer}, done) {
    debug('  onClWebSoundfontUploadCover', id, size, buffer.length);

    if (!this.user) return error(done, ERROR_FORBIDDEN);
    if (!verifyObjectId(id)) return error(done, ERROR_FORBIDDEN);
    if (size !== buffer.length) return error(done, 'tampering with api');
    if (size > MB) return error(done, 'tampering with api');

    let soundfont = await Soundfont.findById(id);
    if (!soundfont) return error(done, 'not found');
    if (!soundfont.uploaderId.equals(this.user.id)) return error(done, ERROR_FORBIDDEN);

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

    soundfont = await Soundfont.findByIdAndUpdate(id, {$set: {
      coverUrl: this.server.bucketGetPublicUrl(remotePath), coverPath: remotePath,
      coverBlurUrl: this.server.bucketGetPublicUrl(blurRemotePath), coverBlurPath: blurRemotePath,
    }}, {new: true});
    success(done, serializeSoundfont(soundfont));
  }

  async onClWebSoundfontGet({id}, done) {
    debug('  onClWebSoundfontGet', id);

    if (!verifyObjectId(id)) return error(done, 'not found');

    const soundfont = await Soundfont.findById(id);
    if (!soundfont) return error(done, 'not found');

    success(done, serializeSoundfont(soundfont));
  }

  async onClWebSoundfontList({status, sort, page}, done) {
    status = String(status);
    sort = String(sort || '-approvedDate');
    page = parseInt(page || 0);
    debug('  onClWebSoundfontList', status, sort, page);

    const query = {};

    if (status !== 'undefined') {
      query.status = status;
    }

    const soundfonts = await Soundfont.find(query)
        .sort(sort)
        .skip(MIDI_LIST_PAGE_LIMIT * page)
        .limit(MIDI_LIST_PAGE_LIMIT);

    success(done, soundfonts.map((soundfont) => serializeSoundfont(soundfont)));
  }

  async onClWebResourceGet({id}, done) {
    debug('  onClWebResourceGet', id);

    if (!verifyObjectId(id)) return error(done, 'not found');

    const resource = await Resource.findById(id);
    if (!resource) return error(done, 'not found');

    success(done, serializeResource(resource));
  }

  async onClWebResourceList({type, status, sort, page}, done) {
    status = String(status);
    sort = String(sort || '-approvedDate');
    page = parseInt(page || 0);
    debug('  onClWebResourceList', type, status, sort, page);

    const query = {};
    if (type) {
      query.type = type;
    }
    if (status !== 'undefined') {
      query.status = status;
    }
    debug(query, type, status);

    const resources = await Resource.find(query)
        .sort(sort)
        .skip(MIDI_LIST_PAGE_LIMIT * page)
        .limit(MIDI_LIST_PAGE_LIMIT);
    debug(resources);
    success(done, resources.map((resource) => serializeResource(resource)));
  }

  async onClWebResourceUpload({name, size, buffer}, done) {
    debug('  onClWebResourceUpload', name, size, buffer.length);

    if (!this.user) return error(done, ERROR_FORBIDDEN);
    if (size !== buffer.length) return error(done, 'tampering with api');
    if (size > 1000 * MB) return error(done, 'tampering with api');

    const hash = calcFileHash(buffer);

    let remotePath;
    let localPath;
    let type;
    let resource = await Resource.findOne({hash});
    if (resource) return success(done, {duplicated: true, id: resource.id});

    if (name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.jpg')) {
      remotePath = `/resources/img/${hash}.png`;
      localPath = `${this.server.tempPath}/${hash}.png`;
      type = IMAGE;
    } else {
      remotePath = `/resources/sound/${hash}.ogg`;
      localPath = `${this.server.tempPath}/${hash}.ogg`;
      type = SOUND;
    }

    fs.writeFileSync(localPath, buffer);
    await this.server.bucketUploadPublic(localPath, remotePath);
    fs.unlink(localPath, emptyHandle);

    resource = await Resource.create({
      ...createDefaultResource(),

      uploaderId: this.user.id,
      uploaderName: this.user.name,
      uploaderAvatarUrl: this.user.avatarUrl,

      name, type, desc: name,
      hash, path: remotePath,

      uploadedDate: new Date(),
    });

    success(done, {id: resource.id});
  }

  async onClWebResourceUpdate(update, done) {
    debug('  onClWebResourceUpdate', update.id);

    const {
      id, name, desc,
    } = update;

    if (!this.user) return error(done, ERROR_FORBIDDEN);
    if (!verifyObjectId(id)) return error(done, ERROR_FORBIDDEN);

    let resource = await Resource.findById(id);
    if (!resource) return error(done, 'not found');
    if (!resource.uploaderId.equals(this.user.id)) return error(done, ERROR_FORBIDDEN);

    update = filterUndefinedKeys({
      name, desc,
    });

    resource = await Resource.findByIdAndUpdate(id, {$set: update}, {new: true});
    success(done, serializeResource(resource));
  }

  async onClWebMidiBestPerformance({id}, done) {
    debug('  onClWebMidiBestPerformance', id);

    const trials = await Trial.aggregate([
      {$match: {userId: new ObjectId(id), version: TRIAL_SCORING_VERSION}},
      {$group: {_id: '$midiId', first: {$first: '$$ROOT'}}},
      {$replaceWith: '$first'},
      {$sort: {score: -1}},
      {$limit: 5},
      {$lookup: {from: 'midis', let: {id: '$midiId'}, pipeline: [
        {$match: {$expr: {$eq: ['$_id', '$$id']}}},
        {$lookup: {from: 'songs', localField: 'songId', foreignField: '_id', as: 'song'}}, // related songs
        {$unwind: {path: '$song', preserveNullAndEmptyArrays: true}},
        {$lookup: {from: 'albums', localField: 'song.albumId', foreignField: '_id', as: 'album'}}, // related albums
        {$unwind: {path: '$album', preserveNullAndEmptyArrays: true}},
      ], as: 'midi'}},
      {$unwind: {path: '$midi', preserveNullAndEmptyArrays: true}},
    ]).exec();

    success(done, trials.map((x) => serializeTrial(x)));
  }

  async onClWebMidiMostPlayed({id}, done) {
    debug('  onClWebMidiMostPlayed', id);

    const plays = await Trial.aggregate([
      {$match: {userId: new ObjectId(id)}},
      {$group: {_id: '$midiId', count: {$sum: 1}}},
      {$lookup: {from: 'midis', localField: '_id', foreignField: '_id', as: 'midi'}}, // related midis
      {$unwind: {path: '$midi', preserveNullAndEmptyArrays: true}},
      {$lookup: {from: 'songs', localField: 'midi.songId', foreignField: '_id', as: 'song'}}, // related songs
      {$unwind: {path: '$song', preserveNullAndEmptyArrays: true}},
      {$lookup: {from: 'albums', localField: 'song.albumId', foreignField: '_id', as: 'album'}}, // related albums
      {$unwind: {path: '$album', preserveNullAndEmptyArrays: true}},
      {$lookup: {from: 'persons', localField: 'song.composerId', foreignField: '_id', as: 'composer'}}, // composer
      {$unwind: {path: '$composer', preserveNullAndEmptyArrays: true}},
      {$sort: {count: -1}},
      {$limit: 5},
    ]).exec();

    success(done, plays.map((x) => serializePlay(x)));
  }

  async onClWebMidiRecentlyPlayed({id}, done) {
    debug('  onClWebMidiRecentlyPlayed', id);

    const trials = await Trial.aggregate([
      {$match: {userId: new ObjectId(id)}},
      {$sort: {date: -1}},
      {$lookup: {from: 'midis', let: {id: '$midiId'}, pipeline: [
        {$match: {$expr: {$eq: ['$_id', '$$id']}}},
        {$lookup: {from: 'songs', localField: 'songId', foreignField: '_id', as: 'song'}}, // related songs
        {$unwind: {path: '$song', preserveNullAndEmptyArrays: true}},
        {$lookup: {from: 'albums', localField: 'song.albumId', foreignField: '_id', as: 'album'}}, // related albums
        {$unwind: {path: '$album', preserveNullAndEmptyArrays: true}},
      ], as: 'midi'}},
      {$unwind: {path: '$midi', preserveNullAndEmptyArrays: true}},
      {$limit: 5},
    ]).exec();

    success(done, trials.map((x) => serializeTrial(x)));
  }

  async onClWebMidiPlayHistory({id, startDate, endDate, interval}, done) {
    startDate = new Date(startDate);
    endDate = new Date(endDate);
    debug('  onClWebMidiPlayHistory', startDate, endDate);

    const trials = await Trial.aggregate([
      {$match: {userId: new ObjectId(id), date: {$gte: startDate, $lte: endDate}}},
      {$sort: {date: 1}},
      {$group: {
        _id: {$floor: {$divide: [{$subtract: [endDate, '$date']}, interval]}},
        h: {$max: '$score'},
        l: {$min: '$score'},
        o: {$first: '$score'},
        c: {$last: '$score'},
        v: {$sum: 1},
      }},
      {$sort: {_id: -1}},
      {$limit: 100},
      {$addFields: {
        // 1 2 3 4 5 (1, 5, 2)
        //   |_1 |_0 (endDate - $date) / interval
        //   |_2 |_0 (((endDate - $date) / interval) * interval)
        //   \_3 \_5 (endDate - ((endDate - $date) / interval) * interval)
        t: {$subtract: [endDate, {$multiply: ['$_id', interval]}]},
      }},
      {$project: {_id: 0}},
    ]).exec();

    success(done, trials);
  }
};
