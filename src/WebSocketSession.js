const crypto = require('crypto');
const debug = require('debug')('thmix:WebSocketSession');
const {
  UI_APP,
} = require('./TranslationService');
const {
  User, serializeUser,
  Midi, serializeMidi,
  Trial, getGradeFromAccuracy, getGradeLevelFromAccuracy,
  Build, serializeBuild,
  serializeSong,
  serializeAlbum,
  serializePerson,
  DocAction,
  Translation, serializeTranslation,
  SessionRecord,
  SessionToken, genSessionTokenHash,
  ErrorReport,
} = require('./models');
const {getTimeBetween} = require('./utils');
const {midiController} = require('./controllers');

function codeError(code, error) {
  return `${error} (${code})`;
}

const PASSWORD_HASHER = 'sha512';
const MIDI_LIST_PAGE_LIMIT = 3 * 10;
const TRIAL_SCORING_VERSION = 3;

const LOVE = 'love'; // 1 to set; 0 to cancel
const VOTE = 'vote'; // 1 to up; -1 to down;

const MIDIS = 'midis';

function calcPasswordHash(password, salt) {
  const hasher = crypto.createHash(PASSWORD_HASHER);
  hasher.update(password);
  hasher.update(salt);
  return hasher.digest('base64');
}

async function processDocAction(model, col, userId, docId, action, value) {
  const oldAction = await DocAction.findOne({col, userId, docId, action});
  const newAction = {col, userId, docId, action, date: new Date(), value};

  switch (action) {
    case LOVE: {
      switch (value) {
        case 1: {
          if (!oldAction) {
            // set love if not yet
            debug('    love');
            await DocAction.create(newAction);
            await model.updateOne({_id: docId}, {$inc: {loveCount: 1}});
          }
          return;
        }
        case 0: {
          if (oldAction) {
            // delete love if set
            debug('    unlove');
            await DocAction.deleteOne({_id: oldAction._id});
            await model.updateOne({_id: docId}, {$inc: {loveCount: -1}});
          }
          return;
        }
      }
      return;
    }
    case VOTE: {
      debug('    vote', value);
      if (!oldAction) {
        // new vote
        await DocAction.create(newAction);
        await model.updateOne({_id: docId}, {$inc: {voteCount: 1, voteSum: value}});
        return;
      }
      // update vote
      const diff = value - oldAction.value;
      await DocAction.updateOne({_id: oldAction._id}, {$set: {value, date: new Date()}});
      await model.updateOne({_id: docId}, {$inc: {voteSum: diff}});
      return;
    }
  }
}

