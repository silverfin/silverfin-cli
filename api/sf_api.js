const axios = require("axios");
const open = require("open");
const prompt = require("prompt-sync")({ sigint: true });
const { config } = require("./auth");

require("dotenv").config();
const baseURL = process.env.SF_HOST || "https://live.getsilverfin.com";
const missingVariables = ["SF_API_CLIENT_ID", "SF_API_SECRET"].filter(
  (key) => !process.env[key]
);
if (missingVariables.length) {
  console.log(`Error: Missing API credentials: [${missingVariables}]`);
  console.log(`Credentials should be defined as environmental variables.`);
  console.log(
    `Call export ${missingVariables[0]}=... or define them in a .env file inside the root directory before using this CLI`
  );
  console.log(
    `If you don't have credentials yet, you need to register your app with Silverfin to get them`
  );
  process.exit(1);
}

async function authorizeApp(firmId = undefined) {
  try {
    console.log(
      `Note: if you need to exit this process you can press "Ctrl/Cmmd + C"`
    );
    const redirectUri = "urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob";
    const scope =
      "user%3Aprofile+user%3Aemail+webhooks+administration%3Aread+administration%3Awrite+permanent_documents%3Aread+permanent_documents%3Awrite+communication%3Aread+communication%3Awrite+financials%3Aread+financials%3Awrite+financials%3Atransactions%3Aread+financials%3Atransactions%3Awrite+links+workflows%3Aread";

    let firmIdPrompt;
    if (firmId) {
      firmIdPrompt = prompt(
        `Enter the firm ID (leave blank to use ${firmId}): `,
        { value: firmId }
      );
    } else {
      firmIdPrompt = prompt("Enter the firm ID: ");
    }
    const url = `${baseURL}/f/${firmIdPrompt}/oauth/authorize?client_id=${process.env.SF_API_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;

    await open(url);
    console.log(`You need to authorize your APP in the browser`);
    console.log("Insert your credentials...");
    const authCodePrompt = prompt("Enter your API authorization code: ", {
      echo: "*",
    });
    // Get tokens
    await getAccessToken(firmIdPrompt, authCodePrompt);
    console.log("Authentication successful");
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
}

// Get Tokens for the first time
async function getAccessToken(firmId, authCode) {
  try {
    const redirectUri = "urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob";
    const grantType = "authorization_code";
    let requestDetails = {
      method: "post",
      url: `https://api.getsilverfin.com/f/${firmId}/oauth/token?client_id=${process.env.SF_API_CLIENT_ID}&client_secret=${process.env.SF_API_SECRET}&redirect_uri=${redirectUri}&grant_type=${grantType}&code=${authCode}`,
    };
    const response = await axios(requestDetails);
    config.storeNewTokens(response, firmId);
  } catch (error) {
    console.log(
      `Response Status: ${error.response.status} (${error.response.statusText})`
    );
    console.log(
      `Error description: ${JSON.stringify(
        error.response.data.error_description
      )}`
    );
    process.exit(1);
  }
}

// Get a new pair of tokens
async function refreshTokens(firmId, accessToken, refreshToken) {
  try {
    console.log(`Requesting new pair of tokens`);
    let data = {
      client_id: process.env.SF_API_CLIENT_ID,
      client_secret: process.env.SF_API_SECRET,
      redirect_uri: "urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob",
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      access_token: accessToken,
    };
    const response = await axios.post(
      `https://api.getsilverfin.com/f/${firmId}/oauth/token`,
      data
    );
    config.storeNewTokens(response, firmId);
  } catch (error) {
    console.log(
      `Response Status: ${error.response.status} (${error.response.statusText})`
    );
    console.log(
      `Error description: ${JSON.stringify(
        error.response.data.error_description
      )}`
    );
    console.log(
      `Error refreshing the tokens. Try running the authentication process again`
    );
    process.exit(1);
  }
}

function setAxiosDefaults(firmId) {
  const firmCredentials = config.getTokens(firmId);
  if (firmCredentials) {
    axios.defaults.baseURL = `${baseURL}/api/v4/f/${firmId}`;
    axios.defaults.headers.common[
      "Authorization"
    ] = `Bearer ${firmCredentials.accessToken}`;
  } else {
    console.log(`Missing authorization for firm id: ${firmId}`);
    process.exit(1);
  }
}

function responseSuccessHandler(response) {
  console.log(
    `Response Status: ${response.status} (${response.statusText}) - method: ${response.config.method} - url: ${response.config.url}`
  );
}

