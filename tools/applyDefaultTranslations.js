const mongoose = require('mongoose');
mongoose.connect(`mongodb://localhost:27017/thmix`, {
  useNewUrlParser: true, useUnifiedTopology: true, useCreateIndex: true,
});
mongoose.set('useFindAndModify', false);

const {Translation} = require('../src/models');

(async () => {
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const docs = await Translation.aggregate([
    {'$group': {
      '_id': {
        'src': '$src',
        'lang': '$lang',
        'editorId': '$editorId',
      },
      'dups': {'$push': '$_id'},
      'count': {'$sum': 1},
    }},
    {'$match': {'count': {'$gt': 1}}},
  ]);

  for (const doc of docs) {
    doc.dups.shift();
    if (doc.dups.length > 0) {
      // console.log('remove', doc.dups.length);
      await Translation.remove({'_id': {'$in': doc.dups}});
    }
  }

  await Translation.updateMany({}, {active: false});
  await Translation.updateMany({editorId: null}, {active: true});

  await Translation.updateMany({date: null}, {date: new Date()});
})();