module.exports = class WebSocketSession {
  constructor(server, sessionId, websocket) {
    /** @type {import('./WebSocketServer')} */
    this.server = server;
    this.sessionId = sessionId;
    this.websocket = websocket;

    this.callbackDict = {};

    this.user = null;

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

      switch (command) {
        case 'ClAppHandleRpcResponse': this.handleRpcResponse(id, args); break;
        case 'ClAppUserLogin': this.onClAppUserLogin(id, args); break;
        case 'ClAppMidiGet': this.wrapRpcHandler(id, args, this.onClAppMidiGet.bind(this)); break;
        case 'ClAppMidiListQuery': this.onClAppMidiListQuery(id, args); break;
        case 'ClAppMidiDownload': this.onClAppMidiDownload(id, args); break;
        case 'ClAppPing': this.onClAppPing(id, args); break;
        case 'ClAppMidiAction': this.onClAppMidiAction(id, args); break;
        case 'ClAppTrialUpload': this.onClAppTrialUpload(id, args); break;
        case 'ClAppCheckVersion': this.onClAppCheckVersion(id, args); break;
        case 'ClAppMidiRecordList': this.onClAppMidiRecordList(id, args); break;
        case 'ClAppTranslate': this.onClAppTranslate(id, args); break;
        case 'ClAppErrorReport': this.wrapRpcHandler(id, args, this.onClAppErrorReport.bind(this)); break;
        case 'ClAppMidiBundleBuild': this.onClAppMidiBundleBuild(id); break;
        default: debug('unknown rpc', command, args, id); this.returnError(id, 'unknown rpc'); break;
      }
    } catch (e) {
      this.handleError(e);
    }
  }

  async wrapRpcHandler(id, args, resolver) {
    try {
      const res = await resolver(args);
      return this.returnSuccess(id, res);
    } catch (e) {
      return this.returnError(id, e);
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

  async closeSession(code, reason) {
    debug('  closeSession', code, reason);

    if (this.sessionRecord) {
      this.sessionRecord = await SessionRecord.findByIdAndUpdate(this.sessionRecord._id, {$set: {endDate: new Date()}}, {new: true});
      await User.updateOne({_id: this.user._id}, {$inc: {onlineTime: getTimeBetween(this.sessionRecord.endDate, this.sessionRecord.startDate)}});
      debug('    user', this.user.name, getTimeBetween(this.sessionRecord.endDate, this.sessionRecord.startDate) / 1000);
    }

    this.server.closeSession(this);
  }

  handleError(error) {
    debug('  handleError', error);
    this.closeSession(0, error);
    this.server.closeSession(this);
  }

  rpc(command, args, callback) {
    debug('    rpc', command);
    const id = crypto.randomBytes(16).toString('base64');
    if (typeof callback === 'function') {
      this.callbackDict[id] = callback;
    }
    this.websocket.send(JSON.stringify({id, command, args}));
  }

  returnSuccess(id, data) {
    debug('    success', id);
    this.rpc('SvAppHandleRpcResponse', {id, data});
  }

  returnError(id, message) {
    debug('    error', id, message);
    this.rpc('SvAppHandleRpcResponse', {id, error: message});
  }

  async onClAppUserLogin(id, {name, password}) {
    debug('  onClAppUserLogin', name, password);

    const user = await User.findOne({name});
    if (!user) return this.returnError(id, 'wrong combination');

    const hash = calcPasswordHash(password, user.salt);
    if (hash !== user.hash) return this.returnError(id, 'wrong combination');

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
    return this.returnSuccess(id, serializeUser(this.user));
  }

  async onClAppMidiGet({hash}) {
    debug('  onClAppMidiGet', hash);

    const midi = await Midi.findOne({hash});
    if (!midi) throw codeError(0, 'not found');
    return await midiController.get(midi._id);
  }

  async onClAppMidiListQuery(id, {status, query, sort, page}) {
    status = String(status);
    query = String(query || '');
    sort = String(sort || '-uploadedDate');
    page = parseInt(page || 0);
    if (page < 0) {
      page = 0;
    }
    debug('  onClWebMidiList', status, sort, page);

    const conditions = {};
    if (query) {
      conditions.$text = {$search: query};
    }
    if (status !== 'undefined') {
      conditions.status = status;
    }

    const midis = await Midi.aggregate([
      {$match: conditions},
      {$sort: {uploadedDate: -1}},
      {$skip: MIDI_LIST_PAGE_LIMIT * page},
      {$limit: MIDI_LIST_PAGE_LIMIT},
      {$lookup: {from: 'songs', localField: 'songId', foreignField: '_id', as: 'song'}},
      {$unwind: {path: '$song', preserveNullAndEmptyArrays: true}},
      {$lookup: {from: 'albums', localField: 'song.albumId', foreignField: '_id', as: 'album'}},
      {$unwind: {path: '$album', preserveNullAndEmptyArrays: true}},
      {$lookup: {from: 'persons', localField: 'song.composerId', foreignField: '_id', as: 'composer'}},
      {$unwind: {path: '$composer', preserveNullAndEmptyArrays: true}},
      {$lookup: {from: 'persons', localField: 'authorId', foreignField: '_id', as: 'author'}},
      {$unwind: {path: '$author', preserveNullAndEmptyArrays: true}},
    ]);

    this.returnSuccess(id, midis.map((midi) => serializeMidi(midi)));
  }

  async onClAppMidiDownload(id, {hash}) {
    hash = String(hash);
    debug('  onClAppMidiDownload', hash);

    const midi = await Midi.findOne({hash});
    if (!midi) return this.returnError(id, 'not found');
    await Midi.updateOne({_id: midi._id}, {$inc: {downloadCount: 1}});

    const url = 'https://storage.thmix.org' + midi.path;
    this.returnSuccess(id, url);
  }

  async onClAppPing(id, {time}) {
    time = parseInt(time);
    debug('  onClAppPing', time);
    this.returnSuccess(id, time);
  }

  async onClAppMidiAction(id, {hash, action, value}) {
    debug('  onClAppMidiAction', hash, action, value);

    if (!this.user) return this.returnError(id, 'forbidden');
    const midi = await Midi.findOne({hash});
    if (!midi) return this.returnError(id, 'not found');

    await processDocAction(Midi, MIDIS, this.user.id, midi._id, action, value);

    this.returnSuccess(id);
  }

  async onClAppTrialUpload(id, trial) {
    let {
      hash, withdrew,
      score, combo, accuracy,
      perfectCount, greatCount, goodCount, badCount, missCount,
      version, duration,
    } = trial;
    const performance = Math.log(1 + score) * Math.pow(accuracy, 2);
    const grade = withdrew ? 'W' : getGradeFromAccuracy(accuracy);
    const gradeLevel = withdrew ? 'F' : getGradeLevelFromAccuracy(accuracy);
    duration = parseInt(duration || 0);
    debug('  onClAppTrialUpload', version, hash, grade, gradeLevel, performance, score, duration);

    if (version !== TRIAL_SCORING_VERSION) return this.returnError(id, 'forbidden');
    if (!this.user) return this.returnError(id, 'forbidden');
    let midi = await Midi.findOne({hash});
    if (!midi) return this.returnError(id, 'not found');

    const countFieldName = gradeLevel.toLowerCase() + 'Count';
    const $inc = {
      trialCount: 1,
      [countFieldName]: 1,
      score,
      combo,
      performance,
      accuracy,
    };

    if (!withdrew) {
      this.user = await this.updateUser({$inc});
      midi = await Midi.findOneAndUpdate({hash}, {$inc});
    }
    this.user = await this.updateUser({$inc: {
      playTime: duration,
    }});

    await Trial.create({
      userId: this.user._id,
      midiId: midi._id,
      date: new Date(),

      withdrew,
      score, combo, accuracy, performance, grade,
      perfectCount, greatCount, goodCount, badCount, missCount,
      duration,

      version,
    });

    this.returnSuccess(id);
  }

  async onClAppCheckVersion(id, {version}) {
    debug('  onClAppCheckVersion', version);

    let [build] = await Build.find({}).sort('-date').limit(1).lean().exec();
    build = serializeBuild(build);

    this.returnSuccess(id, {
      androidVersion: '2.2.84',
      androidUrl: 'https://play.google.com/store/apps/details?id=kailang.touhoumix',

      androidBetaVersion: '3.0.0.259',
      androidBetaUrl: 'https://play.google.com/apps/testing/kailang.touhoumix',

      androidAlphaVersion: build.version,
      androidAlphaUrl: build.url,

      iosVersion: '2.2.86',
      iosUrl: 'https://apps.apple.com/us/app/touhou-mix-a-touhou-game/id1454875483',

      iosBetaVersion: '3.0.258',
      iosBetaUrl: 'https://testflight.apple.com/join/fM6ung3w',
    });
  }

  async onClAppMidiRecordList(id, {hash}) {
    debug('  onClAppMidiRecordList', hash);

    const midi = await Midi.findOne({hash});
    if (!midi) return this.returnError(id, 'not found');

    const trials = await Trial.aggregate([
      {$match: {midiId: midi._id, version: TRIAL_SCORING_VERSION}},
      {$sort: {performance: -1, score: -1}},
      {$group: {_id: '$userId', first: {$first: '$$ROOT'}}},
      {$replaceWith: '$first'},
      {$lookup: {from: 'users', localField: 'userId', foreignField: '_id', as: 'user'}},
      {$unwind: {path: '$user', preserveNullAndEmptyArrays: true}},
      {$addFields: {userName: '$user.name', userAvatarUrl: '$user.avatarUrl'}},
      {$project: {user: 0}},
      {$sort: {performance: -1, score: -1}}]).exec();

    this.returnSuccess(id, trials);
  }

  async onClAppTranslate(id, {src, lang, namespace}) {
    debug('  onClAppTranslate', src, lang, namespace);
    if (!namespace) {
      namespace = UI_APP;
    }

    try {
      const text = await this.server.translationService.translate(src, lang, namespace);
      return this.returnSuccess(id, text);
    } catch (e) {
      debug(e);
      return this.returnError(id, String(e));
    }
  }

  async onClAppErrorReport(args) {
    const {
      version,
      message, stack, source, exception,
      platform, runtime,
      sampleRate, bufferSize,
      model, name, os, cpu, gpu,
    } = args;
    debug('  onClAppErrorReport', version, message, exception);

    await ErrorReport.create({
      sessionId: this.sessionRecord && this.sessionRecord._id, userId: this.user && this.user._id, date: new Date(),
      version,
      message, stack, source, exception,
      platform, runtime,
      sampleRate, bufferSize,
      model, name, os, cpu, gpu,
    });
    return null;
  }

  async onClAppMidiBundleBuild(id) {
    debug('  onClAppMidiBundleBuild');

    const midis = await Midi.aggregate([
      {$match: {status: 'INCLUDED'}},
      {$lookup: {from: 'songs', localField: 'songId', foreignField: '_id', as: 'song'}},
      {$unwind: {path: '$song', preserveNullAndEmptyArrays: true}},
      {$lookup: {from: 'albums', localField: 'song.albumId', foreignField: '_id', as: 'album'}},
      {$unwind: {path: '$album', preserveNullAndEmptyArrays: true}},
      {$lookup: {from: 'persons', localField: 'song.composerId', foreignField: '_id', as: 'composer'}},
      {$unwind: {path: '$composer', preserveNullAndEmptyArrays: true}},
      {$lookup: {from: 'persons', localField: 'authorId', foreignField: '_id', as: 'author'}},
      {$unwind: {path: '$author', preserveNullAndEmptyArrays: true}},
    ]);
    const songs = await Midi.aggregate([
      {$match: {status: 'INCLUDED'}},
      {$group: {_id: '$songId'}},
      {$lookup: {from: 'songs', localField: '_id', foreignField: '_id', as: 'song'}},
      {$unwind: {path: '$song'}},
      {$replaceRoot: {newRoot: '$song'}},
    ]);
    const albums = await Midi.aggregate([
      {$match: {status: 'INCLUDED'}},
      {$group: {_id: '$songId'}},
      {$lookup: {from: 'songs', localField: '_id', foreignField: '_id', as: 'song'}},
      {$unwind: {path: '$song'}},
      {$lookup: {from: 'albums', localField: 'song.albumId', foreignField: '_id', as: 'album'}},
      {$unwind: {path: '$album'}},
      {$replaceRoot: {newRoot: '$album'}},
    ]);
    const persons = [
      ...(await Midi.aggregate([
        {$match: {status: 'INCLUDED'}},
        {$group: {_id: '$authorId'}},
        {$lookup: {from: 'persons', localField: '_id', foreignField: '_id', as: 'composer'}},
        {$unwind: {path: '$composer'}},
        {$replaceRoot: {newRoot: '$composer'}},
      ])),
      ...(await Midi.aggregate([
        {$match: {status: 'INCLUDED'}},
        {$group: {_id: '$songId'}},
        {$lookup: {from: 'songs', localField: '_id', foreignField: '_id', as: 'song'}},
        {$unwind: {path: '$song'}},
        {$group: {_id: '$song.composerId'}},
        {$lookup: {from: 'persons', localField: '_id', foreignField: '_id', as: 'composer'}},
        {$unwind: {path: '$composer'}},
        {$replaceRoot: {newRoot: '$composer'}},
      ])),
    ];
    const translations = await Translation.aggregate([
      {$match: {active: true, lang: 'en', namespace: 'name.artifact'}},
    ]);

    return this.returnSuccess(id, {
      midis: midis.map(serializeMidi),
      songs: songs.map(serializeSong),
      albums: albums.map(serializeAlbum),
      persons: persons.map(serializePerson),
      translations: translations.map(serializeTranslation),
    });
  }
};
