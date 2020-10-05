const {
  Midi, serializeMidi,
  DocComment, serializeDocComment,
} = require('./models');

exports.commentController = {
  create: async function({
    user: {_id: userId, name: userName, avatarPath: userAvatarPath}, docId, text, data}) {
    const comment = await DocComment.create({
      docId, userId, userName, userAvatarPath,
      text, date: new Date(), data,
    });
    return serializeDocComment(comment);
  },

  list: async function({docId}) {
    const comments = await DocComment.find({docId}).sort('-date');
    return comments.map(serializeDocComment);
  },
};

exports.midiController = {
  get: async function(id, user) {
    const midi = await Midi.aggregate([
      {$match: {_id: id}},
      {$lookup: {from: 'songs', localField: 'songId', foreignField: '_id', as: 'song'}},
      {$unwind: {path: '$song', preserveNullAndEmptyArrays: true}},
      {$lookup: {from: 'albums', localField: 'song.albumId', foreignField: '_id', as: 'album'}},
      {$unwind: {path: '$album', preserveNullAndEmptyArrays: true}},
      {$lookup: {from: 'persons', localField: 'authorId', foreignField: '_id', as: 'author'}},
      {$unwind: {path: '$author', preserveNullAndEmptyArrays: true}},
      {$lookup: {from: 'persons', localField: 'song.composerId', foreignField: '_id', as: 'composer'}},
      {$unwind: {path: '$composer', preserveNullAndEmptyArrays: true}},
    ]);
    return serializeMidi(midi[0], {user});
  },
};
