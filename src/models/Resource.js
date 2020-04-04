const mongoose = require('mongoose');
const ObjectId = mongoose.Schema.Types.ObjectId;

const ResourceSchema = new mongoose.Schema({
  uploaderId: ObjectId,
  uploaderName: String,
  uploaderAvatarUrl: String,

  name: String,
  type: String,
  desc: String,
  hash: String,
  path: String,

  uploadedDate: Date,
  approvedDate: Date,
  status: String,
  tags: Array,
});

ResourceSchema.index({
  uploaderName: 'text',
  name: 'text',
  type: 'text',
  desc: 'text',
  status: 'text',
  uploaderId: 'text',
}, {name: 'text_index'});
const Resource = mongoose.model('Resource', ResourceSchema);
Resource.syncIndexes().catch((e) => debug(e));
exports.Resource = Resource;

exports.createDefaultResource = function() {
  return {
    uploaderId: null,

    // meta
    approvedDate: null,
    status: 'PENDING',
    tags: [],
  };
};

exports.serializeResource = function(resource) {
  const bucketName = 'scarletea';
  const {
    id,
    uploaderId, uploaderName, uploaderAvatarUrl,
    name, type, desc, hash, path,
    uploadedDate, approvedDate, status, tags,
  } = resource;
  const url = 'https://storage.googleapis.com/' + bucketName + path;

  return {
    id,
    uploaderId, uploaderName, uploaderAvatarUrl,
    name, type, desc, hash, path, url,
    uploadedDate, approvedDate, status, tags,
  };
};
