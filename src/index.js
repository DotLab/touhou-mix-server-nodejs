const debug = require('debug')('thmix');

const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/thmix', {useNewUrlParser: true});
mongoose.set('useFindAndModify', false);
const ObjectId = mongoose.Schema.Types.ObjectId;

