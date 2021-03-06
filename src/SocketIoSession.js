const crypto = require('crypto');
const fs = require('fs');
const MidiParser = require('../node_modules/midi-parser-js/src/midi-parser');
const mongoose = require('mongoose');
const sharp = require('sharp');
const ObjectId = mongoose.Types.ObjectId;
const debug = require('debug')('thmix:SocketIoSession');
const exec = require('util').promisify(require('child_process').exec);
const {
  midiController,
  commentController,
} = require('./controllers');
const {
  ROLE_MIDI_MOD,
  ROLE_MIDI_ADMIN,
  ROLE_CARD_MOD,
  ROLE_CARDPOOL_MOD,
  ROLE_EVENT_MOD,
  ROLE_TRANSLATION_MOD,
  ROLE_SITE_OWNER,
  checkUserRole,
} = require('./services/RoleService');
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
  SessionToken, genSessionTokenHash,
  SessionRecord,
  ErrorReport, serializeErrorReport,
  Card, createDefaultCard, serializeCard,
  CardPool, createDefaultCardPool, serializeCardPool,
  serializeRanking,
  Event, createDefaultEvent, serializeEvent,
} = require('./models');
const {NAME_ARTIFACT, UI_APP, UI_WEB} = require('./TranslationService');

const {verifyRecaptcha, verifyObjectId, emptyHandle, sendCodeEmail, filterUndefinedKeys, deleteEmptyKeys, sortQueryToSpec, getTimeBetween} = require('./utils');

/** @typedef {import('./SocketIoServer')} SocketIoServer */
/** @typedef {import('socket.io').Socket} Socket */

const INTENT_WEB = 'web';
const PASSWORD_HASHER = 'sha512';
const MB = 1048576;
const USER_LIST_PAGE_LIMIT = 50;
const MIDI_LIST_PAGE_LIMIT = 50;
const ALBUM_LIST_PAGE_LIMIT = 10;

const IMAGE = 'image';
const SOUND = 'sound';
const TRIAL_SCORING_VERSION = 3;

const ERROR_FORBIDDEN = 'no you cannot';

function codeError(code, error) {
  return `${error} (${code})`;
}

function success(done, data) {
  debug('    success');
  if (typeof done === 'function') done({success: true, data});
  else debug('  done is not a function');
}

