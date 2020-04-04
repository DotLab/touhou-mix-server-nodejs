const {Storage} = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');

module.exports = class BucketService {
  constructor(tempPath, bucketName) {
    this.storage = new Storage();
    this.tempPath = tempPath;

    this.bucketName = bucketName;
    this.bucket = this.storage.bucket(bucketName);

    this.clearTemp();
  }

  clearTemp() {
    if (fs.existsSync(this.tempPath)) {
      const files = fs.readdirSync(this.tempPath);
      for (const file of files) {
        fs.unlinkSync(path.join(this.tempPath, file));
      }
    } else {
      fs.mkdirSync(this.tempPath);
    }
  }

  uploadPublic(file, destination) {
    return this.bucket.upload(file, {
      destination,
      metadata: {
        gzip: true,
        cacheControl: 'public, max-age=31536000',
        acl: [{entity: 'allUsers', role: this.storage.acl.READER_ROLE}],
      },
    });
  }

  uploadPrivate(file, destination) {
    return this.bucket.upload(file, {destination});
  }

  getPublicUrl(path) {
    return 'https://storage.thmix.org/' + this.bucketName + path;
  }

  async getSignedUrl(path, age) {
    return await this.bucket.file(path).getSignedUrl({
      action: 'read',
      expires: Date.now() + age,
    });
  }
};
