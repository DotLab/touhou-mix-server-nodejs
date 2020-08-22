/* eslint-disable no-console */
const {connectDatabase, User} = require('../src/models');

(async () => {
  await connectDatabase('thmix');
  // require('mongoose').set('debug', true);

  await User.updateMany({newDay: false}, {$set: {newDay: true}});
  process.exit(0);
})();
