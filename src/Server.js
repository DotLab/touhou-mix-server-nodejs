const debug = require('debug')('thmix:Server');

const Session = require('./Session');

const VERSION = 0;

module.exports = class Server {
  constructor(io) {
    /** @type {Object.<string, Session>} */
    this.sessions = {};
    this.version = VERSION;

    io.on('connection', (socket) => {
      debug('connection', socket.id);
      this.sessions[socket.id] = new Session(this, socket);
    });
  }

  /**
   * @param {string} socketId
   */
  endSession(socketId) {
    if (typeof this.sessions[socketId] === 'object') {
      this.sessions[socketId].socket.disconnect();
    } else debug('ending mal-formed session', socketId);
    delete this.sessions[socketId];
  }
};
