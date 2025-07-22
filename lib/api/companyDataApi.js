const { consola } = require("consola");

class CompanyDataApi {
  constructor(parentApi) {
    this.parentApi = parentApi;
  }

  async getPeriods(firmId, companyId, page = 1) {
    const response = await this.parentApi._makeRequest("get", "firm", firmId, `/companies/${companyId}/periods`, null, { page, per_page: 200 });
    return response.data;
  }

  findPeriod(periodId, periodsArray) {
    return periodsArray.find((period) => period.id == periodId);
  }

  async getCompanyDrop(firmId, companyId) {
    const response = await this.parentApi._makeRequest("get", "firm", firmId, `/companies/${companyId}`);
    return response.data;
  }

  async getCompanyCustom(firmId, companyId) {
    const response = await this.parentApi._makeRequest("get", "firm", firmId, `/companies/${companyId}/custom`);
    return response.data;
  }

  async getWorkflows(firmId, companyId, periodId) {
    const response = await this.parentApi._makeRequest("get", "firm", firmId, `/companies/${companyId}/periods/${periodId}/workflows`);
    return response.data;
  }

  async getWorkflowInformation(firmId, companyId, periodId, workflowId, page = 1) {
    const response = await this.parentApi._makeRequest("get", "firm", firmId, `/companies/${companyId}/periods/${periodId}/workflows/${workflowId}/reconciliations`, null, {
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
    const response = await this.parentApi._makeRequest("get", "firm", firmId, `companies/${companyId}/periods/${periodId}/accounts/${accountId}`);
    return response.data;
  }

  async getFirmDetails(firmId) {
    const response = await this.parentApi._makeRequest("get", "firm", firmId, "/user/firm");
    return response.data;
  }
}

module.exports = { CompanyDataApi };