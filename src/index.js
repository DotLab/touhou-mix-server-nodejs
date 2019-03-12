const debug = require('debug')('thmix');

const env = process.env.NODE_ENV;
let port = '6003';
let database = 'thmix';
if (env === 'staging') {
  port = '6004';
  database = 'thmix-staging';
}
debug('running as', env, 'on port', port, 'using database', database);

const mongoose = require('mongoose');
mongoose.connect(`mongodb://localhost:27017/${database}`, {useNewUrlParser: true});
mongoose.set('useFindAndModify', false);

// const ObjectId = mongoose.Schema.Types.ObjectId;
// const User = mongoose.model('User', {
//   name: String,
//   salt: String,
//   hash: String,
// });

const io = require('socket.io')(port);

const VERSION = 0;
const INTENT_WEB = 'web';

function success(data) {
  return {success: true, data};
}

// function error(data) {
//   return {error: true, data};
// }

io.on('connection', function(socket) {
  debug('connection', socket.id);

  socket.on('cl_handshake', (info, done) => {
    debug('cl_handshake', socket.id, info);

    if (info.version !== VERSION) {
      socket.disconnect();
      return;
    }

    // if (info.intent === INTENT_WEB) {
    // }

    done(success({version: VERSION, intent: INTENT_WEB}));
  });
});
