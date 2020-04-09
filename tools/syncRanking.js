/* eslint-disable no-console */
const {connectDatabase, User} = require('../src/models');

(async () => {
  await connectDatabase('thmix');
  // require('mongoose').set('debug', true);

  const rank = await User.aggregate([
    {$sort: {performance: -1, score: -1, seenDate: 1}},
    {$group: {
      _id: 0,
      users: {$push: {_id: '$_id'}},
    }},
    {$unwind: {
      path: '$users',
      includeArrayIndex: 'ranking',
    }},
    {$addFields: {'users.ranking': '$ranking'}},
    {$replaceRoot: {newRoot: '$users'}},
  ]);
  await Promise.all(rank.map(async (x) => await User.updateOne({_id: x._id}, {$set: {ranking: x.ranking}})));

  process.exit(0);
})();
