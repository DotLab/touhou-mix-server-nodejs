const debug = require('debug')('thmix:WebsocketSession');
const {
  User, serializeUser,
  Midi, serializeMidi,
  Trial,
  Build, serializeBuild,
  Soundfont,
  UserDocAction,
} = require('./models');
const crypto = require('crypto');

const PASSWORD_HASHER = 'sha512';
const MIDI_LIST_PAGE_LIMIT = 18;
const TRIAL_SCORING_VERSION = 3;

const LOVE = 'love';
const VOTE = 'vote';
const UP = 'up';
const DOWN = 'down';
const MIDI = 'midi';
const SOUNDFONT = 'soundfont';

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
      debug(' handleRpc', command, args, id);

      switch (command) {
        case 'ClAppHandleRpcResponse': this.handleRpcResponse(id, args); break;
        case 'ClAppUserLogin': this.clAppUserLogin(id, args); break;
        case 'ClAppMidiListQuery': this.clAppMidiListQuery(id, args); break;
        case 'ClAppMidiDownload': this.clAppMidiDownload(id, args); break;
        case 'ClAppPing': this.clAppPing(id, args); break;
        case 'clAppUserDocAction': this.clAppUserDocAction(id, args); break;
        case 'ClAppTrialUpload': this.clAppTrialUpload(id, args); break;
        case 'ClAppCheckVersion': this.clAppCheckVersion(id, args); break;
        case 'ClAppMidiRecordList': this.clAppMidiRecordList(id, args); break;
        case 'ClAppTranslate': this.clAppTranslate(id, args); break;
        case 'ClAppMidiBundleBuild': this.clAppMidiBundleBuild(id, args); break;
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

  async clAppMidiListQuery(id, {status, query, sort, page}) {
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
    ]);

    this.returnSuccess(id, midis.map((midi) => serializeMidi(midi)));
  }

  async clAppMidiDownload(id, {hash}) {
    hash = String(hash);
    debug('  clAppMidiDownload', hash);

    const midi = await Midi.findOne({hash});
    if (!midi) return this.returnError(id, 'not found');

    const url = 'https://storage.thmix.org' + midi.path;
    this.returnSuccess(id, url);
  }

  async clAppPing(id, {time}) {
    time = parseInt(time);
    debug('  clAppPing', time);
    this.returnSuccess(id, time);
  }

  async clAppUserDocAction(id, {docId, connection, action, data}) {
    debug(' clAppUserDocAction', docId, connection, action, data);

    if (!this.user) this.returnError(id, 'forbidden');

    let doc;
    if (connection === MIDI) {
      doc = await Midi.findOne({id: docId});
      if (!doc) this.returnError(id, 'not found');
      if (action === VOTE && data === UP) {
        const upvoted = UserDocAction.findOne({docId, connection, action, data, userId: this.user.id});
        if (upvoted) this.returnSuccess(id);

        const downvoted = UserDocAction.findOne({docId, connection, action, data: DOWN, userId: this.user.id});
        if (downvoted) {
          await UserDocAction.findByIdAndUpdate(downvoted.id, {
            data: UP,
            date: new Date(),
          });
          await Midi.findByIdAndUpdate(docId, {
            $inc: {downCount: -1},
          });
        }

        await Midi.findByIdAndUpdate(docId, {
          $inc: {upCount: 1},
        });
      } else if (action === VOTE && data === DOWN) {
        const downvoted = UserDocAction.findOne({docId, connection, action, data, userId: this.user.id});
        if (downvoted) this.returnSuccess(id);

        const upvoted = UserDocAction.findOne({docId, connection, action, data: UP, userId: this.user.id});
        if (upvoted) {
          await UserDocAction.findByIdAndUpdate(upvoted.id, {
            data: DOWN,
            date: new Date(),
          });
          await Midi.findByIdAndUpdate(docId, {
            $inc: {upCount: -1},
          });
        }

        await Midi.findByIdAndUpdate(docId, {
          $inc: {downCount: 1},
        });
      } else if (action === LOVE && data === UP) {
        const userDocAction = UserDocAction.findOne({docId, connection, action, data, userId: this.user.id});
        // if liked
        if (userDocAction) this.returnSuccess(id);

        await Midi.findByIdAndUpdate(docId, {
          $inc: {loveCount: 1},
        });
        UserDocAction.create({
          userId: this.user.id,
          docId: docId,
          connection: connection,
          action: action,
          data: data,
          date: new Date(),
        });
      } else if (action === LOVE && data === DOWN) {
        const userDocAction = UserDocAction.findOne({docId, connection, action, UP, userId: this.user.id});
        // if not liked
        if (!userDocAction) this.returnSuccess(id);

        await Midi.findByIdAndUpdate(docId, {
          $inc: {loveCount: -1},
        });
        await UserDocAction.findByIdAndRemove(userDocAction.id);
      }
    } else if (connection === SOUNDFONT) {
      doc = await Soundfont.findOne({id: docId});
      if (!doc) this.returnError(id, 'not found');
      if (action === VOTE && data === UP) {
        const upvoted = UserDocAction.findOne({docId, connection, action, data, userId: this.user.id});
        if (upvoted) this.returnSuccess(id);

        const downvoted = UserDocAction.findOne({docId, connection, action, data: DOWN, userId: this.user.id});
        if (downvoted) {
          await UserDocAction.findByIdAndUpdate(downvoted.id, {
            data: UP,
            date: new Date(),
          });
          await Soundfont.findByIdAndUpdate(docId, {
            $inc: {downCount: -1},
          });
        }

        await Soundfont.findByIdAndUpdate(docId, {
          $inc: {upCount: 1},
        });
      } else if (action === VOTE && data === DOWN) {
        const downvoted = UserDocAction.findOne({docId, connection, action, data, userId: this.user.id});
        if (downvoted) this.returnSuccess(id);

        const upvoted = UserDocAction.findOne({docId, connection, action, data: UP, userId: this.user.id});
        if (upvoted) {
          await UserDocAction.findByIdAndUpdate(upvoted.id, {
            data: DOWN,
            date: new Date(),
          });
          await Soundfont.findByIdAndUpdate(docId, {
            $inc: {upCount: -1},
          });
        }

        await Soundfont.findByIdAndUpdate(docId, {
          $inc: {downCount: 1},
        });
      } else if (action === LOVE && data === UP) {
        const userDocAction = UserDocAction.findOne({docId, connection, action, data, userId: this.user.id});
        // if liked
        if (userDocAction) this.returnSuccess(id);

        await Soundfont.findByIdAndUpdate(docId, {
          $inc: {loveCount: 1},
        });
        UserDocAction.create({
          userId: this.user.id,
          docId: docId,
          connection: connection,
          action: action,
          data: data,
          date: new Date(),
        });
      } else if (action === LOVE && data === DOWN) {
        const userDocAction = UserDocAction.findOne({docId, connection, action, UP, userId: this.user.id});
        // if not liked
        if (!userDocAction) this.returnSuccess(id);

        await Soundfont.findByIdAndUpdate(docId, {
          $inc: {loveCount: -1},
        });
        await UserDocAction.findByIdAndRemove(userDocAction.id);
      }
    } else {
      this.returnError(id, 'bad request');
    }

    this.returnSuccess(id);
  }

  async clAppTrialUpload(id, trial) {
    const {
      hash,
      score, combo, accuracy,
      perfectCount, greatCount, goodCount, badCount, missCount,
      version,
    } = trial;
    const performance = Math.floor(Math.log(score));
    debug('  clAppTrialUpload', version, hash);

    if (version !== TRIAL_SCORING_VERSION) return this.returnError(id, 'forbidden');
    if (!this.user) return this.returnError(id, 'forbidden');
    this.user = await this.updateUser({
      $inc: {
        trialCount: 1,
        passCount: 1,
        score,
        combo,
        performance,
        accuracy,
      },
    });
    const midi = await Midi.findOneAndUpdate({hash}, {
      $inc: {
        trialCount: 1,
        passCount: 1,
        score,
        combo,
        performance,
        accuracy,
      },
    });
    if (!midi) return this.returnError(id, 'not found');

    await Trial.create({
      userId: this.user._id,
      midiId: midi._id,
      date: new Date(),

      score, combo, accuracy, performance,
      perfectCount, greatCount, goodCount, badCount, missCount,

      version,
    });

    this.returnSuccess(id);
  }

  async clAppCheckVersion(id, {version}) {
    debug('  clAppCheckVersion', version);

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

  async clAppMidiRecordList(id, {hash}) {
    debug('  clAppMidiRecordList', hash);

    const midi = await Midi.findOne({hash});
    if (!midi) return this.returnError(id, 'not found');

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

    this.returnSuccess(id, trials);
  }

  async clAppTranslate(id, {src, lang}) {
    debug('  clAppTranslate', src, lang);

    try {
      const text = await this.server.translationService.translate(src, lang);
      return this.returnSuccess(id, text);
    } catch (e) {
      debug(e);
      return this.returnError(id, String(e));
    }
  }

  async clAppMidiBundleBuild(id) {
    debug('  clAppMidiBundleBuild');

    const midis = await Midi.aggregate([
      {$match: {status: 'INCLUDED'}},
    ]);
    const songs = await Midi.aggregate([
      {$match: {status: 'INCLUDED'}},
      {$group: {_id: '$songId'}},
      {$lookup: {from: 'songs', localField: '_id', foreignField: '_id', as: 'song'}},
      {$unwind: {path: '$song', preserveNullAndEmptyArrays: true}},
      {$replaceRoot: {newRoot: '$song'}},
    ]);
    const albums = await Midi.aggregate([
      {$match: {status: 'INCLUDED'}},
      {$group: {_id: '$songId'}},
      {$lookup: {from: 'songs', localField: '_id', foreignField: '_id', as: 'song'}},
      {$unwind: {path: '$song', preserveNullAndEmptyArrays: true}},
      {$lookup: {from: 'albums', localField: 'song.albumId', foreignField: '_id', as: 'album'}},
      {$unwind: {path: '$album', preserveNullAndEmptyArrays: true}},
      {$replaceRoot: {newRoot: '$album'}},
    ]);
    const persons = [
      ...(await Midi.aggregate([
        {$match: {status: 'INCLUDED'}},
        {$group: {_id: '$authorId'}},
        {$lookup: {from: 'persons', localField: '_id', foreignField: '_id', as: 'composer'}},
        {$unwind: {path: '$composer', preserveNullAndEmptyArrays: true}},
        {$replaceRoot: {newRoot: '$composer'}},
      ])),
      ...(await Midi.aggregate([
        {$match: {status: 'INCLUDED'}},
        {$group: {_id: '$songId'}},
        {$lookup: {from: 'songs', localField: '_id', foreignField: '_id', as: 'song'}},
        {$unwind: {path: '$song', preserveNullAndEmptyArrays: true}},
        {$group: {_id: '$song.composerId'}},
        {$lookup: {from: 'persons', localField: '_id', foreignField: '_id', as: 'composer'}},
        {$unwind: {path: '$composer', preserveNullAndEmptyArrays: true}},
        {$replaceRoot: {newRoot: '$composer'}},
      ])),
    ];

    return this.returnSuccess(id, {
      midis, songs, albums, persons,
    });
  }
};
