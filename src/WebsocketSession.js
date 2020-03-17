const debug = require('debug')('thmix:WebsocketSession');
const {User, Midi, serializeUser, serializeMidi,
  Soundfont, UserDocAction} = require('./models');
const crypto = require('crypto');

const PASSWORD_HASHER = 'sha512';
const MIDI_LIST_PAGE_LIMIT = 18;

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
        case 'ClAppUserVoteMidi': this.clAppUserVoteMidi(id, args); break;
        case 'ClAppUserLoveMidi': this.clAppUserLoveMidi(id, args); break;
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
};
