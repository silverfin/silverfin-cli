const { BaseApi } = require("./baseApi");

class SharedPartsApi extends BaseApi {
  constructor(parentApi) {
    super();
    this.parentApi = parentApi;
  }

  async read(type, envId, page = 1) {
    const response = await this._makeRequest("get", type, envId, "shared_parts", null, { page, per_page: 200 });
    return response.data;
  }

  async readById(type, envId, sharedPartId) {
    const response = await this._makeRequest("get", type, envId, `shared_parts/${sharedPartId}`);
    return response.data;
  }

  async findByName(type, envId, sharedPartName, page = 1) {
    const sharedParts = await this.read(type, envId, page);

    if (!sharedParts || sharedParts.length === 0) {
      return null;
    }

    const sharedPart = sharedParts.find((element) => element.name === sharedPartName);
    if (sharedPart) {
      return sharedPart;
    }

    return this.findByName(type, envId, sharedPartName, page + 1);
  }

  async update(type, envId, sharedPartId, attributes) {
    const response = await this._makeRequest("post", type, envId, `shared_parts/${sharedPartId}`, attributes);
    return response.data;
  }

  async create(type, envId, attributes) {
    const response = await this._makeRequest("post", type, envId, "shared_parts", attributes);
    return response.data;
  }
}

module.exports = { SharedPartsApi };