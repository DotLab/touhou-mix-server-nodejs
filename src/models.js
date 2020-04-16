const crypto = require('crypto');
const debug = require('debug')('thmix:models');
const mongoose = require('mongoose');
const ObjectId = mongoose.Schema.Types.ObjectId;
const {ROLE_MIDI_MOD, ROLE_SITE_OWNER, checkUserRole} = require('./services/RoleService');

const BUCKET_URL = 'https://storage.thmix.org';

exports.connectDatabase = async function(database) {
  const mongoose = require('mongoose');
  await mongoose.connect(`mongodb://localhost:27017/${database}`, {
    useNewUrlParser: true, useUnifiedTopology: true, useCreateIndex: true,
  });
  mongoose.set('useFindAndModify', false);
// mongoose.set('debug', true);
};

/** @type {import('mongoose').Model<Object>} */
exports.User = mongoose.model('User', new mongoose.Schema({
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
  onlineTime: Number,
  performance: Number,
  ranking: Number,

  sCount: Number,
  aCount: Number,
  bCount: Number,
  cCount: Number,
  dCount: Number,
  fCount: Number,
}));

exports.serializeUser = function(user) {
  const {
    id,
    name, joinedDate, seenDate, bio, avatarUrl, roles,
    trialCount, score, combo, accuracy,
    playTime, onlineTime,
    performance, ranking, sCount, aCount, bCount, cCount, dCount, fCount,
  } = user;
  return {
    id,
    name, joinedDate, seenDate, bio, avatarUrl, roles,
    trialCount, score, combo, accuracy,
    avgScore: score / trialCount, avgCombo: combo / trialCount, avgAccuracy: accuracy / trialCount,
    playTime, onlineTime,
    performance, ranking, sCount, aCount, bCount, cCount, dCount, fCount,
    passCount: trialCount - fCount, failCount: fCount,
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

/** @type {import('mongoose').Model<Object>} */
exports.SessionToken = mongoose.model('SessionToken', new mongoose.Schema({
  hash: String,
  userId: ObjectId,
  valid: Boolean,

  issuedDate: Date,
  seenDate: Date,
  // expiredDate: Date,
  invalidatedDate: Date,
}, {collection: 'sessionTokens'}));

exports.genSessionTokenHash = function() {
  return crypto.randomBytes(64).toString('base64');
};

/** @type {import('mongoose').Model<Object>} */
exports.SessionRecord = mongoose.model('SessionRecord', new mongoose.Schema({
  userId: ObjectId,
  tokenId: ObjectId,

  startDate: Date,
  endDate: Date,
}, {collection: 'sessionRecords'}));

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

  mp3Path: String,
  imagePath: String,
  coverPath: String,
  coverBlurPath: String,

  // meta
  uploadedDate: Date,
  approvedDate: Date,
  deadDate: Date,
  // status
  status: String, // PENDING, APPROVED, DEAD
  // source
  sourceArtistName: String,
  sourceArtistNameEng: String,
  sourceAlbumName: String,
  sourceAlbumNameEng: String,
  sourceSongName: String,
  sourceSongNameEng: String,

  derivedFromId: ObjectId,
  supersedeId: ObjectId,
  supersededById: ObjectId,

  songId: ObjectId,
  authorId: ObjectId,

  touhouAlbumIndex: Number,
  touhouSongIndex: Number,

  trialCount: Number,
  downloadCount: Number,
  loveCount: Number,
  voteCount: Number,
  voteSum: Number,

  score: Number,
  combo: Number,
  accuracy: Number,

  sCutoff: Number,
  aCutoff: Number,
  bCutoff: Number,
  cCutoff: Number,
  dCutoff: Number,

  sCount: Number,
  aCount: Number,
  bCount: Number,
  cCount: Number,
  dCount: Number,
  fCount: Number,
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

/** @type {import('mongoose').Model<Object>} */
const Midi = mongoose.model('Midi', MidiSchema);
Midi.syncIndexes().catch((e) => debug(e));
exports.Midi = Midi;

exports.serializeMidi = function(midi, context) {
  let {
    _id,
    uploaderId, uploaderName, uploaderAvatarUrl,
    name, desc, artistName, artistUrl, authorId, songId,
    song, album, author, composer,
    derivedFromId, supersedeId, supersededById,
    mp3Path,
    coverPath, coverBlurPath,
    uploadedDate, approvedDate, status,
    sourceArtistName, sourceAlbumName, sourceSongName,
    touhouAlbumIndex, touhouSongIndex,
    comments, records,
    trialCount, downloadCount, loveCount, voteCount, voteSum,
    score, combo, accuracy,
    sCutoff, aCutoff, bCutoff, cCutoff, dCutoff,
    sCount, aCount, bCount, cCount, dCount, fCount,
    hash,
  } = midi;
  if (author) {
    author = exports.serializePerson(author);
  }
  if (composer) {
    composer = exports.serializePerson(composer);
  }
  if (album) {
    album = exports.serializeAlbum(album);
  }
  if (song) {
    song = exports.serializeSong(song);
  }
  if (!coverPath && album && album.coverPath) {
    coverPath = album.coverPath;
    coverBlurPath = album.coverBlurPath;
  }
  score = score || 0;
  combo = combo || 0;
  accuracy = accuracy || 0;
  trialCount = trialCount || 0;
  loveCount = loveCount || 0;
  voteCount = voteCount || 0;
  voteSum = voteSum || 0;
  sCount = sCount || 0;
  aCount = aCount || 0;
  bCount = bCount || 0;
  cCount = cCount || 0;
  dCount = dCount || 0;
  fCount = fCount || 0;
  return {
    _id,
    id: _id,
    uploaderId, uploaderName, uploaderAvatarUrl,
    name, desc, artistName, artistUrl, authorId, songId,
    song, album, author, composer,
    canEdit: context && context.user && checkUserRole(context.user.roles, ROLE_MIDI_MOD),
    derivedFromId, supersedeId, supersededById,
    mp3Path, mp3Url: mp3Path && BUCKET_URL + mp3Path,
    coverPath, coverUrl: coverPath && BUCKET_URL + coverPath,
    coverBlurPath, coverBlurUrl: coverBlurPath && BUCKET_URL + coverBlurPath,
    uploadedDate, approvedDate, status,
    sourceArtistName, sourceAlbumName, sourceSongName,
    touhouAlbumIndex, touhouSongIndex,
    comments, records,
    trialCount, downloadCount, loveCount, voteCount, voteSum,
    upCount: (voteCount + voteSum) / 2, downCount: voteCount - (voteCount + voteSum) / 2,
    avgScore: !trialCount ? 0 : score / trialCount, avgCombo: !trialCount ? 0 : combo / trialCount, avgAccuracy: !trialCount ? 0 : accuracy / trialCount,
    passCount: trialCount - fCount, failCount: fCount,
    sCutoff, aCutoff, bCutoff, cCutoff, dCutoff,
    sCount, aCount, bCount, cCount, dCount, fCount,
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

/** @type {import('mongoose').Model<Object>} */
exports.Trial = mongoose.model('Trial', new mongoose.Schema({
  userId: ObjectId,
  midiId: ObjectId,
  date: Date,
  version: Number,

  // history: [{note: Number, time: Number, delta: Number}],

  // cached
  duration: Number,

  withdrew: Boolean,
  score: Number,
  combo: Number,
  accuracy: Number,
  performance: Number,
  grade: String,
  gradeLevel: String,

  perfectCount: Number,
  greatCount: Number,
  goodCount: Number,
  badCount: Number,
  missCount: Number,
}));

function getGradeFromAccuracy(accuracy) {
  if (accuracy == 1) return 'Ω';
  if (accuracy >= .9999) return 'SSS';
  if (accuracy >= .999) return 'SS';
  if (accuracy >= .99) return 'S';
  if (accuracy >= .98) return 'A+';
  if (accuracy >= .92) return 'A';
  if (accuracy >= .9) return 'A-';
  if (accuracy >= .88) return 'B+';
  if (accuracy >= .82) return 'B';
  if (accuracy >= .8) return 'B-';
  if (accuracy >= .78) return 'C+';
  if (accuracy >= .72) return 'C';
  if (accuracy >= .7) return 'C-';
  if (accuracy >= .68) return 'D+';
  if (accuracy >= .62) return 'D';
  if (accuracy >= .6) return 'D-';
  return 'F';
}
exports.getGradeFromAccuracy = getGradeFromAccuracy;

function getGradeLevelFromAccuracy(accuracy) {
  if (accuracy >= .99) return 'S';
  if (accuracy >= .9) return 'A';
  if (accuracy >= .8) return 'B';
  if (accuracy >= .7) return 'C';
  if (accuracy >= .6) return 'D';
  return 'F';
}
exports.getGradeLevelFromAccuracy = getGradeLevelFromAccuracy;

function getPassFailFromAccuracy(accuracy) {
  return accuracy >= .6;
}
exports.getPassFailFromAccuracy = getPassFailFromAccuracy;

exports.serializeTrial = function(trial) {
  let {
    id,
    withdrew,
    userId, midiId, date, version, score, combo, accuracy,
    performance, perfectCount, greatCount, goodCount, badCount, missCount, midi, song, album,
    userName, userAvatarUrl,
  } = trial;
  if (midi) {
    midi = exports.serializeMidi(midi);
  }
  return {
    id,
    withdrew,
    userId, midiId, date, version, score, combo, accuracy,
    grade: withdrew ? 'W' : getGradeFromAccuracy(accuracy), gradeLevel: withdrew ? 'F' : getGradeLevelFromAccuracy(accuracy),
    performance, perfectCount, greatCount, goodCount, badCount, missCount, midi, song, album,
    userName, userAvatarUrl,
  };
};

/** @type {import('mongoose').Model<Object>} */
exports.DocComment = mongoose.model('DocComment', new mongoose.Schema({
  docId: ObjectId,
  userId: ObjectId,
  userName: String,
  userAvatarPath: String,

  text: String,
  date: Date,
}, {collection: 'docComments'}));

exports.serializeDocComment = function(doc) {
  const {
    _id,
    docId,
    userId, userName, userAvatarPath,
    text, date,
  } = doc;
  return {
    _id,
    docId,
    userId, userName, userAvatarPath, userAvatarUrl: BUCKET_URL + userAvatarPath,
    text, date,
  };
};

/** @type {import('mongoose').Model<Object>} */
exports.Message = mongoose.model('Message', new mongoose.Schema({
  userId: ObjectId,
  userName: String,
  userAvatarUrl: String,

  date: Date,
  text: String,
  upCount: Number,
  downCount: Number,
}));

/** @type {import('mongoose').Model<Object>} */
exports.Translation = mongoose.model('Translation', new mongoose.Schema({
  src: String,
  lang: String,
  text: String,
  namespace: String,

  date: Date,
  editorId: ObjectId,
  editorName: String,

  active: Boolean,
}));

exports.serializeTranslation = function(doc) {
  const {_id, src, lang, text, namespace, date, editorId, editorName} = doc;
  return {_id, id: _id, src, lang, text, namespace, ns: namespace, date, editorId, editorName};
};

/** @type {import('mongoose').Model<Object>} */
exports.Build = mongoose.model('Build', new mongoose.Schema({
  uploaderId: ObjectId,
  uploaderName: String,
  uploaderAvatarUrl: String,

  date: Date,
  build: Number,
  version: String,
  name: String,
  desc: String,
  path: String,
}));

exports.serializeBuild = function(doc) {
  const {
    id,
    uploaderId, uploaderName, uploaderAvatarUrl,
    date, build, version, name, desc, path,
  } = doc;
  const url = BUCKET_URL + path;
  return {
    id,
    uploaderId, uploaderName, uploaderAvatarUrl,
    date, build, version, name, desc, path, url,
  };
};

/** @type {import('mongoose').Model<Object>} */
exports.Album = mongoose.model('Album', new mongoose.Schema({
  index: Number,
  name: String,
  category: String, // touhou, anime, game
  desc: String,
  date: Date,
  abbr: String,

  imagePath: String,
  coverPath: String,
  coverBlurPath: String,
}));

exports.serializeAlbum = function(doc) {
  const {
    _id,
    name, desc, date, abbr, category,
    songs, composer,
    coverPath, coverBlurPath,
  } = doc;
  return {
    _id,
    id: _id,
    name, desc, date, abbr, category,
    songs, composer,
    coverPath, coverBlurPath,
    coverUrl: coverPath ? BUCKET_URL + coverPath : null,
    coverBlurUrl: coverBlurPath ? BUCKET_URL + coverBlurPath : null,
  };
};

/** @type {import('mongoose').Model<Object>} */
exports.Song = mongoose.model('Song', new mongoose.Schema({
  albumId: ObjectId,
  albumIndex: Number,
  composerId: ObjectId, // Person

  name: String,
  desc: String,
  track: Number,
}));

exports.serializeSong = function(doc) {
  const {
    _id,
    albumId, composerId, name, desc, track, category,
  } = doc;

  return {
    _id,
    id: _id,
    albumId, composerId, name, desc, track, category,
  };
};

const PersonSchema = new mongoose.Schema({
  name: String,
  url: String,
  desc: String,
  avatarPath: String,
}, {collection: 'persons'});

/** @type {import('mongoose').Model<Object>} */
const Person = mongoose.model('Person', PersonSchema);
exports.Person = Person;

exports.serializePerson = function(doc) {
  const {
    _id,
    name, url, desc, avatarPath,
  } = doc;
  const avatarUrl = avatarPath ? BUCKET_URL + avatarPath : null;
  return {
    _id, id: _id,
    name, url, desc, avatarPath, avatarUrl,
  };
};

/** @type {import('mongoose').Model<Object>} */
exports.Soundfont = mongoose.model('Soundfont', new mongoose.Schema({
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

  // upCount: Number,
  // downCount: Number,
  loveCount: Number,
  voteCount: Number,
  voteSum: Number,
}));

exports.serializeSoundfont = function(soundfont) {
  const {
    id,
    uploaderId, uploaderName, uploaderAvatarUrl, name,
    nameEng, desc, hash, path, uploadedDate, status,
    coverPath, coverUrl, coverBlurPath, coverBlurUrl,
    // upCount, downCount, loveCount,
    loveCount, voteCount, voteSum,
  } = soundfont;
  return {
    id,
    uploaderId, uploaderName, uploaderAvatarUrl,
    name, nameEng, desc, hash, path, uploadedDate, status,
    coverPath, coverUrl, coverBlurPath, coverBlurUrl,
    loveCount,
    upCount: (voteCount + voteSum) / 2, downCount: voteCount - (voteCount + voteSum) / 2,
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

const ResourceSchema = new mongoose.Schema({
  uploaderId: ObjectId,
  uploaderName: String,
  uploaderAvatarUrl: String,

  name: String,
  type: String,
  desc: String,
  hash: String,
  path: String,

  uploadedDate: Date,
  approvedDate: Date,
  status: String,
  tags: Array,
});

ResourceSchema.index({
  uploaderName: 'text',
  name: 'text',
  type: 'text',
  desc: 'text',
  status: 'text',
  uploaderId: 'text',
}, {name: 'text_index'});

/** @type {import('mongoose').Model<Object>} */
const Resource = mongoose.model('Resource', ResourceSchema);
Resource.syncIndexes().catch((e) => debug(e));
exports.Resource = Resource;

exports.createDefaultResource = function() {
  return {
    uploaderId: null,

    // meta
    approvedDate: null,
    status: 'PENDING',
    tags: [],
  };
};

exports.serializeResource = function(resource) {
  const {
    id,
    uploaderId, uploaderName, uploaderAvatarUrl,
    name, type, desc, hash, path,
    uploadedDate, approvedDate, status, tags,
  } = resource;
  const url = BUCKET_URL + path;
  return {
    id,
    uploaderId, uploaderName, uploaderAvatarUrl,
    name, type, desc, hash, path, url,
    uploadedDate, approvedDate, status, tags,
  };
};

exports.serializePlay = function(play) {
  const {midi, album} = play;
  if ((midi && midi.coverPath) || (album && album.coverPath)) {
    const coverPath = (midi && midi.coverPath) || (album && album.coverPath);
    play.coverUrl = BUCKET_URL + coverPath;
    const coverBlurPath = (midi && midi.coverBlurPath) || (album && album.coverBlurPath);
    play.coverBlurUrl = BUCKET_URL + coverBlurPath;
  }
  return play;
};

/** @type {import('mongoose').Model<Object>} */
exports.DocAction = mongoose.model('DocAction', new mongoose.Schema({
  userId: ObjectId,

  col: String,
  docId: ObjectId,

  action: String,
  value: Number,

  date: Date,
}, {collection: 'docActions'}));

/** @type {import('mongoose').Model<Object>} */
exports.ErrorReport = mongoose.model('ErrorReport', new mongoose.Schema({
  sessionId: ObjectId,
  userId: ObjectId,
  date: Date,

  version: String,

  message: String,
  stack: String,
  source: String,
  exception: Boolean,

  platform: String,
  runtime: String,

  sampleRate: String,
  bufferSize: String,

  model: String,
  name: String,
  os: String,
  cpu: String,
  gpu: String,
}, {collection: 'errorReports'}));

exports.serializeErrorReport = function(errorReport, context) {
  const {
    _id,
    sessionId, userId, date, version, message, stack, exception,
    source, platform, runtime, sampleRate, bufferSize,
    model, name, os, cpu, gpu,
  } = errorReport;

  if (context && context.user && checkUserRole(context.user.roles, ROLE_SITE_OWNER)) {
    return {
      id: _id,
      sessionId, userId, date, version, message, stack, exception,
      source, platform, runtime, sampleRate, bufferSize,
      model, name, os, cpu, gpu,
    };
  }
  return {
    id: _id,
    date, version, message, stack, exception, platform, runtime,
  };
};

