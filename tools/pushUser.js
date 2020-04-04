const {User} = require('../src/models');
// User.deleteMany({}).exec();
// Midi.deleteMany({}).exec();
const crypto = require('crypto');
function genPasswordSalt() {
  return crypto.randomBytes(256).toString('base64');
}
function calcPasswordHash(password, salt) {
  const hasher = crypto.createHash('sha512');
  hasher.update(password);
  hasher.update(salt);
  return hasher.digest('base64');
}

function createUsers() {
  const salt = genPasswordSalt();
  const hash = calcPasswordHash('test', salt);
  for (let i = 0; i < 2; i++) {
    User.create({
      name: 'Test' + i, email: 'test' + i + '@test.com', salt, hash,
      joinedDate: new Date(), seenDate: new Date(),

      playCount: 0,
      totalScores: 0,
      maxCombo: 0,
      accuracy: 0,
      roles: [],

      totalPlayTime: 0,
      weightedPp: 0,
      ranking: 0,
      sCount: 0,
      aCount: 0,
      bCount: 0,
      cCount: 0,
      dCount: 0,
      fCount: 0,
    });
  }
}
createUsers();
