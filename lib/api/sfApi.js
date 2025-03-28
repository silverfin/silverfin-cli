const apiUtils = require("../utils/apiUtils");
const { consola } = require("consola");
const { AxiosFactory } = require("./axiosFactory");
const { SilverfinAuthorizer } = require("./silverfinAuthorizer");

apiUtils.checkRequiredEnvVariables();

async function authorizeFirm(firmId) {
  SilverfinAuthorizer.authorizeFirm(firmId);
}

async function refreshFirmTokens(firmId) {
  return SilverfinAuthorizer.refreshFirm(firmId);
}

async function refreshPartnerToken(partnerId) {
  return SilverfinAuthorizer.refreshPartner(partnerId);
}

async function createReconciliationText(type, envId, attributes) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.post(`reconciliations`, attributes);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function readReconciliationTexts(type, envId, page = 1) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.get(`reconciliations`, {
      params: { page: page, per_page: 200 },
    });
    apiUtils.responseSuccessHandler(response);
    return response.data;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function readReconciliationTextById(type, envId, id) {
  const instance = AxiosFactory.createInstance(type, envId);

  try {
    const response = await instance.get(`reconciliations/${id}`);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

/**
 * Find reconciliation by handle. We only look for templates that are not from Partners (because technically they don't belong to the current firm). If we find a template from Partners we will skip it and continue looking for the next one.
 * @param {String} type | Firm or Partner
 * @param {Number} envId | Firm ID or Partner ID
 * @param {String} handle
 * @param {Number} page
 * @returns {Object} Reconciliation Text object
 */
async function findReconciliationTextByHandle(type, envId, handle, page = 1) {
  const reconciliations = await readReconciliationTexts(type, envId, page);

  // No data. Not found
  if (reconciliations.length == 0) {
    return null;
  }
  let reconciliationTexts = reconciliations.filter((element) => element["handle"] === handle);

  if (reconciliationTexts.length != 0) {
    for (let reconciliationText of reconciliationTexts) {
      // Template from Partners. Skip it
      if (reconciliationText.hasOwnProperty("marketplace_template_id") && reconciliationText.marketplace_template_id != null) {
        continue;
      }
      // Only return reconciliations were liquid code is not hidden
      if (reconciliationText.hasOwnProperty("text")) {
        return reconciliationText;
      }
    }
  }
  return findReconciliationTextByHandle(type, envId, handle, page + 1);
}

async function updateReconciliationText(type, envId, reconciliationId, attributes) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.post(`reconciliations/${reconciliationId}`, attributes);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function readReconciliationTextDetails(type, envId, companyId, periodId, reconciliationId) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.get(`/companies/${companyId}/periods/${periodId}/reconciliations/${reconciliationId}`);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function getReconciliationCustom(type, envId, companyId, periodId, reconciliationId, page = 1) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.get(`/companies/${companyId}/periods/${periodId}/reconciliations/${reconciliationId}/custom`, { params: { page: page, per_page: 200 } });
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function getReconciliationResults(type, envId, companyId, periodId, reconciliationId) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.get(`/companies/${companyId}/periods/${periodId}/reconciliations/${reconciliationId}/results`);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function readSharedParts(type, envId, page = 1) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.get(`shared_parts`, {
      params: { page: page, per_page: 200 },
    });
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function readSharedPartById(type, envId, sharedPartId) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.get(`shared_parts/${sharedPartId}`);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function findSharedPartByName(type, envId, sharedPartName, page = 1) {
  const response = await readSharedParts(type, envId, page);
  const sharedParts = response.data;
  // No data
  if (sharedParts.length == 0) {
    return null;
  }
  const sharedPart = sharedParts.find((element) => element["name"] === sharedPartName);
  if (sharedPart) {
    return sharedPart;
  } else {
    return findSharedPartByName(type, envId, sharedPartName, page + 1);
  }
}

async function updateSharedPart(type, envId, sharedPartId, attributes) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.post(`shared_parts/${sharedPartId}`, attributes);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function createSharedPart(type, envId, attributes) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.post(`shared_parts`, attributes);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function addSharedPartToReconciliation(type, envId, sharedPartId, reconciliationId) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.post(`reconciliations/${reconciliationId}/shared_parts/${sharedPartId}`);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function removeSharedPartFromReconciliation(type, envId, sharedPartId, reconciliationId) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.delete(`reconciliations/${reconciliationId}/shared_parts/${sharedPartId}`);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function createExportFile(type, envId, attributes) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.post(`export_files`, attributes);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function updateExportFile(type, envId, exportFileId, attributes) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.post(`export_files/${exportFileId}`, attributes);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function readExportFiles(type, envId, page = 1) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.get(`export_files`, {
      params: { page: page, per_page: 200 },
    });
    apiUtils.responseSuccessHandler(response);
    return response.data;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function readExportFileById(type, envId, exportFileId) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.get(`export_files/${exportFileId}`);
    apiUtils.responseSuccessHandler(response);
    return response.data;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function findExportFileByName(type, envId, exportFileName, page = 1) {
  const exportFiles = await readExportFiles(type, envId, page);
  // No data
  if (exportFiles.length == 0) {
    return null;
  }
  const exportFile = exportFiles.find((element) => element["name_nl"] === exportFileName);
  if (exportFile) {
    return await readExportFileById(type, envId, exportFile.id);
  } else {
    return findExportFileByName(type, envId, exportFileName, page + 1);
  }
}

async function addSharedPartToExportFile(type, envId, sharedPartId, exportFileId) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.post(`export_files/${exportFileId}/shared_parts/${sharedPartId}`);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function removeSharedPartFromExportFile(type, envId, sharedPartId, exportFileId) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.delete(`export_files/${exportFileId}/shared_parts/${sharedPartId}`);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function createAccountTemplate(type, envId, attributes) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.post(`account_templates`, attributes);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function updateAccountTemplate(type, envId, accountTemplateId, attributes) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.post(`account_templates/${accountTemplateId}`, attributes);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function readAccountTemplates(type, envId, page = 1) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.get(`account_templates`, {
      params: { page: page, per_page: 200 },
    });
    apiUtils.responseSuccessHandler(response);
    return response.data;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function readAccountTemplateById(type, envId, accountTemplateId) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.get(`account_templates/${accountTemplateId}`);
    apiUtils.responseSuccessHandler(response);
    return response.data;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function findAccountTemplateByName(type, envId, accountTemplateName, page = 1) {
  const accountTemplates = await readAccountTemplates(type, envId, page);
  // No data
  if (accountTemplates.length == 0) {
    return null;
  }
  const accountTemplate = accountTemplates.find((element) => element["name_nl"] === accountTemplateName);
  if (accountTemplate) {
    return await readAccountTemplateById(type, envId, accountTemplate.id);
  } else {
    return findAccountTemplateByName(type, envId, accountTemplateName, page + 1);
  }
}

async function addSharedPartToAccountTemplate(type, envId, sharedPartId, accountTemplateId) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.post(`account_templates/${accountTemplateId}/shared_parts/${sharedPartId}`);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function removeSharedPartFromAccountTemplate(type, envId, sharedPartId, accountTemplateId) {
  const instance = AxiosFactory.createInstance(type, envId);
  try {
    const response = await instance.delete(`account_templates/${accountTemplateId}/shared_parts/${sharedPartId}`);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function createTestRun(firmId, attributes) {
  const instance = AxiosFactory.createInstance("firm", firmId);
  try {
    const response = await instance.post("reconciliations/test", attributes);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function createPreviewRun(firmId, attributes) {
  const instance = AxiosFactory.createInstance("firm", firmId);
  try {
    const response = await instance.post("reconciliations/render", attributes);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function readTestRun(firmId, testId) {
  const instance = AxiosFactory.createInstance("firm", firmId);
  try {
    const response = await instance.get(`reconciliations/test_runs/${testId}`);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function getPeriods(firmId, companyId, page = 1) {
  const instance = AxiosFactory.createInstance("firm", firmId);
  try {
    const response = await instance.get(`/companies/${companyId}/periods`, {
      params: { page: page, per_page: 200 },
    });
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

function findPeriod(periodId, periodsArray) {
  return periodsArray.find((period) => period.id == periodId);
}

async function getCompanyDrop(firmId, companyId) {
  const instance = AxiosFactory.createInstance("firm", firmId);
  try {
    const response = await instance.get(`/companies/${companyId}`);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function getCompanyCustom(firmId, companyId) {
  const instance = AxiosFactory.createInstance("firm", firmId);
  try {
    const response = await instance.get(`/companies/${companyId}/custom`);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function getWorkflows(firmId, companyId, periodId) {
  const instance = AxiosFactory.createInstance("firm", firmId);
  try {
    const response = await instance.get(`/companies/${companyId}/periods/${periodId}/workflows`);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function getWorkflowInformation(firmId, companyId, periodId, workflowId, page = 1) {
  const instance = AxiosFactory.createInstance("firm", firmId);
  try {
    const response = await instance.get(`/companies/${companyId}/periods/${periodId}/workflows/${workflowId}/reconciliations`, { params: { page: page, per_page: 200 } });
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function findReconciliationInWorkflow(firmId, reconciliationHandle, companyId, periodId, workflowId, page = 1) {
  const response = await getWorkflowInformation(firmId, companyId, periodId, workflowId, page);
  const workflowArray = response.data;
  // No data
  if (workflowArray.length == 0) {
    consola.log(`Reconciliation ${reconciliationHandle} not found in workflow id ${workflowId}`);
    return;
  }
  const reconciliationText = workflowArray.find((reconciliation) => reconciliation.handle == reconciliationHandle);
  if (reconciliationText) {
    return reconciliationText;
  } else {
    return findReconciliationInWorkflow(firmId, reconciliationHandle, companyId, periodId, workflowId, page + 1);
  }
}

async function findReconciliationInWorkflows(firmId, reconciliationHandle, companyId, periodId) {
  // Get data from all workflows
  const responseWorkflows = await getWorkflows(firmId, companyId, periodId);
  // Check in each workflow
  for (workflow of responseWorkflows.data) {
    let reconciliationInformation = await findReconciliationInWorkflow(firmId, reconciliationHandle, companyId, periodId, workflow.id);
    // Found
    if (reconciliationInformation) {
      return reconciliationInformation;
    }
  }
  // Not found
  consola.warn(`Reconciliation "${reconciliationHandle}" not found in any workflow`);
}

async function getAccountDetails(firmId, companyId, periodId, accountId) {
  const instance = AxiosFactory.createInstance("firm", firmId);
  try {
    const response = await instance.get(`companies/${companyId}/periods/${periodId}/accounts/${accountId}`);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

// Liquid Linter
// attributes should be JSON
async function verifyLiquid(firmId, attributes) {
  const instance = AxiosFactory.createInstance("firm", firmId);
  try {
    const config = { headers: { "Content-Type": "application/json" } };
    const response = await instance.post("reconciliations/verify_liquid", attributes, config);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function getFirmDetails(firmId) {
  const instance = AxiosFactory.createInstance("firm", firmId);
  try {
    const response = await instance.get(`/user/firm`);
    apiUtils.responseSuccessHandler(response);
    return response.data;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

module.exports = {
  authorizeFirm,
  refreshFirmTokens,
  refreshPartnerToken,
  createReconciliationText,
  readReconciliationTexts,
  readReconciliationTextById,
  updateReconciliationText,
  findReconciliationTextByHandle,
  readReconciliationTextDetails,
  getReconciliationCustom,
  getReconciliationResults,
  readSharedParts,
  readSharedPartById,
  findSharedPartByName,
  updateSharedPart,
  createSharedPart,
  addSharedPartToReconciliation,
  removeSharedPartFromReconciliation,
  createExportFile,
  updateExportFile,
  readExportFiles,
  readExportFileById,
  findExportFileByName,
  addSharedPartToExportFile,
  removeSharedPartFromExportFile,
  createAccountTemplate,
  updateAccountTemplate,
  readAccountTemplates,
  readAccountTemplateById,
  findAccountTemplateByName,
  addSharedPartToAccountTemplate,
  removeSharedPartFromAccountTemplate,
  readTestRun,
  createTestRun,
  createPreviewRun,
  getPeriods,
  findPeriod,
  getCompanyDrop,
  getCompanyCustom,
  getWorkflows,
  getWorkflowInformation,
  findReconciliationInWorkflow,
  findReconciliationInWorkflows,
  getAccountDetails,
  verifyLiquid,
  getFirmDetails,
};
