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
  console.log(
    `Credentials should be defined as environmental variables. Call export ${missingVariables[0]}=... before using this CLI`
  );
  console.log(
    `If you don't have credentials yet, you need to register your app with Silverfin to get them`
  );
  process.exit(1);
}

async function authorizeApp() {
  const redirectUri = "urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob";
  const scope =
    "user%3Aprofile+user%3Aemail+webhooks+administration%3Aread+administration%3Awrite+permanent_documents%3Aread+permanent_documents%3Awrite+communication%3Aread+communication%3Awrite+financials%3Aread+financials%3Awrite+financials%3Atransactions%3Aread+financials%3Atransactions%3Awrite+links+workflows%3Aread";
  const url = `${baseURL}/oauth/authorize?client_id=${process.env.SF_API_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
  await open(url);
  console.log(`You need to authorize your APP in the browser`);
  console.log("Insert your credentials...");
  const authCodePrompt = prompt("Enter your API authorization code: ", {
    echo: "*",
  });
  let firmIdPrompt;
  if (process.env.SF_FIRM_ID) {
    firmIdPrompt = prompt(
      `Enter the firm ID: (leave blank to use ${process.env.SF_FIRM_ID})`,
      { value: process.env.SF_FIRM_ID }
    );
  } else {
    firmIdPrompt = prompt("Enter the firm ID: ");
  }
  // Get tokens
  await getAccessToken(firmIdPrompt, authCodePrompt);
  console.log("Done");
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

function setAxiosDefaults() {
  if (config.data.hasOwnProperty(firmId)) {
    axios.defaults.baseURL = `${baseURL}/api/v4/f/${firmId}`;
    axios.defaults.headers.common["Authorization"] = `Bearer ${
      config.data[String(firmId)].accessToken
    }`;
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

async function fetchReconciliationTexts(page = 1, refreshToken = true) {
  setAxiosDefaults();
  try {
    const response = await axios.get(`reconciliations`, {
      params: { page: page, per_page: 200 },
    });
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = { page: page, refreshToken: false };
    const response = await responseErrorHandler(
      error,
      refreshToken,
      fetchReconciliationTexts,
      callbackParameters
    );
    return response;
  }
}

async function findReconciliationText(handle, page = 1) {
  const response = await fetchReconciliationTexts(page);
  const reconciliations = response.data;
  // No data
  if (reconciliations.length == 0) {
    console.log(`Reconciliation ${handle} not found`);
    return;
  }
  const reconciliationText = reconciliations.find(
    (element) => element["handle"] === handle
  );
  if (reconciliationText) {
    return reconciliationText;
  } else {
    return findReconciliationText(handle, page + 1);
  }
}

async function updateReconciliationText(id, attributes, refreshToken = true) {
  setAxiosDefaults();
  try {
    const response = await axios.post(`reconciliations/${id}`, attributes);
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      id: id,
      attributes: attributes,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
      error,
      refreshToken,
      updateReconciliationText,
      callbackParameters
    );
    return response;
  }
}

async function fetchSharedParts(page = 1, refreshToken = true) {
  setAxiosDefaults();
  try {
    const response = await axios.get(`shared_parts`, {
      params: { page: page, per_page: 200 },
    });
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = { page: page, refreshToken: false };
    const response = await responseErrorHandler(
      error,
      refreshToken,
      fetchSharedParts,
      callbackParameters
    );
    return response;
  }
}

async function fetchSharedPartById(id, refreshToken = true) {
  setAxiosDefaults();
  try {
    const response = await axios.get(`shared_parts/${id}`);
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = { id: id, refreshToken: false };
    const response = await responseErrorHandler(
      error,
      refreshToken,
      fetchSharedPartById,
      callbackParameters
    );
    return response;
  }
}

async function findSharedPart(name, page = 1) {
  const response = await fetchSharedParts(page);
  const sharedParts = response.data;
  // No data
  if (sharedParts.length == 0) {
    console.log(`Shared part ${name} not found`);
    return;
  }
  const sharedPart = sharedParts.find((element) => element["name"] === name);
  if (sharedPart) {
    return sharedPart;
  } else {
    return findSharedPart(name, page + 1);
  }
}

async function updateSharedPart(id, attributes, refreshToken = true) {
  setAxiosDefaults();
  try {
    const response = await axios.post(`shared_parts/${id}`, attributes);
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      id: id,
      attributes: attributes,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
      error,
      refreshToken,
      updateSharedPart,
      callbackParameters
    );
    return response;
  }
}

async function addSharedPart(
  sharedPartId,
  reconciliationId,
  refreshToken = true
) {
  setAxiosDefaults();
  try {
    const response = await axios.post(
      `reconciliations/${reconciliationId}/shared_parts/${sharedPartId}`
    );
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      sharedPartId: sharedPartId,
      reconciliationId: reconciliationId,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
      error,
      refreshToken,
      updateSharedPart,
      callbackParameters
    );
    return response;
  }
}

async function removeSharedPart(
  sharedPartId,
  reconciliationId,
  refreshToken = true
) {
  setAxiosDefaults();
  try {
    const response = await axios.delete(
      `reconciliations/${reconciliationId}/shared_parts/${sharedPartId}`
    );
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = {
      sharedPartId: sharedPartId,
      reconciliationId: reconciliationId,
      refreshToken: false,
    };
    const response = await responseErrorHandler(
      error,
      refreshToken,
      updateSharedPart,
      callbackParameters
    );
    return response;
  }
}

async function createTestRun(attributes, refreshToken = true) {
  setAxiosDefaults();
  try {
    const response = await axios.post("reconciliations/test", attributes);
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = { attributes: attributes, refreshToken: false };
    const response = await responseErrorHandler(
      error,
      refreshToken,
      createTestRun,
      callbackParameters
    );
    return response;
  }
}

async function fetchTestRun(id, refreshToken = true) {
  setAxiosDefaults();
  try {
    const response = await axios.get(`reconciliations/test_runs/${id}`);
    responseSuccessHandler(response);
    return response;
  } catch (error) {
    const callbackParameters = { id: id, refreshToken: false };
    const response = await responseErrorHandler(
      error,
      refreshToken,
      fetchTestRun,
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
  fetchSharedParts,
  fetchSharedPartById,
  findSharedPart,
  updateSharedPart,
  addSharedPart,
  removeSharedPart,
  fetchTestRun,
  createTestRun,
};
