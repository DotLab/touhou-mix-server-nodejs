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

// const {Storage} = require('@google-cloud/storage');
// const storage = new Storage();

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

const {User, Midi, createDefaultUser, createDefaultMidi} = require('./models');

const crypto = require('crypto');

function calcFileHash(buffer) {
  const hasher = crypto.createHash('md5');
  hasher.update(buffer);
  return hasher.digest('hex');
}

// const bucket = storage.bucket('thmix-static');

const uploadBatch = async (artist, user, midis) => {
  midis.midis.forEach(async (midi) => {
    const buffer = fs.readFileSync('./res/' + midis.prefix + midi.name + '.mid');
    const hash = calcFileHash(buffer);

    await Midi.deleteMany({hash});

    const remotePath = `/midis/${hash}.mid`;
    const localPath = `${tempPath}/${hash}.mid`;

    fs.writeFileSync(localPath, buffer);
    // await bucket.upload(localPath, {destination: remotePath});
    fs.unlink(localPath, () => {});

    debug(hash);

    await Midi.create({
      ...createDefaultMidi(),
      ...artist,

      uploaderId: user.id,
      uploaderName: user.name,
      uploaderAvatarUrl: user.avatarUrl,

      name: midi.name,
      hash,
      path: remotePath,
      // meta
      uploadedDate: new Date(),
      approvedDate: new Date(),
      status: 'APPROVED',
      // source
      sourceArtistName: 'ZUN',
      touhouAlbumIndex: midi.album,
      touhouSongIndex: midi.song,
    });
  });
};

// @ts-ignore
const dmbnNewMidis = require('../res/midis_dmbn_new.json');
// @ts-ignore
const dmbnOldMidis = require('../res/midis_dmbn_old.json');
// @ts-ignore
const miscMidis = require('../res/midis_misc.json');

(async () => {
  let user = await User.findOne({name: 'System'});
  if (!user) {
    const now = new Date();
    user = await User.create({
      ...createDefaultUser(),
      name: 'System',
      email: 'system@mail.thmix.org',
      salt: 'cannot',
      hash: 'login',
      joinedDate: now,
      seenDate: now,
    });
  }

  const dmbnNew = {
    artistName: 'DMBN',
    artistUrl: 'http://easypianoscore.jp/',
    desc: '東方ピアノEasyモード楽譜集 新バージョン',
  };

  const dmbnOld = {
    artistName: 'DMBN',
    artistUrl: 'http://easypianoscore.jp/',
    desc: '東方ピアノEasyモード楽譜集 旧バージョン',
  };

  const misc = {
    artistName: 'S.K.',
    desc: 'Made by a friend.',
  };

  uploadBatch(dmbnNew, user, dmbnNewMidis);
  uploadBatch(dmbnOld, user, dmbnOldMidis);
  uploadBatch(misc, user, miscMidis);
})();
