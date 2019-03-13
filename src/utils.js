
const axios = require('axios');

const {RECAPTCHA_SECRET} = require('./secrets');

exports.verifyRecaptcha = async function(recaptcha, ip) {
  // @ts-ignore
  const res = await axios.post('https://www.google.com/recaptcha/api/siteverify', null, {
    params: {
      secret: RECAPTCHA_SECRET,
      response: recaptcha,
      remoteip: ip,
    },
  });
  return res.data.success;
};
