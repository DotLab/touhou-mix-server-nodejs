const mongoose = require('mongoose');
const ObjectId = mongoose.Schema.Types.ObjectId;

exports.Message = mongoose.model('Message', {
  userId: ObjectId,
  userName: String,
  userAvatarUrl: String,

  date: Date,
  text: String,
  upCount: Number,
  downCount: Number,
});