async function responseErrorHandler(
  firmId,
  error,
  refreshToken = false,
  callbackFunction,
  callbackParameters
) {
  console.log(
    `Response Status: ${error.response.status} (${error.response.statusText}) - method: ${error.response.config.method} - url: ${error.response.config.url}`
  );
  // Valid Request. Not Found
  if (error.response.status === 404) {
    console.log(
      `Response Data error: ${JSON.stringify(error.response.data.error)}`
    );
    return;
  }
  // No access credentials
  if (error.response.status === 401) {
    console.log(
      `Response Data error: ${JSON.stringify(error.response.data.error)}`
    );
    if (refreshToken) {
      // Get a new pair of tokens
      await refreshTokens(
        firmId,
        config.data[String(firmId)].accessToken,
        config.data[String(firmId)].refreshToken
      );
      //  Call the original function again
      return callbackFunction(...Object.values(callbackParameters));
    } else {
      console.log(
        `API calls failed, try to run the authorization process again`
      );
      process.exit(1);
    }
  }
  // Unprocessable Entity
  if (error.response.status === 422) {
    console.log(`Response Data: ${JSON.stringify(error.response.data)}`);
    console.log(`You don't have the rights to update the previous parameters`);
    process.exit(1);
  }
  // Forbidden
  if (error.response.status === 403) {
    console.log("Forbidden access. Terminating process");
    process.exit(1);
  }
  // Not handled
  throw error;
}

async function fetchReconciliationTexts(firmId, page = 1, refreshToken = true) {
  setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`reconciliations`, {
      params: { page: page, per_page: 2000 },
    });
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      page: page,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
      firmId,
      error,
      refreshToken,
      fetchReconciliationTexts,
      callbackParameters
    );
    return response;
  }
}

async function findReconciliationText(firmId, handle, page = 1) {
  const response = await fetchReconciliationTexts(firmId, page);
  const reconciliations = response.data;
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
  } else {
    return findReconciliationText(firmId, handle, page + 1);
  }
}

async function findReconciliationTextById(firmId, reconciliationId, page = 1) {
  const response = await fetchReconciliationTexts(firmId, page);
  const reconciliations = response.data;
  // No data
  if (reconciliations.length == 0) {
    console.log(`Reconciliation ${reconciliationId} not found`);
    return;
  }
  let reconciliationText = reconciliations.filter(
    (element) => element["id"] === Number(reconciliationId)
  )[0];
  // Only return reconciliations were liquid code is not hidden
  if (reconciliationText && reconciliationText.hasOwnProperty("text")) {
    return reconciliationText;
  } else {
    return findReconciliationTextById(firmId, reconciliationId, page + 1);
  }
}

async function updateReconciliationText(
  firmId,
  reconciliationId,
  attributes,
  refreshToken = true
) {
  setAxiosDefaults(firmId);
  try {
    const response = await axios.post(
      `reconciliations/${reconciliationId}`,
      attributes
    );
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      reconciliationId: reconciliationId,
      attributes: attributes,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
      firmId,
      error,
      refreshToken,
      updateReconciliationText,
      callbackParameters
    );
    return response;
  }
}

async function getReconciliationDetails(
  firmId,
  companyId,
  periodId,
  reconciliationId,
  refreshToken = true
) {
  setAxiosDefaults(firmId);
  try {
    const response = await axios.get(
      `/companies/${companyId}/periods/${periodId}/reconciliations/${reconciliationId}`
    );
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      companyId: companyId,
      periodId: periodId,
      reconciliationId: reconciliationId,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
      firmId,
      error,
      refreshToken,
      getReconciliationDetails,
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
  setAxiosDefaults(firmId);
  try {
    const response = await axios.get(
      `/companies/${companyId}/periods/${periodId}/reconciliations/${reconciliationId}/custom`,
      { params: { page: page, per_page: 2000 } }
    );
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      companyId: companyId,
      periodId: periodId,
      reconciliationId: reconciliationId,
      page: page,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
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
  setAxiosDefaults(firmId);
  try {
    const response = await axios.get(
      `/companies/${companyId}/periods/${periodId}/reconciliations/${reconciliationId}/results`
    );
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      companyId: companyId,
      periodId: periodId,
      reconciliationId: reconciliationId,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
      firmId,
      error,
      refreshToken,
      getReconciliationResults,
      callbackParameters
    );
    return response;
  }
}

async function fetchSharedParts(firmId, page = 1, refreshToken = true) {
  setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`shared_parts`, {
      params: { page: page, per_page: 2000 },
    });
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      page: page,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
      firmId,
      error,
      refreshToken,
      fetchSharedParts,
      callbackParameters
    );
    return response;
  }
}

