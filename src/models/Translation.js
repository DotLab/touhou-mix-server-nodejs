const mongoose = require('mongoose');
const ObjectId = mongoose.Schema.Types.ObjectId;

exports.Translation = mongoose.model('Translation', {
  src: String,
  lang: String,
  text: String,
});
