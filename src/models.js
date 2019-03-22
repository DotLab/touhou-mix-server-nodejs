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
  trialCount: Number,
  score: Number,
  combo: Number,
  accuracy: Number,

  playTime: Number,
  performance: Number,
  ranking: Number,
  sCount: Number,
  aCount: Number,
  bCount: Number,
  cCount: Number,
  dCount: Number,
  fCount: Number,
});

exports.serializeUser = function(user) {
  const {
    id,
    name, joinedDate, seenDate, bio, avatarUrl,
    playCount, totalScores, maxCombo, accuracy,
    totalPlayTime, weightedPp, ranking, sCount, aCount, bCount, cCount, dCount, fCount,
  } = user;
  return {
    id,
    name, joinedDate, seenDate, bio, avatarUrl,
    playCount, totalScores, maxCombo, accuracy,
    totalPlayTime, weightedPp, ranking, sCount, aCount, bCount, cCount, dCount, fCount,
  };
};

exports.createDefaultUser = function() {
  return {
    name: '',
    email: '',
    salt: '',
    hash: '',
    // meta
    joinedDate: null,
    seenDate: null,
    bio: '',
    avatarUrl: '',
    avatarPath: '',
    // cached
    trialCount: 0,
    score: 0,
    combo: 0,
    accuracy: 0,

    playTime: 0,
    performance: 0,
    ranking: 0,
    sCount: 0,
    aCount: 0,
    bCount: 0,
    cCount: 0,
    dCount: 0,
    fCount: 0,
  };
};

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

  avgScore: Number,
  avgCombo: Number,
  avgAccuracy: Number,

  passCount: Number,
  failCount: Number,

  sCutoff: Number,
  aCutoff: Number,
  bCutoff: Number,
  cCutoff: Number,
  dCutoff: Number,
});

exports.serializeMidi = function(midi) {
  const {
    id,
    uploaderId, uploaderName, uploaderAvatarUrl,
    name, desc, artistName, artistUrl,
    uploadedDate, approvedDate,
    sourceArtistName, sourceAlbumName, sourceSongName,
    touhouAlbumIndex, touhouSongIndex,
    comments, records,
    trialCount, upCount, downCount, loveCount,
    avgScores, avgMaxCombo, avgAccuracy,
    passCount, failCount,
    sCutoff, aCutoff, bCutoff, cCutoff, dCutoff,
  } = midi;
  return {
    id,
    uploaderId, uploaderName, uploaderAvatarUrl,
    name, desc, artistName, artistUrl,
    uploadedDate, approvedDate,
    sourceArtistName, sourceAlbumName, sourceSongName,
    touhouAlbumIndex, touhouSongIndex,
    comments, records,
    trialCount, upCount, downCount, loveCount,
    avgScores, avgMaxCombo, avgAccuracy,
    passCount, failCount,
    sCutoff, aCutoff, bCutoff, cCutoff, dCutoff,
  };
};

exports.createDefaultMidi = function() {
  return {
    uploaderId: null,
    uploaderName: '',
    uploaderAvatarUrl: '',

    name: '',
    desc: '',
    hash: '',
    path: '',
    artistName: '',
    artistUrl: '',
    // meta
    uploadedDate: null,
    approvedDate: null,
    // source
    sourceArtistName: '',
    sourceAlbumName: '',
    sourceSongName: '',

    touhouAlbumIndex: -1,
    touhouSongIndex: -1,
    // comments
    comments: [],
    // cached
    records: [],

    trialCount: 0,
    upCount: 0,
    downCount: 0,
    loveCount: 0,

    avgScore: 0,
    avgCombo: 0,
    avgAccuracy: 0,

    passCount: 0,
    failCount: 0,

    sCutoff: 0,
    aCutoff: 0,
    bCutoff: 0,
    cCutoff: 0,
    dCutoff: 0,
  };
};

exports.createDefaultMidiComment = function() {
  return {
    userId: null,
    userName: '',
    userAvatarUrl: '',
    grade: '',
    date: null,

    text: '',
  };
};

exports.createDefaultMidiRecord = function() {
  return {
    userId: null,
    userName: '',
    userAvatarUrl: '',
    grade: '',
    date: null,

    score: 0,
    combo: 0,
    accuracy: 0,
    performance: 0,

    perfectCount: 0,
    greatCount: 0,
    goodCount: 0,
    missCount: 0,
  };
};

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
