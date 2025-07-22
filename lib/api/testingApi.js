const { consola } = require("consola");
const { AxiosFactory } = require("./axiosFactory");

class TestingApi {
  constructor(parentApi) {
    this.parentApi = parentApi;
  }

  async createTestRun(firmId, attributes, templateType) {
    const instance = AxiosFactory.createInstance("firm", firmId);
    let response;
    try {
      switch (templateType) {
        case "accountTemplate":
          response = await instance.post("account_templates/test", attributes);
          break;
        case "reconciliationText":
          response = await instance.post("reconciliations/test", attributes);
          break;
        default:
          consola.error(`Template type is missing or invalid`);
          process.exit();
      }
      return response.data;
    } catch (error) {
      return await this.parentApi._responseErrorHandler(error);
    }
  }

  async createPreviewRun(firmId, attributes, templateType) {
    const instance = AxiosFactory.createInstance("firm", firmId);
    let response;
    try {
      switch (templateType) {
        case "accountTemplate":
          response = await instance.post("account_templates/render", attributes);
          break;
        case "reconciliationText":
          response = await instance.post("reconciliations/render", attributes);
          break;
        default:
          consola.error(`Template type is missing or invalid`);
          process.exit();
      }
      return response.data;
    } catch (error) {
      return await this.parentApi._responseErrorHandler(error);
    }
  }

  async readTestRun(firmId, testId, templateType) {
    const instance = AxiosFactory.createInstance("firm", firmId);
    let response;
    try {
      switch (templateType) {
        case "accountTemplate":
          response = await instance.get(`account_templates/test_runs/${testId}`);
          break;
        case "reconciliationText":
          response = await instance.get(`reconciliations/test_runs/${testId}`);
          break;
        default:
          consola.error(`Template type is missing or invalid`);
          process.exit();
      }
      return response.data;
    } catch (error) {
      return await this.parentApi._responseErrorHandler(error);
    }
  }

  async verifyLiquid(firmId, attributes) {
    const instance = AxiosFactory.createInstance("firm", firmId);
    try {
      const config = { headers: { "Content-Type": "application/json" } };
      const response = await instance.post("reconciliations/verify_liquid", attributes, config);
      return response.data;
    } catch (error) {
      return await this.parentApi._responseErrorHandler(error);
    }
  }
}

module.exports = { TestingApi };