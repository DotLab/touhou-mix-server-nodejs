const mongoose = require('mongoose');
const ObjectId = mongoose.Schema.Types.ObjectId;

exports.Song = mongoose.model('Song', {
  albumId: ObjectId,
  albumIndex: Number,
  composerId: ObjectId, // Person

  name: String,
  desc: String,
  track: Number,
});

exports.serializeSong = function(doc) {
  const {
    id,
    albumId, composerId, name, desc, track,
  } = doc;

  return {
    id,
    albumId, composerId, name, desc, track,
  };
};
