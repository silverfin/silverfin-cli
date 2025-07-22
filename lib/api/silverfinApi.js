const { consola } = require("consola");
const { AxiosFactory } = require("./axiosFactory");
const { SilverfinAuthorizer } = require("./silverfinAuthorizer");
const { firmCredentials } = require("./firmCredentials");

class SilverfinApi {
  constructor() {
    this.#checkRequiredEnvVariables();
  }

  async authorizeFirm(firmId) {
    SilverfinAuthorizer.authorizeFirm(firmId);
  }

  async refreshFirmTokens(firmId) {
    return SilverfinAuthorizer.refreshFirm(firmId);
  }

  async refreshPartnerToken(partnerId) {
    return SilverfinAuthorizer.refreshPartner(partnerId);
  }

  async createReconciliationText(type, envId, attributes) {
    const response = await this.#makeRequest("post", type, envId, "reconciliations", attributes);
    return response.data;
  }

  async readReconciliationTexts(type, envId, page = 1) {
    const response = await this.#makeRequest("get", type, envId, "reconciliations", null, { page, per_page: 200 });
    return response.data;
  }

  async readReconciliationTextById(type, envId, id) {
    const response = await this.#makeRequest("get", type, envId, `reconciliations/${id}`);
    return response.data;
  }

  async findReconciliationTextByHandle(type, envId, handle, page = 1) {
    const reconciliations = await this.readReconciliationTexts(type, envId, page);

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
    return this.findReconciliationTextByHandle(type, envId, handle, page + 1);
  }

  async updateReconciliationText(type, envId, reconciliationId, attributes) {
    const response = await this.#makeRequest("post", type, envId, `reconciliations/${reconciliationId}`, attributes);
    return response.data;
  }

  async readReconciliationTextDetails(type, envId, companyId, periodId, reconciliationId) {
    const response = await this.#makeRequest("get", type, envId, `/companies/${companyId}/periods/${periodId}/reconciliations/${reconciliationId}`);
    return response.data;
  }

