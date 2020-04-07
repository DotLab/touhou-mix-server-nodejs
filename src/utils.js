
const {RECAPTCHA_SECRET, TEST_RECAPTCHA_SECRET, MAILGUN_API_KEY} = require('./secrets');

const axios = require('axios');
const mongoose = require('mongoose');

const mailgun = require('mailgun-js')({apiKey: MAILGUN_API_KEY, domain: 'mail.thmix.org'});

const env = process.env.NODE_ENV;

exports.verifyRecaptcha = async function(recaptcha, ip) {
  // @ts-ignore
  const res = await axios.post('https://www.google.com/recaptcha/api/siteverify', null, {
    params: {
      secret: env === 'development' ? TEST_RECAPTCHA_SECRET : RECAPTCHA_SECRET,
      response: recaptcha,
      remoteip: ip,
    },
  });
  return res.data.success;
};

exports.verifyObjectId = function(objectId) {
  return (typeof objectId === 'string') && mongoose.Types.ObjectId.isValid(objectId);
};

exports.emptyHandle = () => {};

const sendEmail = function(fromName, fromAddr, toAddr, subject, text) {
  return mailgun.messages().send({
    from: `${fromName} <${fromAddr}>`,
    to: toAddr,
    subject, text,
  });
};

exports.sendCodeEmail = function(userName, userEmail, action, code) {
  const text = `Dear ${userName},

Here is the Code you need to ${action}:

${code}

This email was generated because of an attempt from your account.

The Code is required to complete the action. No one can complete the action using your account without also accessing this email.

If you are not attempting to ${action}, please change your password and consider changing your email password to ensure account security.

Sincerely,
The Touhou Mix Team

https://thmix.org/help`;

  return sendEmail('Touhou Mix Support', 'no-reply@mail.thmix.org', userEmail, 'Your Touhou Mix account: Attempt to ' + action, text);
};

exports.filterUndefinedKeys = function(obj) {
  return Object.keys(obj).reduce((acc, cur) => {
    if (obj[cur] !== undefined) acc[cur] = obj[cur];
    return acc;
  }, {});
};

/**
 * "-approvedDate" -> {approvedDate: -1}
 * @param {String} sort
 * @return {Object.<String, Number>}
 */
exports.sortQueryToSpec = function(sort) {
  const spec = {};
  sort.split(' ').forEach((x) => {
    if (x[0] === '-') {
      spec[x.substring(1)] = -1;
    } else {
      if (x[0] === '+') {
        spec[x.substring(1)] = 1;
      } else {
        spec[x] = 1;
      }
    }
  });
  return spec;
};

/*
 * @param {any} obj
 * @param {String} path
 * @param {any} val
 * @return {any}
 */
function get(obj, path, val) {
  if (!obj) return val;
  const segs = path.split('.');
  for (let i = 0; i < segs.length; i++) {
    obj = obj[segs[i]];
    if (!obj) return val;
  }
  return obj;
}
exports.get = get;

/**
 * @param {any} obj
 * @param {String} path
 * @param {any} val
 * @return {any}
 */
function orGet(obj, path, val) {
  if (val) return val;
  return get(obj, path, null);
}
exports.orGet = orGet;

/**
 * Get time between dates in ms.
 * @param {Date|String} end
 * @param {Date|String} start
 * @return {Number}
 */
function getTimeBetween(end, start) {
  if (!end || !start) return 0;
  if (typeof end === 'string') end = new Date(end);
  if (typeof start === 'string') start = new Date(start);
  return end.getTime() - start.getTime();
}
exports.getTimeBetween = getTimeBetween;
