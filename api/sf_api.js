
const axios = require('axios');
const prompt = require('prompt-sync')({sigint: true});
const {config} = require('./auth');

// firm id and host can be changed via ENV vars
require("dotenv").config();
const missingVariables =  ['SF_FIRM_ID'].filter((key) => !process.env[key]);
if (missingVariables.length && process.argv[2] !== "help") {
  throw `Missing configuration variables: ${missingVariables}, call export ${missingVariables[0]}=... before`
};
const baseURL = process.env.SF_HOST || 'https://live.getsilverfin.com';
const firmId = process.env.SF_FIRM_ID;

function authorizeApp(firmId = "") {
  // Check Client ID
  if (!config.data.clientId) {
    config.setClientId();
  } else {
    console.log(`ClientId loaded from configuration file.`);
  };
  // Check Secret
  if (!config.data.secret) {
    config.setSecret();
  } else {
    console.log(`Secret loaded from configuration file`);
  };
  const redirectUri = "urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob";
  const scope = "user%3Aprofile+user%3Aemail+webhooks+administration%3Aread+administration%3Awrite+permanent_documents%3Aread+permanent_documents%3Awrite+communication%3Aread+communication%3Awrite+financials%3Aread+financials%3Awrite+financials%3Atransactions%3Aread+financials%3Atransactions%3Awrite+links+workflows%3Aread";
  const url = `${baseURL}/oauth/authorize?client_id=${config.data.clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
  console.log(`You need to authorize your App. Follow: ${url}`);
  console.log('Insert your credentials...');
  const authCodePrompt = prompt('Enter your API authorization code: ',{echo:'*'});
  const firmIdPrompt = prompt('Enter the firm ID: ');
  // Check firm id against the one entered
  if (firmId && firmId != firmIdPrompt) {
      throw `The firm id you entered (${firmIdPrompt}) does not match the one you are trying to use (${firmId})`;
  };
  // Get tokens
  getAccessToken(config.data.clientId, config.data.secret, firmIdPrompt, authCodePrompt);
};

// Get Tokens for the first time
async function getAccessToken(clientId, secret, firmId, authCode) {  
  try {  
    const redirectUri = "urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob";
    const grantType = "authorization_code";
    let requestDetails = {
      method: 'post',
      url: `https://api.getsilverfin.com/f/${firmId}/oauth/token?client_id=${clientId}&client_secret=${secret}&redirect_uri=${redirectUri}&grant_type=${grantType}&code=${authCode}`
    };
    const response = await axios(requestDetails);
    config.storeNewTokens(response, firmId);
  }
  catch (error) {
    console.log(`Error: ${error.response.data.error_description}`);
    process.exit();
  };
};

// Get a new pair of tokens
async function refreshTokens(clientId, secret, firmId, accessToken, refreshToken) {
  try {
    console.log(`Requesting new pair of tokens`);
    let data = {
      client_id: clientId,
      client_secret: secret,
      redirect_uri: "urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob",
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      access_token: accessToken
    };
    const response = await axios.post(`https://api.getsilverfin.com/f/${firmId}/oauth/token`, data);
    config.storeNewTokens(response, firmId);
  }
  catch (error) {
    console.log(`Error refreshing: ${error.response.data.error_description}`);
    console.log(`Try running the authentication process again`)
    process.exit();
  };
};

function setAxiosDefaults() {
  if (config.data.hasOwnProperty(firmId)) {
    axios.defaults.baseURL = `${baseURL}/api/v4/f/${firmId}`
    axios.defaults.headers.common['Authorization'] = `Bearer ${config.data[String(firmId)].accessToken}`
  } else {
    throw `Missing authorization for firm id: ${firmId}`;
  };
};

function responseSuccessHandler(response) {
  console.log(`Response Status: ${response.status} (${response.statusText}) - method: ${response.config.method} - url: ${response.config.url}`);
};

async function responseErrorHandler(error, refreshToken = false, callbackFunction, callbackParameters) {
  if (refreshToken) {
    console.log(`Response Status: ${error.response.status} (${error.response.statusText}) - method: ${error.response.config.method} - url: ${error.response.config.url}`);
    console.log(`Response Data: ${JSON.stringify(error.response.data.error)}`);
    // Get a new pair of tokens
    await refreshTokens(config.data.clientId, config.data.secret, firmId, config.data[String(firmId)].accessToken, config.data[String(firmId)].refreshToken);
    //  Call the original function again
    return callbackFunction(...Object.values(callbackParameters));
  } else {
    console.log(`Api calls failed, try to run the authorization process again`);
    process.exit();
  };
};

