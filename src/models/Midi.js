const mongoose = require('mongoose');
const ObjectId = mongoose.Schema.Types.ObjectId;
const Model = require('./Model');

const SHCEMA = {
  uploaderId: ObjectId, // user

  name: String,
  desc: String,
  hash: String,
  path: String,

  status: String,
  date: Date,
  approvedDate: Date,

  authorId: ObjectId, // person
  authorName: String,
  authorUrl: String,

  composerId: ObjectId, // person
  composerName: String,
  composerUrl: String,

  songId: ObjectId,
  songName: String,
  albumName: String,
  albumCoverPath: String,
  albumCoverBlurPath: String,

  trialCount: Number,
  upCount: Number,
  downCount: Number,
  loveCount: Number,

  scoreSum: Number,
  comboSum: Number,
  accuracySum: Number,
};

const EXPAND = [
  {$lookup: {from: 'users', localField: 'uploaderId', foreignField: '_id', as: 'uploader'}},
  {$unwind: '$uploader'},

  {$lookup: {from: 'persons', localField: 'authorId', foreignField: '_id', as: 'author'}},
  {$unwind: '$author'},
  {$lookup: {from: 'persons', localField: 'composerId', foreignField: '_id', as: 'composer'}},
  {$unwind: '$composer'},

  {$lookup: {from: 'songs', localField: 'songId', foreignField: '_id', as: 'song'}},
  {$unwind: '$song'},
  {$lookup: {from: 'albums', localField: 'song.albumId', foreignField: '_id', as: 'album'}},
  {$unwind: '$album'},
];

const INDEX = [];

const schema = new mongoose.Schema(SHCEMA);
INDEX.forEach((x) => schema.index(x[0], x[1]));

const model = new Model(SHCEMA, {}, );

const Schema = new mongoose.Schema({
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

  songId: ObjectId,
  authorId: ObjectId,

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

Schema.index({
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

const Midi = mongoose.model('Midi', Schema);
Midi.syncIndexes().catch(() => {});
exports.Midi = Midi;

exports.serializeMidi = function(midi) {
  const {
    _id,
    uploaderId, uploaderName, uploaderAvatarUrl,
    name, desc, artistName, artistUrl, authorId, songId, song, album,
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
    id: _id,
    uploaderId, uploaderName, uploaderAvatarUrl,
    name, desc, artistName, artistUrl, authorId, songId, song, album,
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
