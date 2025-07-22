const { BaseApi } = require("./baseApi");

class AccountTemplatesApi extends BaseApi {
  constructor(parentApi) {
    super();
    this.parentApi = parentApi;
  }

  async create(type, envId, attributes) {
    const response = await this._makeRequest("post", type, envId, "account_templates", attributes);
    return response.data;
  }

  async update(type, envId, accountTemplateId, attributes) {
    const response = await this._makeRequest("post", type, envId, `account_templates/${accountTemplateId}`, attributes);
    return response.data;
  }

  async read(type, envId, page = 1) {
    const response = await this._makeRequest("get", type, envId, "account_templates", null, { page, per_page: 200 });
    return response.data;
  }

  async readById(type, envId, accountTemplateId) {
    const response = await this._makeRequest("get", type, envId, `account_templates/${accountTemplateId}`);
    return response.data;
  }

  async findByName(type, envId, accountTemplateName, page = 1) {
    const accountTemplates = await this.read(type, envId, page);

    if (accountTemplates.length === 0) {
      return null;
    }

    const accountTemplate = accountTemplates.find((element) => element.name_nl === accountTemplateName);
    if (accountTemplate) {
      return await this.readById(type, envId, accountTemplate.id);
    }

    return this.findByName(type, envId, accountTemplateName, page + 1);
  }

  async addSharedPart(type, envId, sharedPartId, accountTemplateId) {
    const response = await this._makeRequest("post", type, envId, `account_templates/${accountTemplateId}/shared_parts/${sharedPartId}`);
    return response.data;
  }

  async removeSharedPart(type, envId, sharedPartId, accountTemplateId) {
    const response = await this._makeRequest("delete", type, envId, `account_templates/${accountTemplateId}/shared_parts/${sharedPartId}`);
    return response.data;
  }
}

module.exports = { AccountTemplatesApi };