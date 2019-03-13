// @ts-nocheck

const mongoose = require('mongoose');
// const ObjectId = mongoose.Schema.Types.ObjectId;

exports.User = mongoose.model('User', {
  username: String,
  email: String,
  salt: String,
  hash: String,
});
