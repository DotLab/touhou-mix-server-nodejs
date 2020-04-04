const mongoose = require('mongoose');
const ObjectId = mongoose.Schema.Types.ObjectId;

exports.Album = mongoose.model('Album', {
  index: Number,
  name: String,
  desc: String,
  date: Date,
  abbr: String,

  coverPath: String,
  coverBlurPath: String,
});

exports.serializeAlbum = function(doc) {
  const {
    id,
    name, desc, date, abbr, coverPath, coverBlurPath,
  } = doc;
  const coverUrl = coverPath ? 'https://storage.thmix.org' + coverPath : null;
  // const coverUrl = coverPath ? 'https://storage.cloud.google.com/scarletea' + coverPath : null;
  const coverBlurUrl = coverBlurPath ? 'https://storage.thmix.org' + coverBlurPath : null;

  return {
    id,
    name, desc, date, abbr, coverPath, coverBlurPath, coverUrl, coverBlurUrl,
  };
};
