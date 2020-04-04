const mongoose = require('mongoose');
const ObjectId = mongoose.Schema.Types.ObjectId;

const SHCEMA = {
  collection: String,
  docId: ObjectId,

  text: String,
};

const EXPAND = [];

const INDEX = [
  [{text: 'text'}, {name: 'text_index'}],
];
