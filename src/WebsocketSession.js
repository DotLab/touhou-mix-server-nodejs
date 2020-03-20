const debug = require('debug')('thmix:WebsocketSession');
const {User, Midi, Message, createDefaultUser, createDefaultMidi, Trial, serializeUser, serializeMidi} = require('./models');
const crypto = require('crypto');

const PASSWORD_HASHER = 'sha512';
const MIDI_LIST_PAGE_LIMIT = 18;

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
        case 'ClAppTrialUpload': this.clAppTrialUpload(id, args); break;
        case 'ClAppCheckUpdate': this.clAppCheckUpdate(id, args); break;
        case 'ClAppMidiRecordList': this.clAppMidiRecordList(id, args); break;
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

    const midis = await Midi.find(conditions)
        .sort(sort)
        .skip(MIDI_LIST_PAGE_LIMIT * page)
        .limit(MIDI_LIST_PAGE_LIMIT);
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

  async clAppTrialUpload(id, trial) {
    const {
      hash,
      score, combo, accuracy,
      perfectCount, greatCount, goodCount, badCount, missCount,
    } = trial;
    const performance = Math.floor(Math.log(score));
    debug('  clAppTrialUpload', hash);

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
    });

    this.returnSuccess(id);
  }

  async clAppCheckUpdate(id, {build}) {
    debug('  clAppCheckUpdate', build);
    this.returnSuccess(id, {
      android: {build: 84, url: ''},
      androidBeta: {build: 175, url: ''},
      androidAlpha: {build: 204, url: ''},
      ios: {build: 86, url: 'https://apps.apple.com/us/app/touhou-mix-a-touhou-game/id1454875483'},
      iosBeta: {build: 176, url: ''},
    });
  }

  async clAppMidiRecordList(id, {hash}) {
    debug('  clAppMidiRecordList', hash);

    const midi = await Midi.findOne({hash});
    if (!midi) return this.returnError(id, 'not found');

    const trials = await Trial.aggregate([
      {$match: {midiId: midi._id}},
      {$sort: {score: -1}},
      {$group: {_id: '$userId', first: {$first: '$$ROOT'}}},
      {$replaceWith: '$first'},
      {$lookup: {from: 'users', localField: 'userId', foreignField: '_id', as: 'user'}},
      {$unwind: '$user'},
      {$addFields: {userName: '$user.name', userAvatarUrl: '$user.avatarUrl'}},
      {$project: {user: 0}},
      {$sort: {score: -1}}]).exec();

    this.returnSuccess(id, trials);
  }
};
