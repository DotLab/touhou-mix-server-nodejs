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

// (async () => {
//   const storage = new Storage();
//   // const res = await storage.bucket('thmix-static').file('Icon1.png').getSignedUrl({
//   //   action: 'read',
//   //   expires: Date.now() + 1000 * 60,
//   // });

//   const res = await storage.bucket('thmix-static').upload('./package.json', {
//     metadata: {
//       acl: [
//         {
//           entity: 'allUsers',
//           role: storage.acl.READER_ROLE,
//         },
//       ],
//     },
//   });

//   console.log(res);
// })();


// const {User} = require('./models');
// User.deleteMany({}).exec();

const io = require('socket.io')(port);
const Server = require('./Server');
new Server(io, storage, tempPath);
