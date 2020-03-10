module.exports = class BucketService {
  constructor(storage, tempPath, bucketName) {
    this.storage = storage;
    this.tempPath = tempPath;

    this.bucketName = bucketName;
    /** @type {import('@google-cloud/storage').Bucket} */
    this.bucket = storage.bucket(bucketName);
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
