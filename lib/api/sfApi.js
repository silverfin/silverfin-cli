const axios = require("axios");
const open = require("open");
const prompt = require("prompt-sync")({ sigint: true });
const apiUtils = require("../utils/apiUtils");

apiUtils.checkRequiredEnvVariables();

async function authorizeApp(firmId = undefined) {
  try {
    console.log(
      `Note: if you need to exit this process you can press "Ctrl/Cmmd + C"`
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
    console.log(`You need to authorize your APP in the browser`);
    console.log("Insert your credentials...");
    const authCodePrompt = prompt("Enter your API authorization code: ", {
      echo: "*",
    });
    // Get tokens
    const tokens = await apiUtils.getAccessToken(firmIdPrompt, authCodePrompt);
    if (tokens) {
      console.log("Authentication successful");
    }
    // Get firm name
    await apiUtils.getFirmName(firmIdPrompt);
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
}

async function refreshTokens(firmId) {
  apiUtils.setAxiosDefaults(firmId);
  await apiUtils.refreshTokens(firmId);
}

async function createReconciliationText(
  firmId,
  attributes,
  refreshToken = true
) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.post(`reconciliations`, attributes);
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
      createReconciliationText,
      callbackParameters
    );
    return response;
  }
}

async function readReconciliationTexts(firmId, page = 1, refreshToken = true) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`reconciliations`, {
      params: { page: page, per_page: 2000 },
    });
    apiUtils.responseSuccessHandler(response);
    return response.data;
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
      readReconciliationTexts,
      callbackParameters
    );
    return response;
  }
}

async function readReconciliationTextById(firmId, id, refreshToken = true) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`reconciliations/${id}`);
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId,
      id,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      readReconciliationTextById,
      callbackParameters
    );
    return response;
  }
}

async function findReconciliationTextByHandle(firmId, handle, page = 1) {
  const reconciliations = await readReconciliationTexts(firmId, page);
  // No data
  if (reconciliations.length == 0) {
    console.log(`Reconciliation ${handle} not found`);
    return;
  }
  let reconciliationTexts = reconciliations.filter(
    (element) => element["handle"] === handle
  );
  if (reconciliationTexts.length != 0) {
    for (let reconciliationText of reconciliationTexts) {
      // Only return reconciliations were liquid code is not hidden
      if (reconciliationText.hasOwnProperty("text")) {
        return reconciliationText;
      }
    }
  }
  return findReconciliationTextByHandle(firmId, handle, page + 1);
}

async function updateReconciliationText(
  firmId,
  reconciliationId,
  attributes,
  refreshToken = true
) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.post(
      `reconciliations/${reconciliationId}`,
      attributes
    );
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId,
      reconciliationId,
      attributes,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      updateReconciliationText,
      callbackParameters
    );
    return response;
  }
}

async function readReconciliationTextDetails(
  firmId,
  companyId,
  periodId,
  reconciliationId,
  refreshToken = true
) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.get(
      `/companies/${companyId}/periods/${periodId}/reconciliations/${reconciliationId}`
    );
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId,
      companyId,
      periodId,
      reconciliationId,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      readReconciliationTextDetails,
      callbackParameters
    );
    return response;
  }
}

async function getReconciliationCustom(
  firmId,
  companyId,
  periodId,
  reconciliationId,
  page = 1,
  refreshToken = true
) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.get(
      `/companies/${companyId}/periods/${periodId}/reconciliations/${reconciliationId}/custom`,
      { params: { page: page, per_page: 2000 } }
    );
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId,
      companyId,
      periodId,
      reconciliationId,
      page,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      getReconciliationCustom,
      callbackParameters
    );
    return response;
  }
}

async function getReconciliationResults(
  firmId,
  companyId,
  periodId,
  reconciliationId,
  refreshToken = true
) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.get(
      `/companies/${companyId}/periods/${periodId}/reconciliations/${reconciliationId}/results`
    );
    apiUtils.responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId,
      companyId,
      periodId,
      reconciliationId,
      refreshToken: false,
    };
    const response = await apiUtils.responseErrorHandler(
      firmId,
      error,
      refreshToken,
      getReconciliationResults,
      callbackParameters
    );
    return response;
  }
}

async function readSharedParts(firmId, page = 1, refreshToken = true) {
  apiUtils.setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`shared_parts`, {
      params: { page: page, per_page: 2000 },
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
    console.log(`Shared part ${sharedPartName} not found`);
    return;
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
      params: { page: page, per_page: 2000 },
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
      { params: { page: page, per_page: 2000 } }
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
    console.log(
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
  console.log(
    `Reconciliation ${reconciliationHandle} not found in any workflow`
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