function error(done, data) {
  debug('    error', data);
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

function createRpcHandler(resolver) {
  return async function(args, done) {
    try {
      const res = await resolver(args);
      return success(done, res);
    } catch (e) {
      return error(done, e);
    }
  };
}

const CARD_COVER_HEIGHT = 200;
const CARD_COVER_WIDTH = 150;
const COVER_HEIGHT = 250;
const COVER_WIDTH = 900;
const EVENT_COVER_HEIGHT = 600;
const EVENT_COVER_WIDTH = 900;

module.exports = class SocketIoSession {
  /**
   * @param {SocketIoServer} server
   * @param {Socket} socket
   */
  constructor(server, socket) {
    /** @type {SocketIoServer} */
    this.server = server;
    /** @type {Socket} */
    this.socket = socket;
    /** @type {string} */
    this.socketId = socket.id;
    /** @type {string} */
    this.socketIp = socket.handshake.headers['x-forwarded-for'];

    this.user = null;
    this.pendingCode = null;
    this.sessionToken = null;
    this.sessionRecord = null;

    socket.on('cl_handshake', this.onClHandshake.bind(this));
    socket.on('disconnect', this.onDisconnect.bind(this));
  }

  updateUser(spec) {
    return User.findByIdAndUpdate(this.user.id, spec, {new: true});
  }

  async uploadCover(buffer, height, width) {
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
      meta.width > width || meta.height > height ?
          // crop
          image.resize(width, height).jpeg({quality: 80}).toFile(coverLocalPath) :
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

  async onDisconnect() {
    debug('  onDisconnect', this.socketId);

    if (this.sessionRecord) {
      this.sessionRecord = await SessionRecord.findByIdAndUpdate(this.sessionRecord._id, {$set: {endDate: new Date()}}, {new: true});
      await User.updateOne({_id: this.user._id}, {$inc: {onlineTime: getTimeBetween(this.sessionRecord.endDate, this.sessionRecord.startDate)}});
      debug('    user', this.user.name, getTimeBetween(this.sessionRecord.endDate, this.sessionRecord.startDate) / 1000);
    }
    this.server.disposeSession(this.socketId);
  }

  listenWebClient() {
    this.socket.on('cl_web_user_register', this.onClWebUserRegister.bind(this));
    this.socket.on('cl_web_user_register_pre', this.onClWebUserRegisterPre.bind(this));
    this.socket.on('cl_web_user_login', this.onClWebUserLogin.bind(this));
    this.socket.on('cl_web_user_resume_session', this.onClWebUserResumeSession.bind(this));
    this.socket.on('cl_web_user_get', this.onClWebUserGet.bind(this));
    this.socket.on('cl_web_user_list', this.onClWebUserList.bind(this));
    this.socket.on('cl_web_user_update_bio', this.onClWebUserUpdateBio.bind(this));
    this.socket.on('cl_web_user_update_password', this.onClWebUserUpdatePassword.bind(this));
    this.socket.on('cl_web_user_upload_avatar', this.onClWebUserUploadAvatar.bind(this));

    this.socket.on('cl_web_midi_get', createRpcHandler(this.onClWebMidiGet.bind(this)));
    this.socket.on('cl_web_midi_list', this.onClWebMidiList.bind(this));
    this.socket.on('cl_web_midi_upload', this.onClWebMidiUpload.bind(this));
    this.socket.on('cl_web_midi_update', this.onClWebMidiUpdate.bind(this));
    this.socket.on('cl_web_midi_upload_cover', this.onClWebMidiUploadCover.bind(this));
    this.socket.on('cl_web_midi_record_list', this.onClWebMidiRecordList.bind(this));
    this.socket.on('cl_web_midi_best_performance', this.onClWebMidiBestPerformance.bind(this));
    this.socket.on('cl_web_midi_most_played', this.onClWebMidiMostPlayed.bind(this));
    this.socket.on('cl_web_midi_recently_played', this.onClWebMidiRecentlyPlayed.bind(this));
    this.socket.on('cl_web_midi_play_history', this.onClWebMidiPlayHistory.bind(this));
    this.socket.on('ClWebMidiChangeStatus', createRpcHandler(this.onClWebMidiChangeStatus.bind(this)));

    this.socket.on('cl_web_soundfont_get', this.onClWebSoundfontGet.bind(this));
    this.socket.on('cl_web_soundfont_list', this.onClWebSoundfontList.bind(this));
    this.socket.on('cl_web_soundfont_upload', this.onClWebSoundfontUpload.bind(this));
    this.socket.on('cl_web_soundfont_update', this.onClWebSoundfontUpdate.bind(this));
    this.socket.on('cl_web_soundfont_upload_cover', this.onClWebSoundfontUploadCover.bind(this));

    this.socket.on('cl_web_board_get_messages', this.onClWebBoardGetMessages.bind(this));
    this.socket.on('cl_web_board_request_message_update', this.onClWebBoardRequestMessageUpdate.bind(this));
    this.socket.on('cl_web_board_stop_message_update', this.onClWebBoardStopMessageUpdate.bind(this));
    this.socket.on('cl_web_board_send_message', this.onClWebBoardSendMessage.bind(this));

    this.socket.on('cl_web_build_get', this.onClWebBuildGet.bind(this));
    this.socket.on('cl_web_build_upload', this.onClWebBuildUpload.bind(this));
    this.socket.on('cl_web_build_update', this.onClWebBuildUpdate.bind(this));

    this.socket.on('cl_web_album_create', this.onClWebAlbumCreate.bind(this));
    this.socket.on('cl_web_album_get', this.onClWebAlbumGet.bind(this));
    this.socket.on('cl_web_album_update', this.onClWebAlbumUpdate.bind(this));
    this.socket.on('cl_web_album_upload_cover', this.onClWebAlbumUploadCover.bind(this));
    this.socket.on('cl_web_album_list', this.onClWebAlbumList.bind(this));
    this.socket.on('cl_web_album_info_list', this.onClWebAlbumInfoList.bind(this));

    this.socket.on('cl_web_song_create', this.onClWebSongCreate.bind(this));
    this.socket.on('cl_web_song_get', this.onClWebSongGet.bind(this));
    this.socket.on('cl_web_song_update', this.onClWebSongUpdate.bind(this));
    this.socket.on('cl_web_song_list', this.onClWebSongList.bind(this));

    this.socket.on('ClWebCardCreate', createRpcHandler(this.onClWebCardCreate.bind(this)));
    this.socket.on('ClWebCardGet', createRpcHandler(this.onClWebCardGet.bind(this)));
    this.socket.on('ClWebCardUploadCover', createRpcHandler(this.onClWebCardUploadCover.bind(this)));
    this.socket.on('ClWebCardUpdate', createRpcHandler(this.onClWebCardUpdate.bind(this)));
    this.socket.on('ClWebCardList', createRpcHandler(this.onClWebCardList.bind(this)));

    this.socket.on('ClWebCardPoolCreate', createRpcHandler(this.onClWebCardPoolCreate.bind(this)));
    this.socket.on('ClWebCardPoolGet', createRpcHandler(this.onClWebCardPoolGet.bind(this)));
    this.socket.on('ClWebCardPoolUpdate', createRpcHandler(this.onClWebCardPoolUpdate.bind(this)));
    this.socket.on('ClWebCardPoolList', createRpcHandler(this.onClWebCardPoolList.bind(this)));

    this.socket.on('ClWebEventCreate', createRpcHandler(this.onClWebEventCreate.bind(this)));
    this.socket.on('ClWebEventGet', createRpcHandler(this.onClWebEventGet.bind(this)));
    this.socket.on('ClWebEventGetMidiList', createRpcHandler(this.onClWebEventGetMidiList.bind(this)));
    this.socket.on('ClWebEventUploadCover', createRpcHandler(this.onClWebEventUploadCover.bind(this)));
    this.socket.on('ClWebEventUpdate', createRpcHandler(this.onClWebEventUpdate.bind(this)));
    this.socket.on('ClWebEventRanking', createRpcHandler(this.onClWebEventRanking.bind(this)));

    this.socket.on('cl_web_person_create', this.onClWebPersonCreate.bind(this));
    this.socket.on('cl_web_person_get', this.onClWebPersonGet.bind(this));
    this.socket.on('cl_web_person_update', this.onClWebPersonUpdate.bind(this));
    this.socket.on('cl_web_person_upload_avatar', this.onClWebPersonUploadAvatar.bind(this));
    this.socket.on('cl_web_person_list', this.onClWebPersonList.bind(this));

    this.socket.on('cl_web_resource_get', this.onClWebResourceGet.bind(this));
    this.socket.on('cl_web_resource_list', this.onClWebResourceList.bind(this));
    this.socket.on('cl_web_resource_upload', this.onClWebResourceUpload.bind(this));
    this.socket.on('cl_web_resource_update', this.onClWebResourceUpdate.bind(this));

    this.socket.on('cl_web_translate', this.onClWebTranslate.bind(this));
    this.socket.on('cl_web_translation_list', this.onClWebTranslationList.bind(this));
    this.socket.on('cl_web_translation_update', this.onClWebTranslationUpdate.bind(this));

    this.socket.on('ClVersionList', createRpcHandler(this.onClVersionList.bind(this)));

    this.socket.on('ClErrorList', createRpcHandler(this.onClErrorList.bind(this)));

    this.socket.on('ClWebDocCommentCreate', createRpcHandler(this.onClWebDocCommentCreate.bind(this)));
    this.socket.on('ClWebDocCommentList', createRpcHandler(this.onClWebDocCommentList.bind(this)));

    this.socket.on('ClWebMidiCustomizedAlbumList', createRpcHandler(this.onClWebMidiCustomizedAlbumList.bind(this)));

    this.socket.on('ClWebServerStatus', createRpcHandler(this.onClWebServerStatus.bind(this)));
  }

  listenAppClient() {
    this.socket.on('cl_app_user_login', this.onClAppUserLogin.bind(this));
  }

  async onClWebServerStatus(_) {
    debug('  onClWebServerStatus');

    const playerCount = await User.count({});
    const onlineCount = Object.keys(this.server.sessions).length;
    const gameCount = Object.keys(this.server.webSocketServer.sessionDict).length;
    if (this.server.peakOnlineCount < onlineCount + gameCount) {
      this.server.peakOnlineCount = onlineCount + gameCount;
    }
    return {
      revision: this.server.revision,
      playerCount, onlineCount, gameCount,
      peakOnlineCount: this.server.peakOnlineCount,
    };
  }

  async onClWebUserRegisterPre({recaptcha, name, email}, done) {
    debug('  onClWebUserRegisterPre', name, email);

    const res = await verifyRecaptcha(recaptcha, this.socketIp);
    if (res !== true) return error(done, 'invalid recaptcha');

    const user = await User.findOne({$or: [{name}, {email}]});
    if (user) return error(done, 'existing name or email');

    this.pendingCode = genPendingCode();
    debug('    code', this.pendingCode);
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
    if (!user) return error(done, 'email not found');

    const hash = calcPasswordHash(password, user.salt);
    if (hash !== user.hash) return error(done, 'wrong password');

    this.user = user;
    this.user = await this.updateUser({seenDate: new Date()});

    await SessionToken.updateMany({userId: user._id, valid: true}, {
      $set: {valid: false, invalidatedDate: new Date()},
    });
    this.sessionToken = await SessionToken.create({
      userId: user._id, hash: genSessionTokenHash(), valid: true,
      issuedDate: new Date(), seenDate: new Date(),
    });
    this.sessionRecord = await SessionRecord.create({
      userId: user._id, tokenId: this.sessionToken._id,
      startDate: new Date(), endDate: new Date(),
    });

    return success(done, {
      ...serializeUser(this.user),
      sessionTokenHash: this.sessionToken.hash,
    });
  }

  async onClWebUserResumeSession({hash}, done) {
    debug('  onClWebUserResumeSession', hash);

    const token = await SessionToken.findOne({hash, valid: true});
    if (!token) return error(done, codeError(0, ERROR_FORBIDDEN));
    this.sessionToken = await SessionToken.findByIdAndUpdate({_id: token._id}, {$set: {seenDate: new Date()}}, {new: true});

    this.user = await User.findByIdAndUpdate(this.sessionToken.userId, {$set: {seenDate: new Date()}}, {new: true});
    this.sessionRecord = await SessionRecord.create({
      userId: this.user._id, tokenId: this.sessionToken._id,
      startDate: new Date(), endDate: new Date(),
    });

    return success(done, serializeUser(this.user));
  }

  async onClWebUserGet({id}, done) {
    debug('  onClWebUserGet', id);

    if (!verifyObjectId(id)) return error(done, 'not found');

    const user = await User.findById(id);
    if (!user) return error(done, 'not found');

    success(done, serializeUser(user));
  }

  async onClWebUserList({page, year}, done) {
    debug('  onClWebUserList', page, year);

    if (!(page > 0)) page = 0; // filter null and undefined

    const pipeline = [];
    if (!year) {
      pipeline.push({$match: {withdrew: false}});
    } else {
      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year + 1, 0, 1);
      pipeline.push({$match: {$and: [{withdrew: false, date: {$gte: startDate, $lte: endDate}}]}});
    }

    pipeline.push({$group: {
      _id: '$userId',
      playTime: {$sum: '$duration'},
      trialCount: {$sum: 1},
      score: {$sum: '$score'},
      avgCombo: {$avg: '$combo'},
      avgAccuracy: {$avg: '$accuracy'},
      performance: {$sum: '$performance'},
    }});
    pipeline.push({$lookup: {from: 'users', localField: '_id', foreignField: '_id', as: 'user'}});
    pipeline.push({$unwind: {path: '$user', preserveNullAndEmptyArrays: true}});
    pipeline.push({$addFields: {
      'user.playTime': '$playTime',
      'user.trialCount': '$trialCount',
      'user.score': '$score',
      'user.avgCombo': '$avgCombo',
      'user.avgAccuracy': '$avgAccuracy',
      'user.performance': '$performance',
    }});
    pipeline.push({$replaceRoot: {newRoot: '$user'}});
    pipeline.push({$sort: {performance: -1}});
    pipeline.push({$skip: page * USER_LIST_PAGE_LIMIT});
    pipeline.push({$limit: USER_LIST_PAGE_LIMIT});

    const rankings = await Trial.aggregate(pipeline);

    success(done, rankings.map((x) => serializeRanking(x) ));
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
    if (size > 10 * MB) return error(done, 'file too large');

    const hash = calcFileHash(buffer);
    const midiFile = MidiParser.parse(buffer);
    if (!midiFile || !(midiFile.tracks > 0)) return error(done, 'cannot parse MIDI file');

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
      derivedFromId, supersedeId,
    } = update;

    if (!this.user) return error(done, ERROR_FORBIDDEN);
    if (!verifyObjectId(id)) return error(done, ERROR_FORBIDDEN);

    let midi = await Midi.findById(id);
    if (!midi) return error(done, 'not found');
    if (!midi.uploaderId.equals(this.user.id) && !this.checkUserRole(ROLE_MIDI_MOD)) return error(done, ERROR_FORBIDDEN);

    update = filterUndefinedKeys({
      name, desc, artistName, artistUrl, albumId, songId, authorId: authorId ? authorId : undefined,
      sourceArtistName, sourceAlbumName, sourceSongName,
      derivedFromId, supersedeId,
    });

    if (supersedeId) {
      const supersedeDoc = await Midi.findById(supersedeId);
      if (!supersedeDoc) return error(done, 'not found');
      if (!supersedeDoc.uploaderId.equals(this.user.id) && !this.checkUserRole(ROLE_MIDI_ADMIN)) return error(done, ERROR_FORBIDDEN);
      await Midi.findByIdAndUpdate(supersedeId, {$set: {
        supersededById: midi._id, status: 'DEAD', deadDate: new Date()}});
    }

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

    const paths = await this.uploadCover(buffer, COVER_HEIGHT, COVER_WIDTH);
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
      {$sort: {withdrew: 1, performance: -1, score: -1}},
      {$group: {_id: '$userId', first: {$first: '$$ROOT'}}},
      {$replaceWith: '$first'},
      {$lookup: {from: 'users', localField: 'userId', foreignField: '_id', as: 'user'}},
      {$unwind: {path: '$user', preserveNullAndEmptyArrays: true}},
      {$addFields: {userName: '$user.name', userAvatarUrl: '$user.avatarUrl'}},
      {$project: {user: 0}},
      {$sort: {withdrew: 1, performance: -1, score: -1}}]).exec();

    return success(done, trials.map((x) => serializeTrial(x)));
  }

  async onClWebMidiGet({id}) {
    debug('  onClWebMidiGet', id);

    if (!verifyObjectId(id)) throw codeError(0, 'invalid');
    id = new ObjectId(id);
    if (await Midi.count({_id: id}) === 0) throw codeError(1, 'not found');
    return await midiController.get(id, this.user);
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
    if (status !== 'DEAD') {
      pipeline.push({$match: {$expr: {$ne: ['$status', 'DEAD']}}});
    }
    if (songId) {
      pipeline.push({$match: {songId: new ObjectId(songId)}});
    }
    if (status !== 'undefined') {
      pipeline.push({$match: {status: status}});
    }
    pipeline.push({$lookup: {from: 'songs', localField: 'songId', foreignField: '_id', as: 'song'}});
    pipeline.push({$unwind: {path: '$song', preserveNullAndEmptyArrays: true}});
    if (albumId) {
      pipeline.push({$match: {'song.albumId': new ObjectId(albumId)}});
    }
    pipeline.push({$sort: sortQueryToSpec(sort)});
    pipeline.push({$skip: page * MIDI_LIST_PAGE_LIMIT});
    pipeline.push({$limit: MIDI_LIST_PAGE_LIMIT});
    pipeline.push({$lookup: {from: 'albums', localField: 'song.albumId', foreignField: '_id', as: 'album'}});
    pipeline.push({$unwind: {path: '$album', preserveNullAndEmptyArrays: true}});
    pipeline.push({$lookup: {from: 'persons', localField: 'song.composerId', foreignField: '_id', as: 'composer'}});
    pipeline.push({$unwind: {path: '$composer', preserveNullAndEmptyArrays: true}});
    pipeline.push({$lookup: {from: 'persons', localField: 'authorId', foreignField: '_id', as: 'author'}});
    pipeline.push({$unwind: {path: '$author', preserveNullAndEmptyArrays: true}});

    const midis = await Midi.aggregate(pipeline);
    success(done, midis.map((midi) => serializeMidi(midi)));
  }

  async onClWebMidiChangeStatus({id, status}) {
    debug('  onClWebMidiChangeStatus', id, status);
    if (!this.checkUserRole(ROLE_MIDI_ADMIN)) throw codeError(0, ERROR_FORBIDDEN);

    const midi = await Midi.findById(id);
    if (!midi) throw codeError(1, 'not found');

    await Midi.findByIdAndUpdate(id, {$set: {status}}, {new: true});
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

  async onClWebTranslate({src, lang, namespace}, done) {
    if (!src) {
      return success(done);
    }
    debug('  onClWebTranslate', src, lang, namespace);

    try {
      const text = await this.server.translationService.translate(src, lang, namespace);
      return success(done, text);
    } catch (e) {
      debug(e);
      return error(done, String(e));
    }
  }

  async onClWebTranslationList({lang}, done) {
    debug('  onClWebTranslationList', lang);
    return success(done, await Translation.find({
      lang,
      active: true,
      namespace: {$in: [UI_APP, UI_WEB]},
    }).sort({namespace: 1, src: 1}).lean());
  }

  async onClWebTranslationUpdate({lang, src, text, namespace}, done) {
    debug('  onClWebTranslationUpdate', lang, src, text);
    if (!this.checkUserRole(ROLE_TRANSLATION_MOD)) return error(done, ERROR_FORBIDDEN);

    await this.server.translationService.update(this.user, src, lang, namespace, text);

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
    return checkUserRole(this.user && this.user.roles, role);
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

    const paths = await this.uploadCover(buffer, COVER_HEIGHT, COVER_WIDTH);
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
      id, name, desc, category,
      lang, nameI18n,
    } = update;

    if (!this.user) return error(done, ERROR_FORBIDDEN);
    if (!verifyObjectId(id)) return error(done, ERROR_FORBIDDEN);

    let doc = await Album.findById(id);
    if (!doc) return error(done, 'not found');

    update = deleteEmptyKeys({
      name, desc, category,
    });

    doc = await Album.findByIdAndUpdate(id, {$set: update}, {new: true});
    if (lang) {
      if (nameI18n) await this.server.translationService.update(this.user, name, lang, NAME_ARTIFACT, nameI18n);
    }
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
      lang, nameI18n,
    } = update;

    if (!this.user) return error(done, ERROR_FORBIDDEN);
    if (!verifyObjectId(id)) return error(done, ERROR_FORBIDDEN);

    let doc = await Song.findById(id);
    if (!doc) return error(done, 'not found');

    update = filterUndefinedKeys({
      albumId, composerId, name, desc, track,
    });

    doc = await Song.findByIdAndUpdate(id, {$set: update}, {new: true});
    if (lang) {
      if (nameI18n) await this.server.translationService.update(this.user, name, lang, NAME_ARTIFACT, nameI18n);
    }
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

  async onClWebAlbumList({page}, done) {
    page = parseInt(page || 0);
    debug('  onClWebAlbumList', page);

    const albums = await Song.aggregate([
      {$lookup: {from: 'persons', localField: 'composerId', foreignField: '_id', as: 'composer'}},
      {$unwind: {path: '$composer', preserveNullAndEmptyArrays: true}},
      {$group: {_id: '$albumId', songs: {$push: '$$ROOT'}}},
      {$lookup: {from: 'albums', localField: '_id', foreignField: '_id', as: 'album'}},
      {$unwind: {path: '$album', preserveNullAndEmptyArrays: true}},
      {$addFields: {'album.songs': '$songs'}},
      {$replaceRoot: {newRoot: '$album'}},
      {$sort: {date: -1}},
      {$skip: page * ALBUM_LIST_PAGE_LIMIT},
      {$limit: ALBUM_LIST_PAGE_LIMIT},
    ]);

    success(done, albums.map((x) => serializeAlbum(x)));
  }

  async onClWebAlbumInfoList(done) {
    debug('  onClWebAlbumInfoList');

    const albums = await Album.find({}).sort('-date');
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

  async onClWebDocCommentCreate({recaptcha, docId, text}) {
    recaptcha = String(recaptcha);
    docId = new ObjectId(docId);
    text = String(text);
    debug('  onClWebDocCommentCreate', docId, text);

    const res = await verifyRecaptcha(recaptcha, this.socketIp);
    if (res !== true) throw codeError(0, 'invalid recaptcha');
    if (!this.user) throw codeError(1, ERROR_FORBIDDEN);

    await commentController.create({user: this.user, docId, text});
    return await commentController.list({docId});
  }

  async onClWebDocCommentList({docId}) {
    docId = new ObjectId(docId);
    debug('  onClWebDocCommentList', docId);

    return await commentController.list({docId});
  }

  async onClVersionList({page}) {
    page = parseInt(page || 0);
    debug('  onClVersionList', page);

    const versions = await Build.find({}).sort('-build -date');
    return versions.map((x) => serializeBuild(x));
  }

  async onClErrorList({page, version}) {
    page = parseInt(page || 0);
    version = String(version || '');
    debug('  onClErrorList');

    const pipeline = [];
    if (version) {
      pipeline.push({$match: {version}});
    }

    const errors = await ErrorReport.aggregate([
      ...pipeline,
      {$sort: {date: -1}},
      {$skip: page * MIDI_LIST_PAGE_LIMIT},
      {$limit: MIDI_LIST_PAGE_LIMIT},
    ]);
    return errors.map((x) => serializeErrorReport(x, {user: this.user}));
  }

  async onClWebCardCreate() {
    if (!this.checkUserRole(ROLE_CARD_MOD)) throw codeError(0, ERROR_FORBIDDEN);

    const card = await Card.create({
      ...createDefaultCard(),
      uploaderId: this.user.id,
      date: new Date(),
    });
    return {id: card.id};
  }

  async onClWebCardGet({id}) {
    debug('  ClWebCardGet', id);

    if (!verifyObjectId(id)) throw codeError(0, 'not found');

    const card = await Card.aggregate([
      {$match: {_id: new ObjectId(id)}},
      {$lookup: {from: 'users', localField: 'uploaderId', foreignField: '_id', as: 'uploader'}}]);

    if (!card) throw codeError(0, 'not found');

    return serializeCard(card[0]);
  }

  async onClWebCardUploadCover({id, size, buffer, type}) {
    debug('  onClWebCardUploadCover', id, size, buffer.length, type);

    if (!this.checkUserRole(ROLE_CARD_MOD)) throw codeError(0, ERROR_FORBIDDEN);
    if (!verifyObjectId(id)) throw codeError(1, ERROR_FORBIDDEN);
    if (size !== buffer.length) throw codeError(2, 'tampering with api');
    if (size > 5 * MB) throw codeError(2, 'too large');

    let card = await Card.findById(id);
    if (!card) throw codeError(3, 'not found');
    if (!card.uploaderId.equals(this.user.id)) throw codeError(4, ERROR_FORBIDDEN);

    const paths = await this.uploadCover(buffer, CARD_COVER_HEIGHT, CARD_COVER_WIDTH);
    switch (type) {
      case 'portrait':
        card = await Card.findByIdAndUpdate(id, {$set: {
          portraitPath: paths.path,
        }}, {new: true});
        break;
      case 'cover':
        card = await Card.findByIdAndUpdate(id, {$set: {
          coverPath: paths.path,
        }}, {new: true});
        break;
      case 'background':
        card = await Card.findByIdAndUpdate(id, {$set: {
          backgroundPath: paths.path,
        }}, {new: true});
        break;
      case 'icon':
        card = await Card.findByIdAndUpdate(id, {$set: {
          iconPath: paths.path,
        }}, {new: true});
        break;
    }

    return serializeCard(card);
  }

  async onClWebCardUpdate(update) {
    debug('  onClWebCardUpdate', update.id);
    if (!this.checkUserRole(ROLE_CARD_MOD)) throw codeError(0, ERROR_FORBIDDEN);

    const {
      id, name, desc, rarity, attribute,
      portraitSource, portraitAuthorName, coverSource, coverAuthorName,
      backgroundSource, backgroundAuthorName, iconSource, iconAuthorName,
    } = update;

    if (!verifyObjectId(id)) throw codeError(1, ERROR_FORBIDDEN);

    let card = await Card.findById(id);
    if (!card) throw codeError(2, 'not found');
    if (!card.uploaderId.equals(this.user.id)) throw codeError(3, ERROR_FORBIDDEN);

    update = filterUndefinedKeys({
      name, desc, rarity, attribute,
      portraitSource, portraitAuthorName, coverSource, coverAuthorName,
      backgroundSource, backgroundAuthorName, iconSource, iconAuthorName,
    });

    card = await Card.findByIdAndUpdate(id, {$set: update}, {new: true});
    return serializeCard(card);
  }

  async onClWebCardList({rarity}) {
    debug('  onClWebCardList');

    const cards = await Card.aggregate([
      ...(rarity ? [{$match: {rarity}}] : []),
      {$lookup: {from: 'users', localField: 'uploaderId', foreignField: '_id', as: 'uploader'}},
      {$unwind: {path: '$uploader', preserveNullAndEmptyArrays: true}},
      {$sort: {date: -1}}]);

    return cards.map((card) => serializeCard(card));
  }

  async onClWebCardPoolCreate() {
    debug('  onClWebCardPoolCreate');
    if (!this.checkUserRole(ROLE_CARDPOOL_MOD)) throw codeError(0, ERROR_FORBIDDEN);

    const cardPool = await CardPool.create({
      ...createDefaultCardPool(),
      creatorId: this.user.id,
      date: new Date(),
    });
    return {id: cardPool.id};
  }

  async onClWebCardPoolGet({id}) {
    debug('  ClWebCardPoolGet', id);

    if (!verifyObjectId(id)) throw codeError(0, 'not found');

    const cardPool = (await CardPool.aggregate([
      {$match: {_id: new ObjectId(id)}},
      {$lookup: {from: 'users', localField: 'creatorId', foreignField: '_id', as: 'creator'}},
    ]))[0];

    if (!cardPool) throw codeError(1, 'not found');

    const cardIds = [];
    cardPool.group.forEach((x) => x.cards.forEach((y) => cardIds.push(y.cardId)));

    let cards = await Card.find({_id: {$in: cardIds}}).lean();
    cards = cards.reduce((acc, cur) => {
      acc[cur._id.toString()] = cur; return acc;
    }, {});
    cardPool.group = cardPool.group.map((x) => ({name: x.name, weight: x.weight, cards: x.cards.map((y) => ({...cards[y.cardId], weight: y.weight}))}));

    return serializeCardPool(cardPool);
  }

  async onClWebCardPoolUpdate(update) {
    debug('  onClWebCardPoolUpdate', update.id);

    let {
      id,
      name, desc, group, packs,
    } = update;

    if (!this.checkUserRole(ROLE_MIDI_ADMIN)) throw codeError(0, ERROR_FORBIDDEN);
    if (!verifyObjectId(id)) throw codeError(1, ERROR_FORBIDDEN);

    let cardPool = await CardPool.findById(id);
    if (!cardPool) throw codeError(2, 'not found');
    if (!cardPool.creatorId.equals(this.user.id)) throw codeError(3, ERROR_FORBIDDEN);

    let cardId = null;
    if (group) {
      group = group.map((x) => ({name: x.name, weight: parseFloat(x.weight), cards: x.cards}));
      for (let i = group.length - 1; i >= 0; i--) {
        if (group[i].cards.length > 0) {
          cardId = group[i].cards[0].cardId;
          break;
        }
      }
    }

    let coverPath;
    if (cardId) {
      const card = await Card.findById(cardId);
      coverPath = card.coverPath;
    }

    update = filterUndefinedKeys({
      name, desc, group, packs, coverPath,
    });

    cardPool = await CardPool.findByIdAndUpdate(id, {$set: update}, {new: true});
    return serializeCardPool(cardPool);
  }

  async onClWebCardPoolList() {
    const sort = String('-date');
    debug('  onClWebCardPoolList');

    const cardPools = await CardPool.find({})
        .sort(sort);

    return cardPools.map((cardPool) => serializeCardPool(cardPool));
  }

  async onClWebMidiCustomizedAlbumList() {
    debug('  onClWebMidiCustomizedAlbumList');

    const res = await Midi.aggregate([
      {$match: {$and: [{songId: {$eq: null}}, {$or: [{sourceAlbumName: {$ne: ''}}, {sourceSongName: {$ne: ''}}]}]}},
      {$project: {sourceAlbumName: 1, sourceSongName: 1}},
      {$group: {_id: '$sourceSongName', midiIds: {$push: '$_id'}, sourceAlbumName: {$first: '$sourceAlbumName'}}},
      {$group: {_id: '$sourceAlbumName', songs: {$push: {_id: '$_id', midiIds: '$midiIds'}}}},
    ]);
    return res;
  }

  async onClWebEventCreate() {
    debug('  onClWebEventCreate');

    if (!this.checkUserRole(ROLE_EVENT_MOD)) throw codeError(0, ERROR_FORBIDDEN);

    const event = await Event.create({
      ...createDefaultEvent(),
    });
    return {id: event.id};
  }

  async onClWebEventGet({id}) {
    debug('  onClWebEventGet', id);

    if (!verifyObjectId(id)) throw codeError(0, 'not found');

    const event = await Event.findById(id);
    if (!event) throw codeError(1, 'not found');

    return serializeEvent(event);
  }

  async onClWebEventGetMidiList({id}) {
    debug('  onClWebEventGetMidiList', id);

    if (!verifyObjectId(id)) throw codeError(0, 'not found');

    const eventMidis = await Event.aggregate([
      {$match: {_id: new ObjectId(id)}},
      {$lookup: {from: 'midis', localField: 'midiIds', foreignField: '_id', as: 'midis'}},
      {$unwind: {path: '$midis', preserveNullAndEmptyArrays: true}},
      {$lookup: {from: 'songs', localField: 'midis.songId', foreignField: '_id', as: 'midis.song'}},
      {$unwind: {path: '$midis.song', preserveNullAndEmptyArrays: true}},
      {$lookup: {from: 'albums', localField: 'midis.song.albumId', foreignField: '_id', as: 'midis.album'}},
      {$unwind: {path: '$midis.album', preserveNullAndEmptyArrays: true}},
      {$replaceRoot: {newRoot: '$midis'}},
    ]);

    return eventMidis.map((x) => serializeMidi(x));
  }

  async onClWebEventUploadCover({id, size, buffer}) {
    debug('  onClWebEventUploadCover', id, size, buffer.length);

    if (!this.checkUserRole(ROLE_EVENT_MOD)) throw codeError(0, ERROR_FORBIDDEN);
    if (!verifyObjectId(id)) throw codeError(1, ERROR_FORBIDDEN);
    if (size !== buffer.length) throw codeError(2, 'tampering with api');
    if (size > 5 * MB) throw codeError(3, 'too large');

    let event = await Event.findById(id);
    if (!event) throw codeError(4, 'not found');

    const paths = await this.uploadCover(buffer, EVENT_COVER_HEIGHT, EVENT_COVER_WIDTH);

    event = await Event.findByIdAndUpdate(id, {$set: {
      coverPath: paths.coverPath,
    }}, {new: true});

    return serializeEvent(event);
  }

  async onClWebEventUpdate(update) {
    debug('  onClWebEventUpdate');
    if (!this.checkUserRole(ROLE_EVENT_MOD)) throw codeError(0, ERROR_FORBIDDEN);

    const {
      id, startDate, endDate, name, desc, midiIds,
    } = update;

    if (!verifyObjectId(id)) throw codeError(1, ERROR_FORBIDDEN);

    let event = await Event.findById(id);
    if (!event) throw codeError(2, 'not found');

    update = filterUndefinedKeys({
      startDate, endDate, name, desc, midiIds,
    });

    event = await Event.findByIdAndUpdate(id, {$set: update}, {new: true});
    return serializeEvent(event);
  }

  async onClWebEventRanking({id}) {
    debug('  onClWebEventRanking', id);

    const event = await Event.findById(id);
    if (!event) throw codeError(0, 'not found');

    const pipeline = [
      {$match: {withdrew: false, eventId: new ObjectId(id), date: {$gte: event.startDate, $lte: event.endDate}}},
      {$group: {
        _id: '$userId',
        playTime: {$sum: '$duration'},
        trialCount: {$sum: 1},
        score: {$sum: '$score'},
        avgCombo: {$avg: '$combo'},
        avgAccuracy: {$avg: '$accuracy'},
        performance: {$sum: '$performance'},
      }},
      {$lookup: {from: 'users', localField: '_id', foreignField: '_id', as: 'user'}},
      {$unwind: {path: '$user', preserveNullAndEmptyArrays: true}},
      {$addFields: {
        'user.playTime': '$playTime',
        'user.trialCount': '$trialCount',
        'user.score': '$score',
        'user.avgCombo': '$avgCombo',
        'user.avgAccuracy': '$avgAccuracy',
        'user.performance': '$performance',
      }},
      {$replaceRoot: {newRoot: '$user'}},
      {$sort: {performance: -1}},
    ];

    const rankings = await Trial.aggregate(pipeline);

    if (!this.user) return {rankings: rankings.map((x) => serializeRanking(x))};

    pipeline[0] = {$match: {withdrew: false, userId: new ObjectId(this.user.id), eventId: new ObjectId(id)}};
    let user = await Trial.aggregate(pipeline);
    user = user[0];

    if (!user) return {rankings: rankings.map((x) => serializeRanking(x)), userRanking: -1};

    const userRanking = rankings.findIndex((x) => x._id.equals(user._id));
    return {rankings: rankings.map((x) => serializeRanking(x)), userRanking, userRankingDetail: serializeRanking(user)};
  }
};
