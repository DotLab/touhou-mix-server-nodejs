// @ts-nocheck

const mongoose = require('mongoose');
// const ObjectId = mongoose.Schema.Types.ObjectId;

exports.User = mongoose.model('User', {
  name: String,
  email: String,
  salt: String,
  hash: String,
  // meta
  joinedDate: Date,
  seenDate: Date,
  bio: String,
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
