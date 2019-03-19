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
// const crypto = require('crypto');
// function genPasswordSalt() {
//   return crypto.randomBytes(256).toString('base64');
// }
// function calcPasswordHash(password, salt) {
//   const hasher = crypto.createHash('sha512');
//   hasher.update(password);
//   hasher.update(salt);
//   return hasher.digest('base64');
// }
// const salt = genPasswordSalt();
// const hash = calcPasswordHash('test', salt);
// User.create({
//   name: 'Test', email: 'test@test.com', salt, hash,
//   joinedDate: new Date(), seenDate: new Date(),

//   playCount: 0,
//   totalScores: 0,
//   maxCombo: 0,
//   accuracy: 0,

//   totalPlayTime: 0,
//   weightedPp: 0,
//   ranking: 0,
//   sCount: 0,
//   aCount: 0,
//   bCount: 0,
//   cCount: 0,
//   dCount: 0,
//   fCount: 0,
// });

const io = require('socket.io')(port);
const Server = require('./Server');
new Server(io, storage, tempPath);