async function fetchReconciliationTexts(page = 1, refreshToken = true) {
  setAxiosDefaults();
  try {
    const response = await axios.get(`reconciliations`, { params: { page: page, per_page: 200 } })
    responseSuccessHandler(response);
    return response;
  } 
  catch (error) {
    const callbackParameters = {page: page, refreshToken: false};
    const response = await responseErrorHandler(error, refreshToken, fetchReconciliationTexts, callbackParameters);
    return response;
  };
};

async function findReconciliationText(handle, page = 1) {
  const response = await fetchReconciliationTexts(page);
  const reconciliations = response.data;
  // No data
  if (reconciliations.length == 0) {
    console.log(`Reconciliation ${handle} not found`);
    return;
  };
  const reconciliationText = reconciliations.find((element) => element['handle'] === handle);
  if (reconciliationText) {
    return reconciliationText;
  } else {
    return findReconciliationText(handle, page + 1);
  };
};

async function updateReconciliationText(id, attributes, refreshToken = true) {
  setAxiosDefaults();
  try {
    const response = await axios.post(`reconciliations/${id}`, attributes);
    responseSuccessHandler(response);
    return response;
  } 
  catch (error) {
    const callbackParameters = {id:id, attributes:attributes, refreshToken: false};
    const response = await responseErrorHandler(error, refreshToken, updateReconciliationText, callbackParameters);
    return response; 
  };
};


async function fetchSharedParts(page = 1, refreshToken = true) {
  setAxiosDefaults();
  try {
    const response = await axios.get(`shared_parts`, { params: { page: page, per_page: 200 }});
    responseSuccessHandler(response);
    return response;
  }
  catch (error) {
    const callbackParameters = {page:page , refreshToken: false};
    const response = await responseErrorHandler(error, refreshToken, fetchSharedParts, callbackParameters);
    return response;
  };
};

async function fetchSharedPartById(id, refreshToken = true) {
  setAxiosDefaults();
  try {
    const response = await axios.get(`shared_parts/${id}`);
    responseSuccessHandler(response);
    return response;
  } 
  catch (error) {
    const callbackParameters = {id:id, refreshToken: false};
    const response = await responseErrorHandler(error, refreshToken, fetchSharedPartById, callbackParameters);
    return response;
  };
};

async function findSharedPart(name, page = 1) {
  const response = await fetchSharedParts(page);
  const sharedParts = response.data;
  // No data
  if (sharedParts.lenght == 0) {
    console.log(`Shared part ${name} not found`);
    return;
  }
  const sharedPart = sharedParts.find((element) => element['name'] === name);
  if (sharedPart) {
    return sharedPart;
  } else {
    return findSharedPart(name, page + 1);
  }
};

async function updateSharedPart(id, attributes, refreshToken = true) {
  setAxiosDefaults();
  try {
    const response = await axios.post(`shared_parts/${id}`, attributes);
    responseSuccessHandler(response);
    return response;
  }
  catch (error) {
    const callbackParameters = {id:id, attributes:attributes, refreshToken: false};
    const response = await responseErrorHandler(error, refreshToken, updateSharedPart, callbackParameters);
    return response;
  };
};

async function createTestRun(attributes, refreshToken = true) {
  setAxiosDefaults();
  try {
    const response = await axios.post('reconciliations/test', attributes);
    responseSuccessHandler(response);
    return response;
  }
  catch (error) {
    const callbackParameters = {attributes:attributes, refreshToken: false};
    const response = await responseErrorHandler(error, refreshToken, createTestRun, callbackParameters);
    return response;
  };
};

async function fetchTestRun(id, refreshToken = true) {
  setAxiosDefaults();
  try {
    const response = await axios.get(`reconciliations/test_runs/${id}`);
    responseSuccessHandler(response);
    return response;
  }
  catch (error) {
    const callbackParameters = {id:id, refreshToken: false};
    const response = await responseErrorHandler(error, refreshToken, fetchTestRun, callbackParameters);
    return response;
  };
 };

module.exports = { 
  authorizeApp,
  fetchReconciliationTexts, 
  updateReconciliationText, 
  findReconciliationText, 
  fetchSharedParts, 
  fetchSharedPartById, 
  findSharedPart, 
  updateSharedPart, 
  fetchTestRun, 
  createTestRun 
};
