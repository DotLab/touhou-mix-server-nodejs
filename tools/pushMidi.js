const {Midi} = require('../src/models');

function createUsers() {
  for (let i = 0; i < 20; i++) {
    Midi.create({
      uploaderId: '5e86a3b0a44ee80384da1ab3',
      uploaderName: 'Test',
      uploaderAvatarUrl: '',
      name: 'midi' + i.toString(),
      desc: '',
    });
  }
}
createUsers();
