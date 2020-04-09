/* eslint-disable no-console */
const {connectDatabase, User, Midi, Trial} = require('../src/models');

async function syncDocs(model, fieldName) {
  const docs = await model.find({});
  for (const doc of docs) {
    console.log('sync', doc.name);
    const sumRes = await Trial.aggregate([
      {$match: {[fieldName]: doc._id}},
      {$group: {
        _id: 0,
        trialCount: {$sum: 1},
        score: {$sum: '$score'},
        combo: {$sum: '$combo'},
        accuracy: {$sum: '$accuracy'},
        performance: {$sum: '$performance'},
      }},
    ]);
    console.log(sumRes);
    if (!sumRes.length) {
      await model.updateOne({_id: doc._id}, {$set: {
        trialCount: 0,
        score: 0,
        combo: 0,
        accuracy: 0,
        performance: 0,
      }});
    } else {
      await model.updateOne({_id: doc._id}, {$set: {
        trialCount: sumRes[0].trialCount,
        score: sumRes[0].score,
        combo: sumRes[0].combo,
        accuracy: sumRes[0].accuracy,
        performance: sumRes[0].performance,
      }});
    }

    const bucketRes = await Trial.aggregate([
      {$match: {[fieldName]: doc._id}},
      {$bucket: {
        groupBy: '$accuracy',
        boundaries: [.6, .7, .8, .9, .99, 2],
        default: 0,
        output: {
          count: {$sum: 1},
        },
      }},
    ]);
    console.log(bucketRes);
    const bucketDict = bucketRes.reduce((acc, cur) => {
      acc[cur._id] = cur.count;
      return acc;
    }, {
      [0]: 0,
      [.6]: 0,
      [.7]: 0,
      [.8]: 0,
      [.9]: 0,
      [.99]: 0,
    });
    await model.updateOne({_id: doc._id}, {$set: {
      sCount: bucketDict[.99],
      aCount: bucketDict[.9],
      bCount: bucketDict[.8],
      cCount: bucketDict[.7],
      dCount: bucketDict[.6],
      fCount: bucketDict[0],
    }});
  }
}

(async () => {
  await connectDatabase('thmix');
  // require('mongoose').set('debug', true);

  await Trial.updateMany({}, [
    {$set: {
      performance: {$multiply: [{$ln: {$add: [1, '$score']}}, {$pow: ['$accuracy', 2]}]},
    }},
  ]);

  await syncDocs(User, 'userId');
  await syncDocs(Midi, 'midiId');

  process.exit(0);
})();
