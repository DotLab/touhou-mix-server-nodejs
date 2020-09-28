const {Translate} = require('@google-cloud/translate').v2;
const {Translation} = require('./models');

class TranslationService {
  constructor(projectId) {
    this.translateContext = new Translate({projectId});
  }

  async translate(src, lang, namespace) {
    if (!namespace) {
      namespace = TranslationService.UNKNOWN;
    } else {
      if (lang === 'en' && namespace.substr(0, 2) === 'ui') {
        // ui must be in english
        return src;
      }
    }

    const doc = await Translation.findOne({src, lang, namespace, active: true}).exec();
    if (doc) return doc.text;

    try {
      const [text] = await this.translateContext.translate(src, lang);
      await Translation.create({src, lang, namespace, text, active: true});
      return text;
    } catch (e) {
      return src;
    }
  }

  async update(user, src, lang, namespace, text) {
    if (!namespace) {
      namespace = TranslationService.UNKNOWN;
    }
    await Translation.updateMany({src, lang, namespace}, {$set: {active: false}});
    await Translation.updateOne({
      src, lang, namespace, editorId: user._id,
    }, {
      src, lang, namespace, text,
      editorId: user._id,
      editorName: user.name,
      active: true,
      date: new Date(),
    }, {upsert: true});
  }
}

TranslationService.UI = 'ui';
TranslationService.UI_APP = 'ui.app';
TranslationService.UI_WEB = 'ui.web';
TranslationService.UI_VOLATILE = 'ui.volatile';
TranslationService.NAME_SONG = 'name.song';
TranslationService.NAME_ALBUM = 'name.album';
TranslationService.NAME_ARTIFACT = 'name.artifact';
TranslationService.TEXT_USER = 'text.user';
TranslationService.UNKNOWN = 'unknown';

module.exports = TranslationService;
