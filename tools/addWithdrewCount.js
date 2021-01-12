const {connectDatabase, Trial, Midi} = require('../src/models');

(async () => {
  await connectDatabase('thmix');

  const midi = await Trial.aggregate([
    {$match: {withdrew: true}},
    {$group: {
      _id: '$midiId',
      wCount: {$sum: 1},
    }},
  ]);

  await Promise.all(midi.map(async (x) => await Midi.updateOne({_id: x._id}, {$set: {wCount: x.wCount}})));
  process.exit(0);
})();
