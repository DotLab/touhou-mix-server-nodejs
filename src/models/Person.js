const mongoose = require('mongoose');
const ObjectId = mongoose.Schema.Types.ObjectId;


const PersonSchema = new mongoose.Schema({
  name: String,
  url: String,
  desc: String,
  avatarPath: String,
}, {collection: 'persons'});

const Person = mongoose.model('Person', PersonSchema);
exports.Person = Person;

exports.serializePerson = function(doc) {
  const {
    id,
    name, url, desc, avatarPath,
  } = doc;
  const avatarUrl = avatarPath ? 'https://storage.thmix.org' + avatarPath : null;
  // const avatarUrl = avatarPath ? 'https://storage.cloud.google.com/scarletea' + avatarPath : null;

  return {
    id,
    name, url, desc, avatarPath, avatarUrl,
  };
};