  async getReconciliationCustom(type, envId, companyId, periodId, reconciliationId, page = 1) {
    const response = await this.#makeRequest("get", type, envId, `/companies/${companyId}/periods/${periodId}/reconciliations/${reconciliationId}/custom`, null, {
      page,
      per_page: 200,
    });
    return response.data;
  }

  async getReconciliationResults(type, envId, companyId, periodId, reconciliationId) {
    const response = await this.#makeRequest("get", type, envId, `/companies/${companyId}/periods/${periodId}/reconciliations/${reconciliationId}/results`);
    return response.data;
  }

  async readSharedParts(type, envId, page = 1) {
    const response = await this.#makeRequest("get", type, envId, "shared_parts", null, { page, per_page: 200 });
    return response.data;
  }

  async readSharedPartById(type, envId, sharedPartId) {
    const response = await this.#makeRequest("get", type, envId, `shared_parts/${sharedPartId}`);
    return response.data;
  }

  async findSharedPartByName(type, envId, sharedPartName, page = 1) {
    const sharedParts = await this.readSharedParts(type, envId, page);

    if (!sharedParts || sharedParts.length === 0) {
      return null;
    }

    const sharedPart = sharedParts.find((element) => element.name === sharedPartName);
    if (sharedPart) {
      return sharedPart;
    }

    return this.findSharedPartByName(type, envId, sharedPartName, page + 1);
  }

  async updateSharedPart(type, envId, sharedPartId, attributes) {
    const response = await this.#makeRequest("post", type, envId, `shared_parts/${sharedPartId}`, attributes);
    return response.data;
  }

  async createSharedPart(type, envId, attributes) {
    const response = await this.#makeRequest("post", type, envId, "shared_parts", attributes);
    return response.data;
  }

  async addSharedPartToReconciliation(type, envId, sharedPartId, reconciliationId) {
    const response = await this.#makeRequest("post", type, envId, `reconciliations/${reconciliationId}/shared_parts/${sharedPartId}`);
    return response.data;
  }

  async removeSharedPartFromReconciliation(type, envId, sharedPartId, reconciliationId) {
    const response = await this.#makeRequest("delete", type, envId, `reconciliations/${reconciliationId}/shared_parts/${sharedPartId}`);
    return response.data;
  }

  async createExportFile(type, envId, attributes) {
    const response = await this.#makeRequest("post", type, envId, "export_files", attributes);
    return response.data;
  }

  async updateExportFile(type, envId, exportFileId, attributes) {
    const response = await this.#makeRequest("post", type, envId, `export_files/${exportFileId}`, attributes);
    return response.data;
  }

  async readExportFiles(type, envId, page = 1) {
    const response = await this.#makeRequest("get", type, envId, "export_files", null, { page, per_page: 200 });
    return response.data;
  }

  async readExportFileById(type, envId, exportFileId) {
    const response = await this.#makeRequest("get", type, envId, `export_files/${exportFileId}`);
    return response.data;
  }

  async findExportFileByName(type, envId, exportFileName, page = 1) {
    const exportFiles = await this.readExportFiles(type, envId, page);

    if (exportFiles.length === 0) {
      return null;
    }

    const exportFile = exportFiles.find((element) => element.name_nl === exportFileName);
    if (exportFile) {
      return await this.readExportFileById(type, envId, exportFile.id);
    }

    return this.findExportFileByName(type, envId, exportFileName, page + 1);
  }

  async addSharedPartToExportFile(type, envId, sharedPartId, exportFileId) {
    const response = await this.#makeRequest("post", type, envId, `export_files/${exportFileId}/shared_parts/${sharedPartId}`);
    return response.data;
  }

  async removeSharedPartFromExportFile(type, envId, sharedPartId, exportFileId) {
    const response = await this.#makeRequest("delete", type, envId, `export_files/${exportFileId}/shared_parts/${sharedPartId}`);
    return response.data;
  }

  async createAccountTemplate(type, envId, attributes) {
    const response = await this.#makeRequest("post", type, envId, "account_templates", attributes);
    return response.data;
  }

  async updateAccountTemplate(type, envId, accountTemplateId, attributes) {
    const response = await this.#makeRequest("post", type, envId, `account_templates/${accountTemplateId}`, attributes);
    return response.data;
  }

  async readAccountTemplates(type, envId, page = 1) {
    const response = await this.#makeRequest("get", type, envId, "account_templates", null, { page, per_page: 200 });
    return response.data;
  }

  async readAccountTemplateById(type, envId, accountTemplateId) {
    const response = await this.#makeRequest("get", type, envId, `account_templates/${accountTemplateId}`);
    return response.data;
  }

  async findAccountTemplateByName(type, envId, accountTemplateName, page = 1) {
    const accountTemplates = await this.readAccountTemplates(type, envId, page);

    if (accountTemplates.length === 0) {
      return null;
    }

    const accountTemplate = accountTemplates.find((element) => element.name_nl === accountTemplateName);
    if (accountTemplate) {
      return await this.readAccountTemplateById(type, envId, accountTemplate.id);
    }

    return this.findAccountTemplateByName(type, envId, accountTemplateName, page + 1);
  }

  async addSharedPartToAccountTemplate(type, envId, sharedPartId, accountTemplateId) {
    const response = await this.#makeRequest("post", type, envId, `account_templates/${accountTemplateId}/shared_parts/${sharedPartId}`);
    return response.data;
  }

  async removeSharedPartFromAccountTemplate(type, envId, sharedPartId, accountTemplateId) {
    const response = await this.#makeRequest("delete", type, envId, `account_templates/${accountTemplateId}/shared_parts/${sharedPartId}`);
    return response.data;
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
      return await this.#responseErrorHandler(error);
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
      return await this.#responseErrorHandler(error);
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
      return await this.#responseErrorHandler(error);
    }
  }

  async getPeriods(firmId, companyId, page = 1) {
    const response = await this.#makeRequest("get", "firm", firmId, `/companies/${companyId}/periods`, null, { page, per_page: 200 });
    return response.data;
  }

  findPeriod(periodId, periodsArray) {
    return periodsArray.find((period) => period.id == periodId);
  }

  async getCompanyDrop(firmId, companyId) {
    const response = await this.#makeRequest("get", "firm", firmId, `/companies/${companyId}`);
    return response.data;
  }

  async getCompanyCustom(firmId, companyId) {
    const response = await this.#makeRequest("get", "firm", firmId, `/companies/${companyId}/custom`);
    return response.data;
  }

  async getWorkflows(firmId, companyId, periodId) {
    const response = await this.#makeRequest("get", "firm", firmId, `/companies/${companyId}/periods/${periodId}/workflows`);
    return response.data;
  }

  async getWorkflowInformation(firmId, companyId, periodId, workflowId, page = 1) {
    const response = await this.#makeRequest("get", "firm", firmId, `/companies/${companyId}/periods/${periodId}/workflows/${workflowId}/reconciliations`, null, {
      page,
      per_page: 200,
    });
    return response.data;
  }

  async findReconciliationInWorkflow(firmId, reconciliationHandle, companyId, periodId, workflowId, page = 1) {
    const workflowArray = await this.getWorkflowInformation(firmId, companyId, periodId, workflowId, page);

    if (workflowArray.length === 0) {
      consola.log(`Reconciliation ${reconciliationHandle} not found in workflow id ${workflowId}`);
      return;
    }

    const reconciliationText = workflowArray.find((reconciliation) => reconciliation.handle === reconciliationHandle);
    if (reconciliationText) {
      return reconciliationText;
    }

    return this.findReconciliationInWorkflow(firmId, reconciliationHandle, companyId, periodId, workflowId, page + 1);
  }

  async findReconciliationInWorkflows(firmId, reconciliationHandle, companyId, periodId) {
    const workflows = await this.getWorkflows(firmId, companyId, periodId);

    if (!workflows || !Array.isArray(workflows)) {
      consola.warn(`No workflows found`);
      return;
    }

    for (const workflow of workflows) {
      const reconciliationInformation = await this.findReconciliationInWorkflow(firmId, reconciliationHandle, companyId, periodId, workflow.id);
      if (reconciliationInformation) {
        return reconciliationInformation;
      }
    }

    consola.warn(`Reconciliation "${reconciliationHandle}" not found in any workflow`);
  }

  async getAccountDetails(firmId, companyId, periodId, accountId) {
    const response = await this.#makeRequest("get", "firm", firmId, `companies/${companyId}/periods/${periodId}/accounts/${accountId}`);
    return response.data;
  }

  async verifyLiquid(firmId, attributes) {
    const instance = AxiosFactory.createInstance("firm", firmId);
    try {
      const config = { headers: { "Content-Type": "application/json" } };
      const response = await instance.post("reconciliations/verify_liquid", attributes, config);
      return response.data;
    } catch (error) {
      return await this.#responseErrorHandler(error);
    }
  }

  async getFirmDetails(firmId) {
    const response = await this.#makeRequest("get", "firm", firmId, "/user/firm");
    return response.data;
  }

  #checkRequiredEnvVariables() {
    const missingVariables = ["SF_API_CLIENT_ID", "SF_API_SECRET"].filter((key) => !process.env[key]);
    if (missingVariables.length) {
      consola.error(`Error: Missing API credentials: [${missingVariables}]`);
      consola.log(`Credentials should be defined as environmental variables.`);
      consola.log(`Call export ${missingVariables[0]}=...`);
      consola.log(`If you don't have credentials yet, you need to register your app with Silverfin to get them`);
      process.exit(1);
    }
  }

  #responseSuccessHandler(response) {
    if (response?.status) {
      consola.debug(
        `Response Status: ${response.status} (${response?.statusText}) - method: ${response?.config?.method || response?.method} - url: ${response?.config?.url || response?.url}`
      );
    }
  }

  async #responseErrorHandler(error) {
    if (error && error.response) {
      consola.debug(`Response Status: ${error.response.status} (${error.response.statusText}) - method: ${error.response.config.method} - url: ${error.response.config.url}`);
    }
    if (error?.response) {
      // Valid Request. Not Found
      if (error.response.status === 404) {
        consola.error(`Response Error (404): ${JSON.stringify(error.response.data.error)}`);
        return;
      }
      // Bad Request
      if (error.response.status === 400) {
        consola.error(`Response Error (400): ${JSON.stringify(error.response.data.error)}`);
        return;
      }
      // Unprocessable Entity
      if (error.response.status === 422) {
        consola.error(`Response Error (422): ${JSON.stringify(error.response.data)}`, "\n", `You don't have the rights to update the previous parameters`);
        process.exit(1);
      }
      if (error.response.status === 401) {
        consola.debug(`Response Error (401): ${JSON.stringify(error.response.data)}`);
      }
      // Forbidden
      if (error.response.status === 403) {
        consola.error("Error (403): Forbidden access. Terminating process");
        process.exit(1);
      }
    }
    // Not handled
    throw error;
  }

  async #makeRequest(method, type, envId, endpoint, data = null, params = null, config = null) {
    const instance = AxiosFactory.createInstance(type, envId);
    try {
      const requestConfig = { ...config };
      if (params) requestConfig.params = params;

      let response;
      switch (method.toLowerCase()) {
        case "get":
          response = await instance.get(endpoint, requestConfig);
          break;
        case "post":
          response = await instance.post(endpoint, data, requestConfig);
          break;
        case "delete":
          response = await instance.delete(endpoint, requestConfig);
          break;
        default: {
          const error = new Error(`Unsupported HTTP method: ${method}`);
          return await this.#responseErrorHandler(error);
        }
      }

      this.#responseSuccessHandler(response);
      return response;
    } catch (error) {
      return await this.#responseErrorHandler(error);
    }
  }
}

module.exports = { SilverfinApi };

