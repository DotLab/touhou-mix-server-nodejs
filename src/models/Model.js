const ObjectId = require('mongoose').Types.ObjectId;
const {ROLE_NONE} = require('../services/RoleService');

class Model {
  constructor(model, roleViewDict, expandSpecList) {
    /** @type {import('mongoose').Model} */
    this.model = model;
    this.roleViewDict = roleViewDict;
    this.expandSpecList = expandSpecList;
  }

  createView(role) {
    role = role || ROLE_NONE;
    return this.roleViewDict[role].map(() => 1);
  }

  async get(id) {
    return await this.list([
      {$match: {_id: new ObjectId(id)}},
      {$limit: 1},
    ])[0];
  }

  async getView(id, role) {
    return await this.getView([
      {$match: {_id: new ObjectId(id)}},
      {$limit: 1},
    ], role)[0];
  }

  async list(specs) {
    return await this.model.aggregate([
      ...specs,
      ...this.expandSpecList,
    ]);
  }

  async listView(specs, role) {
    return await this.model.aggregate([
      ...specs,
      {$project: this.createView(role)},
      ...this.expandSpecList,
    ]);
  }

  async update(id, specs) {
    await this.model.updateOne({_id: new ObjectId(id)}, specs);
  }
}

Model.SCHEMA_UPLOADABLE = {

};

module.exports = Model;
