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

function success(done, data) {
  if (typeof done === 'function') done({success: true, data});
  else debug('  done is not a function');
}

// function error(data) {
//   return {error: true, data};
// }

const axios = require('axios');
const {RECAPTCHA_SECRET} = require('./secrets');

io.on('connection', function(socket) {
  debug('connection', socket.id);

  socket.on('cl_handshake', ({version, intent}, done) => {
    debug('  cl_handshake', version, intent);

    if (version !== VERSION) {
      socket.disconnect();
      return;
    }

    if (intent === INTENT_WEB) {
      socket.on('cl_web_register', ({recaptcha, username, email, password}, done) => {
        debug('  cl_web_register', recaptcha, username, email, password);
        axios.post('https://www.google.com/recaptcha/api/siteverify', null, {
          params: {
            secret: RECAPTCHA_SECRET,
            response: recaptcha,
            remoteip: socket.handshake.headers['x-forwarded-for'],
          },
        }).then((res) => {
          debug(res.data);
          success(done);
        });
      });
    }

    success(done, {version: VERSION, intent: INTENT_WEB});
  });
});
