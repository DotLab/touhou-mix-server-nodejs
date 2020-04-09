const {Translate} = require('@google-cloud/translate').v2;
const {Translation} = require('./models');

class TranslationService {
  constructor(projectId) {
    this.translateContext = new Translate({projectId});
  }

  async translate(src, lang, namespace) {
    if (!namespace) {
      namespace = TranslationService.NAMESPACE_UNKNOWN;
    } else {
      if (lang === 'en' && namespace.substr(0, 2) === 'ui') {
        // ui is in english
        return src;
      }
    }

    const doc = await Translation.findOne({src, lang, namespace, active: true}).exec();
    if (doc) return doc.text;

    const [text] = await this.translateContext.translate(src, lang);
    await Translation.create({src, lang, namespace, text, active: true});
    return text;
  }

  async update(user, src, lang, namespace, text) {
    if (!namespace) {
      namespace = TranslationService.NAMESPACE_UNKNOWN;
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

TranslationService.NAMESPACE_UI = 'ui';
TranslationService.NAMESPACE_UI_APP = 'ui.app';
TranslationService.NAMESPACE_UI_WEB = 'ui.web';
TranslationService.NAMESPACE_UI_VOLATILE = 'ui.volatile';
TranslationService.NAMESPACE_NAME_SONG = 'name.song';
TranslationService.NAMESPACE_NAME_ALBUM = 'name.album';
TranslationService.NAMESPACE_NAME_ARTIFACT = 'name.artifact';
TranslationService.NAMESPACE_TEXT_USER = 'text.user';
TranslationService.NAMESPACE_UNKNOWN = 'unknown';

module.exports = TranslationService;
