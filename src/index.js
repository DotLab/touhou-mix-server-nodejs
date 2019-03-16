const debug = require('debug')('thmix');

const env = process.env.NODE_ENV;

let port;
let database;
if (env !== 'staging') {
  port = '6003';
  database = 'thmix';
} else {
  port = '6004';
  database = 'thmix-staging';
}
debug('running as', env, 'on port', port, 'using database', database);

const mongoose = require('mongoose');
mongoose.connect(`mongodb://localhost:27017/${database}`, {useNewUrlParser: true});
mongoose.set('useFindAndModify', false);

const {Storage} = require('@google-cloud/storage');
const storage = new Storage();

const tempPath = './temp';
const fs = require('fs');
const path = require('path');
if (fs.existsSync(tempPath)) {
  const files = fs.readdirSync(tempPath);
  for (const file of files) {
    fs.unlinkSync(path.join(tempPath, file));
  }
} else {
  fs.mkdirSync(tempPath);
}

// const {User} = require('./models');
// User.deleteMany({}).exec();

const io = require('socket.io')(port);
const Server = require('./Server');
new Server(io, storage, tempPath);
