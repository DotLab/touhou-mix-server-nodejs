// @ts-nocheck

const mongoose = require('mongoose');
const ObjectId = mongoose.Schema.Types.ObjectId;

exports.User = mongoose.model('User', {
  name: String,
  email: String,
  salt: String,
  hash: String,
  // meta
  joinedDate: Date,
  seenDate: Date,
  bio: String,
  avatarUrl: String,
  avatarPath: String,
  // cached
  playCount: Number,
  totalScores: Number,
  maxCombo: Number,
  accuracy: Number,

  totalPlayTime: Number,
  weightedPp: Number,
  ranking: Number,
  sCount: Number,
  aCount: Number,
  bCount: Number,
  cCount: Number,
  dCount: Number,
  fCount: Number,
});

exports.Midi = mongoose.model('Midi', {
  uploaderId: ObjectId,
  uploaderName: String,
  uploaderAvatarUrl: String,

  name: String,
  desc: String,
  hash: String,
  path: String,
  artistName: String,
  artistUrl: String,
  // meta
  uploadedDate: Date,
  approvedDate: Date,
  // source
  sourceArtistName: String,
  sourceAlbumName: String,
  sourceSongName: String,

  touhouAlbumIndex: Number,
  touhouSongIndex: Number,
  // comments
  comments: [{
    userId: ObjectId,
    userName: String,
    userAvatarUrl: String,
    grade: String,
    date: Date,

    text: String,
  }],
  // cached
  records: [{
    userId: ObjectId,
    userName: String,
    userAvatarUrl: String,
    grade: String,
    date: Date,

    score: Number,
    combo: Number,
    accuracy: Number,
    performance: Number,

    perfectCount: Number,
    greatCount: Number,
    goodCount: Number,
    missCount: Number,
  }],

  trialCount: Number,
  upCount: Number,
  downCount: Number,
  loveCount: Number,

  avgScores: Number,
  avgMaxCombo: Number,
  avgAccuracy: Number,

  passCount: Number,
  failCount: Number,

  sCutoff: Number,
  aCutoff: Number,
  bCutoff: Number,
  cCutoff: Number,
  dCutoff: Number,
});

exports.Trial = mongoose.model('Trial', {
  userId: ObjectId,
  midiId: ObjectId,
  date: Date,

  mode: String,
  history: [{note: Number, tick: Number, delta: Number}],

  // cached
  score: Number,
  combo: Number,
  accuracy: Number,
  performance: Number,

  perfectCount: Number,
  greatCount: Number,
  goodCount: Number,
  missCount: Number,
});
