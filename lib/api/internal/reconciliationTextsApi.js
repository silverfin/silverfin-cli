const { BaseApi } = require("./baseApi");

class ReconciliationTextsApi extends BaseApi {
  constructor(parentApi) {
    super();
    this.parentApi = parentApi;
  }

  async create(type, envId, attributes) {
    const response = await this._makeRequest("post", type, envId, "reconciliations", attributes);
    return response.data;
  }

  async read(type, envId, page = 1) {
    const response = await this._makeRequest("get", type, envId, "reconciliations", null, { page, per_page: 200 });
    return response.data;
  }

  async readById(type, envId, id) {
    const response = await this._makeRequest("get", type, envId, `reconciliations/${id}`);
    return response.data;
  }

  async findByHandle(type, envId, handle, page = 1) {
    const reconciliations = await this.read(type, envId, page);

    if (reconciliations.length === 0) {
      return null;
    }

    const reconciliationTexts = reconciliations.filter((element) => element.handle === handle);

    if (reconciliationTexts.length !== 0) {
      for (const reconciliationText of reconciliationTexts) {
        if (Object.hasOwn(reconciliationText, "marketplace_template_id") && reconciliationText.marketplace_template_id !== null) {
          continue;
        }
        if (Object.hasOwn(reconciliationText, "text")) {
          return reconciliationText;
        }
      }
    }
    return this.findByHandle(type, envId, handle, page + 1);
  }

  async update(type, envId, reconciliationId, attributes) {
    const response = await this._makeRequest("post", type, envId, `reconciliations/${reconciliationId}`, attributes);
    return response.data;
  }

  async readDetails(type, envId, companyId, periodId, reconciliationId) {
    const response = await this._makeRequest("get", type, envId, `/companies/${companyId}/periods/${periodId}/reconciliations/${reconciliationId}`);
    return response.data;
  }

  async getCustom(type, envId, companyId, periodId, reconciliationId, page = 1) {
    const response = await this._makeRequest("get", type, envId, `/companies/${companyId}/periods/${periodId}/reconciliations/${reconciliationId}/custom`, null, {
      page,
      per_page: 200,
    });
    return response.data;
  }

  async getResults(type, envId, companyId, periodId, reconciliationId) {
    const response = await this._makeRequest("get", type, envId, `/companies/${companyId}/periods/${periodId}/reconciliations/${reconciliationId}/results`);
    return response.data;
  }

  async addSharedPart(type, envId, sharedPartId, reconciliationId) {
    const response = await this._makeRequest("post", type, envId, `reconciliations/${reconciliationId}/shared_parts/${sharedPartId}`);
    return response.data;
  }

  async removeSharedPart(type, envId, sharedPartId, reconciliationId) {
    const response = await this._makeRequest("delete", type, envId, `reconciliations/${reconciliationId}/shared_parts/${sharedPartId}`);
    return response.data;
  }
}

module.exports = { ReconciliationTextsApi };