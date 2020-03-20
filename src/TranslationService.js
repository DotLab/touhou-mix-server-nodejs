const {Translate} = require('@google-cloud/translate').v2;
const {Translation} = require('./models');

module.exports = class TranslationService {
  constructor(projectId) {
    this.translateContext = new Translate({projectId});
  }

  async translate(src, lang) {
    const doc = await Translation.findOne({src, lang}).exec();
    if (doc) return doc.text;

    const [text] = await this.translateContext.translate(src, lang);
    await Translation.create({src, lang, text});
    return text;
  }
};
