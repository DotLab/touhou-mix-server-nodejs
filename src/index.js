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

// const {User} = require('./models');
// User.deleteMany({}).exec();

const io = require('socket.io')(port);
const Server = require('./Server');
new Server(io);