async function fetchSharedPartById(firmId, sharedPartId, refreshToken = true) {
  setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`shared_parts/${sharedPartId}`);
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      sharedPartId: sharedPartId,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
      firmId,
      error,
      refreshToken,
      fetchSharedPartById,
      callbackParameters
    );
    return response;
  }
}

async function findSharedPart(firmId, sharedPartName, page = 1) {
  const response = await fetchSharedParts(firmId, page);
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
    return findSharedPart(firmId, sharedPartName, page + 1);
  }
}

async function updateSharedPart(
  firmId,
  sharedPartId,
  attributes,
  refreshToken = true
) {
  setAxiosDefaults(firmId);
  try {
    const response = await axios.post(
      `shared_parts/${sharedPartId}`,
      attributes
    );
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      sharedPartId: sharedPartId,
      attributes: attributes,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
      firmId,
      error,
      refreshToken,
      updateSharedPart,
      callbackParameters
    );
    return response;
  }
}

async function addSharedPart(
  firmId,
  sharedPartId,
  reconciliationId,
  refreshToken = true
) {
  setAxiosDefaults(firmId);
  try {
    const response = await axios.post(
      `reconciliations/${reconciliationId}/shared_parts/${sharedPartId}`
    );
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      sharedPartId: sharedPartId,
      reconciliationId: reconciliationId,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
      firmId,
      error,
      refreshToken,
      updateSharedPart,
      callbackParameters
    );
    return response;
  }
}

async function removeSharedPart(
  firmId,
  sharedPartId,
  reconciliationId,
  refreshToken = true
) {
  setAxiosDefaults(firmId);
  try {
    const response = await axios.delete(
      `reconciliations/${reconciliationId}/shared_parts/${sharedPartId}`
    );
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      sharedPartId: sharedPartId,
      reconciliationId: reconciliationId,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
      firmId,
      error,
      refreshToken,
      updateSharedPart,
      callbackParameters
    );
    return response;
  }
}

async function createTestRun(firmId, attributes, refreshToken = true) {
  setAxiosDefaults(firmId);
  try {
    const response = await axios.post("reconciliations/test", attributes);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      attributes: attributes,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
      firmId,
      error,
      refreshToken,
      createTestRun,
      callbackParameters
    );
    return response;
  }
}

async function fetchTestRun(firmId, testId, refreshToken = true) {
  setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`reconciliations/test_runs/${testId}`);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      testId: testId,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
      firmId,
      error,
      refreshToken,
      fetchTestRun,
      callbackParameters
    );
    return response;
  }
}

async function getPeriods(firmId, companyId, page = 1, refreshToken = true) {
  setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`/companies/${companyId}/periods`, {
      params: { page: page, per_page: 2000 },
    });
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      companyId: companyId,
      page: page,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
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
  setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`/companies/${companyId}`);
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      companyId: companyId,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
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
  setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`/companies/${companyId}/custom`);
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      companyId: companyId,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
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
  setAxiosDefaults(firmId);
  try {
    const response = await axios.get(
      `/companies/${companyId}/periods/${periodId}/workflows`
    );
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      companyId: companyId,
      periodId: periodId,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
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
  setAxiosDefaults(firmId);
  try {
    const response = await axios.get(
      `/companies/${companyId}/periods/${periodId}/workflows/${workflowId}/reconciliations`,
      { params: { page: page, per_page: 2000 } }
    );
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      companyId: companyId,
      periodId: periodId,
      workflowId: workflowId,
      page: page,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
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
  setAxiosDefaults(firmId);
  try {
    const response = await axios.get(
      `companies/${companyId}/periods/${periodId}/accounts/${accountId}`
    );
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      firmId: firmId,
      companyId: companyId,
      periodId: periodId,
      accountId: accountId,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
      firmId,
      error,
      refreshToken,
      getAccountDetails,
      callbackParameters
    );
    return response;
  }
}

module.exports = {
  authorizeApp,
  fetchReconciliationTexts,
  updateReconciliationText,
  findReconciliationText,
  findReconciliationTextById,
  getReconciliationDetails,
  getReconciliationCustom,
  getReconciliationResults,
  fetchSharedParts,
  fetchSharedPartById,
  findSharedPart,
  updateSharedPart,
  addSharedPart,
  removeSharedPart,
  fetchTestRun,
  createTestRun,
  getPeriods,
  findPeriod,
  getCompanyDrop,
  getCompanyCustom,
  getWorkflows,
  getWorkflowInformation,
  findReconciliationInWorkflow,
  findReconciliationInWorkflows,
  getAccountDetails,
};
