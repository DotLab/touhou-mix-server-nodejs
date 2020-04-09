const {
  DocComment,
  serializeDocComment,
} = require('./models');

exports.commentController = {
  create: async function({
    user: {_id: userId, name: userName, avatarPath: userAvatarPath}, docId, text}) {
    const comment = await DocComment.create({
      docId, userId, userName, userAvatarPath,
      text, date: new Date(),
    });
    return serializeDocComment(comment);
  },

  list: async function({docId}) {
    const comments = await DocComment.find({docId}).sort('-date');
    return comments.map(serializeDocComment);
  },
};
