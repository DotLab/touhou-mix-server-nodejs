const mongoose = require('mongoose');
const ObjectId = mongoose.Schema.Types.ObjectId;

exports.Soundfont = mongoose.model('Soundfont', {
  uploaderId: ObjectId,
  uploaderName: String,
  uploaderAvatarUrl: String,

  name: String,
  nameEng: String,
  desc: String,
  hash: String,
  path: String,
  coverPath: String,
  coverUrl: String,
  coverBlurPath: String,
  coverBlurUrl: String,

  uploadedDate: Date,
  status: String, // PENDING, APPROVED, DEAD

  upCount: Number,
  downCount: Number,
  loveCount: Number,
});

exports.serializeSoundfont = function(soundfont) {
  const {
    id,
    uploaderId, uploaderName, uploaderAvatarUrl, name,
    nameEng, desc, hash, path, uploadedDate, status,
    coverPath, coverUrl, coverBlurPath, coverBlurUrl,
    upCount, downCount, loveCount,
  } = soundfont;
  return {
    id,
    uploaderId, uploaderName, uploaderAvatarUrl,
    name, nameEng, desc, hash, path, uploadedDate, status,
    coverPath, coverUrl, coverBlurPath, coverBlurUrl,
    upCount, downCount, loveCount,
  };
};

exports.createDefaultSoundfont = function() {
  return {
    uploaderId: null,
    uploaderName: '',
    uploaderAvatarUrl: '',

    name: '',
    nameEng: '',
    desc: '',
    hash: '',
    path: '',

    uploadedDate: null,
    status: 'PENDING',

    upCount: 0,
    downCount: 0,
    loveCount: 0,
  };
};
