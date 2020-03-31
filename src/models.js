// @ts-nocheck
const debug = require('debug')('thmix:models');

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
  roles: Array,
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
    name, joinedDate, seenDate, bio, avatarUrl, roles,
    trialCount, score, combo, accuracy,
    playTime, performance, ranking, sCount, aCount, bCount, cCount, dCount, fCount,
  } = user;
  return {
    id,
    name, joinedDate, seenDate, bio, avatarUrl, roles,
    trialCount, score, combo, accuracy,
    playTime, performance, ranking, sCount, aCount, bCount, cCount, dCount, fCount,
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
    roles: [],
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

const MidiSchema = new mongoose.Schema({
  uploaderId: ObjectId,
  uploaderName: String,
  uploaderAvatarUrl: String,

  name: String,
  nameEng: String,
  desc: String,
  hash: String,
  path: String,
  artistName: String,
  artistNameEng: String,
  artistUrl: String,
  coverPath: String,
  coverUrl: String,
  coverBlurPath: String,
  coverBlurUrl: String,
  // meta
  uploadedDate: Date,
  approvedDate: Date,
  // status
  status: String, // PENDING, APPROVED, DEAD
  // source
  sourceArtistName: String,
  sourceArtistNameEng: String,
  sourceAlbumName: String,
  sourceAlbumNameEng: String,
  sourceSongName: String,
  sourceSongNameEng: String,

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

  trialCount: Number,
  upCount: Number,
  downCount: Number,
  loveCount: Number,

  avgScore: Number,
  avgCombo: Number,
  avgAccuracy: Number,

  score: Number,
  combo: Number,
  accuracy: Number,

  passCount: Number,
  failCount: Number,

  sCutoff: Number,
  aCutoff: Number,
  bCutoff: Number,
  cCutoff: Number,
  dCutoff: Number,
});
MidiSchema.index({
  uploaderName: 'text',
  name: 'text',
  nameEng: 'text',
  desc: 'text',
  status: 'text',
  artistName: 'text',
  artistNameEng: 'text',
  sourceArtistName: 'text',
  sourceArtistNameEng: 'text',
  sourceAlbumName: 'text',
  sourceAlbumNameEng: 'text',
  sourceSongName: 'text',
  sourceSongNameEng: 'text',
}, {name: 'text_index'});
const Midi = mongoose.model('Midi', MidiSchema);
Midi.syncIndexes().catch((e) => debug(e));
exports.Midi = Midi;

exports.serializeMidi = function(midi) {
  const {
    id,
    uploaderId, uploaderName, uploaderAvatarUrl,
    name, desc, artistName, artistUrl,
    coverPath, coverUrl, coverBlurPath, coverBlurUrl,
    uploadedDate, approvedDate, status,
    sourceArtistName, sourceAlbumName, sourceSongName,
    touhouAlbumIndex, touhouSongIndex,
    comments, records,
    trialCount, upCount, downCount, loveCount,
    // avgScore, avgCombo, avgAccuracy,
    score, combo, accuracy,
    passCount, failCount,
    sCutoff, aCutoff, bCutoff, cCutoff, dCutoff,
    hash,
  } = midi;
  return {
    id,
    uploaderId, uploaderName, uploaderAvatarUrl,
    name, desc, artistName, artistUrl,
    coverPath, coverUrl, coverBlurPath, coverBlurUrl,
    uploadedDate, approvedDate, status,
    sourceArtistName, sourceAlbumName, sourceSongName,
    touhouAlbumIndex, touhouSongIndex,
    comments, records,
    trialCount, upCount, downCount, loveCount,
    avgScore: score / trialCount, avgCombo: combo / trialCount, avgAccuracy: accuracy / trialCount,
    passCount, failCount,
    sCutoff, aCutoff, bCutoff, cCutoff, dCutoff,
    hash,
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
    status: 'PENDING',
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

    score: 0,
    combo: 0,
    accuracy: 0,

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

exports.Trial = mongoose.model('Trial', {
  userId: ObjectId,
  midiId: ObjectId,
  date: Date,
  version: Number,

  // history: [{note: Number, time: Number, delta: Number}],

  // cached
  score: Number,
  combo: Number,
  accuracy: Number,
  performance: Number,

  perfectCount: Number,
  greatCount: Number,
  goodCount: Number,
  badCount: Number,
  missCount: Number,
});

exports.Message = mongoose.model('Message', {
  userId: ObjectId,
  userName: String,
  userAvatarUrl: String,

  date: Date,
  text: String,
  upCount: Number,
  downCount: Number,
});

const TestSchema = new mongoose.Schema({
  title: String,
  body: String,
});
TestSchema.index({
  title: 'text',
  body: 'text',
});
const Test = mongoose.model('Test', TestSchema);
Test.syncIndexes().catch((e) => debug(e));

exports.Translation = mongoose.model('Translation', {
  src: String,
  lang: String,
  text: String,
});

exports.Build = mongoose.model('Build', {
  uploaderId: ObjectId,
  uploaderName: String,
  uploaderAvatarUrl: String,

  date: Date,
  build: Number,
  version: String,
  name: String,
  desc: String,
  path: String,
});

exports.serializeBuild = function(doc) {
  const {
    id,
    uploaderId, uploaderName, uploaderAvatarUrl,
    date, build, version, name, desc, path,
  } = doc;
  const url = 'https://storage.thmix.org' + path;
  return {
    id,
    uploaderId, uploaderName, uploaderAvatarUrl,
    date, build, version, name, desc, path, url,
  };
};
