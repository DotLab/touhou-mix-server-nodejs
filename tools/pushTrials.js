const {User, Trial, Midi} = require('../src/models');

async function createTrials() {
  const test = await User.findOne({name: 'Test'});
  const test0 = await User.findOne({name: 'Test0'});
  const test1 = await User.findOne({name: 'Test1'});
  const midis = await Midi.find({});

  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < midis.length; j++) {
      await Trial.create({
        userId: test.id,
        midiId: midis[j].id,
        version: 3,
        date: new Date(),

        score: 100 + 200 * i + Math.random() * 100,

        accuracy: 100 * Math.random(),
        performance: 100 + 200 * i + Math.random() * 100,
        perfectCount: Math.random() * 100,
      });
    }
  }

  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < midis.length; j++) {
      await Trial.create({
        userId: test0.id,
        midiId: midis[j].id,
        version: 3,
        date: new Date(),

        score: 200 * i + Math.random() * 100,

        accuracy: 100 * Math.random(),
        performance: 200 * i + Math.random() * 100,
        perfectCount: Math.random() * 100,
      });
    }
  }

  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < midis.length; j++) {
      await Trial.create({
        userId: test1.id,
        midiId: midis[j].id,
        version: 3,
        date: new Date(),

        score: 300 * i + Math.random() * 100,

        accuracy: 100 * Math.random(),
        performance: 300 * i + Math.random() * 100,
        perfectCount: Math.random() * 100,
      });
    }
  }
}


createTrials();
