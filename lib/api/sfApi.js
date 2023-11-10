const axios = require("axios");
const open = require("open");
const prompt = require("prompt-sync")({ sigint: true });
const apiUtils = require("../utils/apiUtils");
const { consola } = require("consola");
const { firmCredentials } = require("../api/firmCredentials");

apiUtils.checkRequiredEnvVariables();

async function authorizeApp(firmId = undefined) {
  try {
    consola.info(
      `NOTE: if you need to exit this process you can press "Ctrl/Cmmd + C"`
    );
    const redirectUri = "urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob";
    const scope =
      "administration%3Aread%20administration%3Awrite%20financials%3Aread%20financials%3Awrite%20workflows%3Aread";

    let firmIdPrompt;
    if (firmId) {
      firmIdPrompt = prompt(
        `Enter the firm ID (leave blank to use ${firmId}): `,
        { value: firmId }
      );
    } else {
      firmIdPrompt = prompt("Enter the firm ID: ");
    }
    const url = `${apiUtils.BASE_URL}/f/${firmIdPrompt}/oauth/authorize?client_id=${process.env.SF_API_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;

    await open(url);
    consola.info(`You need to authorize your APP in the browser`);
    consola.log("Insert your credentials...");
    const authCodePrompt = prompt("Enter your API authorization code: ", {
      echo: "*",
    });
    // Get tokens
    const tokens = await apiUtils.getAccessToken(firmIdPrompt, authCodePrompt);
    if (tokens) {
      consola.success("Authentication successful");
    }
    // Get firm name
    await apiUtils.getFirmName(firmIdPrompt);
  } catch (error) {
    consola.error(error);
    process.exit(1);
  }
}

async function refreshTokens(type, firmId) {
  const instance = apiUtils.setAxiosDefaults(type, firmId);
  await apiUtils.refreshTokens(instance, firmId);

  return true;
}

async function refreshPartnerToken(partnerId) {
  try {
    const partnerCredentials = apiUtils.checkAuthorizePartners(partnerId);

    if (partnerCredentials) {
      const response = await axios.post(
        `${apiUtils.BASE_URL}/api/partner/v1/refresh_api_key?api_key=${partnerCredentials.token}`
      );

      firmCredentials.storePartnerApiKey(
        partnerId,
        response.data.api_key,
        partnerCredentials?.name
      );

      return {
        partnerId,
        partnerName: partnerCredentials?.name,
        token: response.data.api_key,
      };
    }
  } catch (error) {
    consola.error(
      `Response Status: ${error.response.status} (${error.response.statusText})`
    );
    consola.error("An error occurred trying to refresh the partner API key");
    consola.error(error);
    process.exit(1);
  }
}

async function createReconciliationText(type, envId, attributes) {
  const instance = apiUtils.setAxiosDefaults(type, envId);
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
  const instance = apiUtils.setAxiosDefaults(type, envId);
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
  const instance = apiUtils.setAxiosDefaults(type, envId);

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
 * Find reconciliation by handle. We only look for templates that are not from Partners (because tecnically they don't belong to the current firm). If we find a template from Partners we will skip it and continue looking for the next one.
 * @param {Number} firmId
 * @param {String} handle
 * @param {Number} page
 * @returns {Object} Reconciliation Text object
 */
async function findReconciliationTextByHandle(type, envId, handle, page = 1) {
  const reconciliations = await readReconciliationTexts(type, envId, page);

  // No data. Not found
  if (reconciliations.length == 0) {
    //consola.warn(`Reconciliation "${handle}" not found`);
    return null;
  }
  let reconciliationTexts = reconciliations.filter(
    (element) => element["handle"] === handle
  );
  if (reconciliationTexts.length != 0) {
    for (let reconciliationText of reconciliationTexts) {
      // Template from Partners. Skip it
      if (
        reconciliationText.hasOwnProperty("marketplace_template_id") &&
        reconciliationText.marketplace_template_id != null
      ) {
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

async function updateReconciliationText(
  type,
  envId,
  reconciliationId,
  attributes
) {
  const instance = apiUtils.setAxiosDefaults(type, envId);
  try {
    const response = await instance.post(
      `reconciliations/${reconciliationId}`,
      attributes
    );
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function readReconciliationTextDetails(
  type,
  envId,
  companyId,
  periodId,
  reconciliationId
) {
  const instance = apiUtils.setAxiosDefaults(type, envId);
  try {
    const response = await instance.get(
      `/companies/${companyId}/periods/${periodId}/reconciliations/${reconciliationId}`
    );
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      envId,
      companyId,
      periodId,
      reconciliationId,
    };
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function getReconciliationCustom(
  type,
  envId,
  companyId,
  periodId,
  reconciliationId,
  page = 1
) {
  const instance = apiUtils.setAxiosDefaults(type, envId);
  try {
    const response = await instance.get(
      `/companies/${companyId}/periods/${periodId}/reconciliations/${reconciliationId}/custom`,
      { params: { page: page, per_page: 200 } }
    );
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function getReconciliationResults(
  type,
  envId,
  companyId,
  periodId,
  reconciliationId
) {
  const instance = apiUtils.setAxiosDefaults(type, envId);
  try {
    const response = await instance.get(
      `/companies/${companyId}/periods/${periodId}/reconciliations/${reconciliationId}/results`
    );
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const response = await apiUtils.responseErrorHandler(error);
    return response;
  }
}

async function readSharedParts(firmId, page = 1, refreshToken = true) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`shared_parts`, {
      params: { page: page, per_page: 200 },
    });
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId,
      page,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      readSharedParts,
      callbackParameters
    );
    return response;
  }
}

async function readSharedPartById(firmId, sharedPartId, refreshToken = true) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`shared_parts/${sharedPartId}`);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId,
      sharedPartId,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      readSharedPartById,
      callbackParameters
    );
    return response;
  }
}

async function findSharedPartByName(firmId, sharedPartName, page = 1) {
  const response = await readSharedParts(firmId, page);
  const sharedParts = response.data;
  // No data
  if (sharedParts.length == 0) {
    //consola.warn(`Shared part "${sharedPartName}" not found`);
    return null;
  }
  const sharedPart = sharedParts.find(
    (element) => element["name"] === sharedPartName
  );
  if (sharedPart) {
    return sharedPart;
  } else {
    return findSharedPartByName(firmId, sharedPartName, page + 1);
  }
}

async function updateSharedPart(
  firmId,
  sharedPartId,
  attributes,
  refreshToken = true
) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.post(
      `shared_parts/${sharedPartId}`,
      attributes
    );
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId,
      sharedPartId,
      attributes,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      updateSharedPart,
      callbackParameters
    );
    return response;
  }
}

async function createSharedPart(firmId, attributes, refreshToken = true) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.post(`shared_parts`, attributes);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      attributes,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      createSharedPart,
      callbackParameters
    );
    return response;
  }
}

async function addSharedPartToReconciliation(
  firmId,
  sharedPartId,
  reconciliationId,
  refreshToken = true
) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.post(
      `reconciliations/${reconciliationId}/shared_parts/${sharedPartId}`
    );
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId,
      sharedPartId,
      reconciliationId,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      addSharedPartToReconciliation,
      callbackParameters
    );
    return response;
  }
}

async function removeSharedPartFromReconciliation(
  firmId,
  sharedPartId,
  reconciliationId,
  refreshToken = true
) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.delete(
      `reconciliations/${reconciliationId}/shared_parts/${sharedPartId}`
    );
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId,
      sharedPartId,
      reconciliationId,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      removeSharedPartFromReconciliation,
      callbackParameters
    );
    return response;
  }
}

async function createExportFile(firmId, attributes, refreshToken = true) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.post(`export_files`, attributes);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      attributes: attributes,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      error,
      refreshToken,
      createExportFile,
      callbackParameters
    );
    return response;
  }
}

async function updateExportFile(
  firmId,
  exportFileId,
  attributes,
  refreshToken = true
) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.post(
      `export_files/${exportFileId}`,
      attributes
    );
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      exportFileId: exportFileId,
      attributes: attributes,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      updateExportFile,
      callbackParameters
    );
    return response;
  }
}

async function readExportFiles(firmId, page = 1, refreshToken = true) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`export_files`, {
      params: { page: page, per_page: 200 },
    });
    apiUtils.responseSuccessHandler(response);
    return response.data;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      page: page,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      readExportFiles,
      callbackParameters
    );
    return response;
  }
}

async function readExportFileById(firmId, exportFileId, refreshToken = true) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`export_files/${exportFileId}`);
    apiUtils.responseSuccessHandler(response);
    return response.data;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      exportFileId: exportFileId,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      readExportFileById,
      callbackParameters
    );
    return response;
  }
}

async function findExportFileByName(firmId, exportFileName, page = 1) {
  const exportFiles = await readExportFiles(firmId, page);
  // No data
  if (exportFiles.length == 0) {
    //consola.warn(`Export file "${exportFileName}" not found`);
    return null;
  }
  const exportFile = exportFiles.find(
    (element) => element["name"] === exportFileName
  );
  if (exportFile) {
    return await readExportFileById(firmId, exportFile.id);
  } else {
    return findExportFileByName(firmId, exportFileName, page + 1);
  }
}

async function addSharedPartToExportFile(
  firmId,
  sharedPartId,
  exportFileId,
  refreshToken = true
) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.post(
      `export_files/${exportFileId}/shared_parts/${sharedPartId}`
    );
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      sharedPartId: sharedPartId,
      exportFileId: exportFileId,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      addSharedPartToExportFile,
      callbackParameters
    );
    return response;
  }
}

async function removeSharedPartFromExportFile(
  firmId,
  sharedPartId,
  exportFileId,
  refreshToken = true
) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.delete(
      `export_files/${exportFileId}/shared_parts/${sharedPartId}`
    );
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      sharedPartId: sharedPartId,
      exportFileId: exportFileId,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      removeSharedPartFromExportFile,
      callbackParameters
    );
    return response;
  }
}

async function createAccountTemplate(firmId, attributes, refreshToken = true) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.post(`account_templates`, attributes);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      attributes: attributes,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      error,
      refreshToken,
      createAccountTemplate,
      callbackParameters
    );
    return response;
  }
}

async function updateAccountTemplate(
  firmId,
  accountTemplateId,
  attributes,
  refreshToken = true
) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.post(
      `account_templates/${accountTemplateId}`,
      attributes
    );
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      accountTemplateId: accountTemplateId,
      attributes: attributes,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      updateAccountTemplate,
      callbackParameters
    );
    return response;
  }
}

async function readAccountTemplates(firmId, page = 1, refreshToken = true) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`account_templates`, {
      params: { page: page, per_page: 200 },
    });
    apiUtils.responseSuccessHandler(response);
    return response.data;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      page: page,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      readAccountTemplates,
      callbackParameters
    );
    return response;
  }
}

async function readAccountTemplateById(
  firmId,
  accountTemplateId,
  refreshToken = true
) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`account_templates/${accountTemplateId}`);
    apiUtils.responseSuccessHandler(response);
    return response.data;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      accountTemplateId: accountTemplateId,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      readAccountTemplateById,
      callbackParameters
    );
    return response;
  }
}

async function findAccountTemplateByName(
  firmId,
  accountTemplateName,
  page = 1
) {
  const accountTemplates = await readAccountTemplates(firmId, page);
  // No data
  if (accountTemplates.length == 0) {
    //console.log(`Account Template "${accountTemplateName}" not found`);
    return null;
  }
  const accountTemplate = accountTemplates.find(
    (element) => element["name_nl"] === accountTemplateName
  );
  if (accountTemplate) {
    return await readAccountTemplateById(firmId, accountTemplate.id);
  } else {
    return findAccountTemplateByName(firmId, accountTemplateName, page + 1);
  }
}

async function addSharedPartToAccountTemplate(
  firmId,
  sharedPartId,
  accountTemplateId,
  refreshToken = true
) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.post(
      `account_templates/${accountTemplateId}/shared_parts/${sharedPartId}`
    );
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      sharedPartId: sharedPartId,
      accountTemplateId: accountTemplateId,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      addSharedPartToAccountTemplate,
      callbackParameters
    );
    return response;
  }
}

async function removeSharedPartFromAccountTemplate(
  firmId,
  sharedPartId,
  accountTemplateId,
  refreshToken = true
) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.delete(
      `account_templates/${accountTemplateId}/shared_parts/${sharedPartId}`
    );
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      sharedPartId: sharedPartId,
      accountTemplateId: accountTemplateId,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      removeSharedPartFromAccountTemplate,
      callbackParameters
    );
    return response;
  }
}

async function createTestRun(firmId, attributes, refreshToken = true) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.post("reconciliations/test", attributes);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId,
      attributes,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      createTestRun,
      callbackParameters
    );
    return response;
  }
}

async function createPreviewRun(firmId, attributes, refreshToken = true) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.post("reconciliations/render", attributes);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId,
      attributes,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      createPreviewRun,
      callbackParameters
    );
    return response;
  }
}

async function readTestRun(firmId, testId, refreshToken = true) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`reconciliations/test_runs/${testId}`);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId,
      testId,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      readTestRun,
      callbackParameters
    );
    return response;
  }
}

async function getPeriods(firmId, companyId, page = 1, refreshToken = true) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`/companies/${companyId}/periods`, {
      params: { page: page, per_page: 200 },
    });
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId,
      companyId,
      page,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      getPeriods,
      callbackParameters
    );
    return response;
  }
}

function findPeriod(periodId, periodsArray) {
  return periodsArray.find((period) => period.id == periodId);
}

async function getCompanyDrop(firmId, companyId, refreshToken = true) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`/companies/${companyId}`);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId,
      companyId,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      getCompanyDrop,
      callbackParameters
    );
    return response;
  }
}

async function getCompanyCustom(firmId, companyId, refreshToken = true) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`/companies/${companyId}/custom`);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId,
      companyId,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      getCompanyCustom,
      callbackParameters
    );
    return response;
  }
}

async function getWorkflows(firmId, companyId, periodId, refreshToken = true) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.get(
      `/companies/${companyId}/periods/${periodId}/workflows`
    );
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId,
      companyId,
      periodId,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      getWorkflows,
      callbackParameters
    );
    return response;
  }
}

async function getWorkflowInformation(
  firmId,
  companyId,
  periodId,
  workflowId,
  page = 1,
  refreshToken = true
) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.get(
      `/companies/${companyId}/periods/${periodId}/workflows/${workflowId}/reconciliations`,
      { params: { page: page, per_page: 200 } }
    );
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId,
      companyId,
      periodId,
      workflowId,
      page,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      getWorkflowInformation,
      callbackParameters
    );
    return response;
  }
}

async function findReconciliationInWorkflow(
  firmId,
  reconciliationHandle,
  companyId,
  periodId,
  workflowId,
  page = 1
) {
  const response = await getWorkflowInformation(
    firmId,
    companyId,
    periodId,
    workflowId,
    page
  );
  const workflowArray = response.data;
  // No data
  if (workflowArray.length == 0) {
    consola.log(
      `Reconciliation ${reconciliationHandle} not found in workflow id ${workflowId}`
    );
    return;
  }
  const reconciliationText = workflowArray.find(
    (reconciliation) => reconciliation.handle == reconciliationHandle
  );
  if (reconciliationText) {
    return reconciliationText;
  } else {
    return findReconciliationInWorkflow(
      firmId,
      reconciliationHandle,
      companyId,
      periodId,
      workflowId,
      page + 1
    );
  }
}

async function findReconciliationInWorkflows(
  firmId,
  reconciliationHandle,
  companyId,
  periodId
) {
  // Get data from all workflows
  const responseWorkflows = await getWorkflows(firmId, companyId, periodId);
  // Check in each workflow
  for (workflow of responseWorkflows.data) {
    let reconciliationInformation = await findReconciliationInWorkflow(
      firmId,
      reconciliationHandle,
      companyId,
      periodId,
      workflow.id
    );
    // Found
    if (reconciliationInformation) {
      return reconciliationInformation;
    }
  }
  // Not found
  consola.warn(
    `Reconciliation "${reconciliationHandle}" not found in any workflow`
  );
}

async function getAccountDetails(
  firmId,
  companyId,
  periodId,
  accountId,
  refreshToken = true
) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.get(
      `companies/${companyId}/periods/${periodId}/accounts/${accountId}`
    );
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId,
      companyId,
      periodId,
      accountId,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      getAccountDetails,
      callbackParameters
    );
    return response;
  }
}

// Liquid Linter
// attributes should be JSON
async function verifyLiquid(firmId, attributes, refreshToken = true) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const config = { headers: { "Content-Type": "application/json" } };
    const response = await axios.post(
      "reconciliations/verify_liquid",
      attributes,
      config
    );
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId,
      attributes,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      verifyLiquid,
      callbackParameters
    );
    return response;
  }
}

async function getFirmDetails(firmId, refreshToken = true) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`/user/firm`);
    apiUtils.responseSuccessHandler(response);
    return response.data;
  } catch (error) {
    const callbackParameters = {
      firmId,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      getFirmDetails,
      callbackParameters
    );
    return response;
  }
}

module.exports = {
  authorizeApp,
  refreshTokens,
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
