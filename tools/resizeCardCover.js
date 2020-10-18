const fs = require('fs');
const sharp = require('sharp');
const BUCKET_URL = 'https://storage.thmix.org';
const {connectDatabase, Card} = require('../src/models');
const {emptyHandle} = require('../src/utils');
const {Storage} = require('@google-cloud/storage');
const storage = new Storage();

const tempPath = './temp';
const path = require('path');
if (fs.existsSync(tempPath)) {
  const files = fs.readdirSync(tempPath);
  for (const file of files) {
    fs.unlinkSync(path.join(tempPath, file));
  }
} else {
  fs.mkdirSync(tempPath);
}

const fetch = require('node-fetch');

(async () => {
  await connectDatabase('thmix');
  require('mongoose').set('debug', true);

  await new Promise((resolve) => setTimeout(resolve, 1000));

  const cards = await Card.find({});
  cards.forEach(async (card) => {
    const tokens = card.coverPath.split('/');
    let hash = tokens[tokens.length - 1];
    hash = hash.substring(0, hash.length - 4);

    const res = await fetch(BUCKET_URL + card.coverPath);
    const buffer = await res.buffer();

    const image = sharp(buffer);

    const coverFileName = `${hash}-cover.jpg`;

    const coverLocalPath = tempPath + '/' + coverFileName;
    const coverRemotePath = '/imgs/' + coverFileName;

    // await image.toFile(localPath);
    await image.resize(150, 200).jpeg({quality: 80}).toFile(coverLocalPath);

    await storage.bucket('microvolt-bucket-1').upload(coverLocalPath, {
      coverRemotePath,
      gzip: true,
      metadata: {
        cacheControl: 'public, max-age=31536000',
        acl: [{entity: 'allUsers', role: storage.acl.READER_ROLE}],
      },
    });

    fs.unlink(coverLocalPath, emptyHandle);
  });
})();
