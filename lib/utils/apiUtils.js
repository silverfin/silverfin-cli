const { firmCredentials } = require("../api/firmCredentials");
const pkg = require("../../package.json");
const axios = require("axios");
const { consola } = require("consola");

const BASE_URL = process.env.SF_HOST || "https://live.getsilverfin.com";

function checkRequiredEnvVariables() {
  const missingVariables = ["SF_API_CLIENT_ID", "SF_API_SECRET"].filter(
    (key) => !process.env[key]
  );
  if (missingVariables.length) {
    consola.error(`Error: Missing API credentials: [${missingVariables}]`);
    consola.log(`Credentials should be defined as environmental variables.`);
    consola.log(`Call export ${missingVariables[0]}=...`);
    consola.log(
      `If you don't have credentials yet, you need to register your app with Silverfin to get them`
    );
    process.exit(1);
  }
}

// Get Tokens for the first time
async function getAccessToken(firmId, authCode) {
  try {
    const redirectUri = "urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob";
    const grantType = "authorization_code";
    let requestDetails = {
      method: "POST",
      url: `https://api.getsilverfin.com/f/${firmId}/oauth/token?client_id=${process.env.SF_API_CLIENT_ID}&client_secret=${process.env.SF_API_SECRET}&redirect_uri=${redirectUri}&grant_type=${grantType}&code=${authCode}`,
    };
    const response = await axios(requestDetails);
    firmCredentials.storeNewTokenPair(firmId, response.data);
    await getFirmName(firmId);
    return true;
  } catch (error) {
    consola.error(
      `Response Status: ${error.response.status} (${error.response.statusText})`
    );
    consola.error(
      `Error description: ${JSON.stringify(
        error.response.data.error_description
      )}`
    );
    process.exit(1);
  }
}

// Get a new pair of tokens
async function refreshTokens(firmId) {
  try {
    const firmTokens = firmCredentials.getTokenPair(firmId);
    consola.debug(`Requesting new pair of tokens`);
    let data = {
      client_id: process.env.SF_API_CLIENT_ID,
      client_secret: process.env.SF_API_SECRET,
      redirect_uri: "urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob",
      grant_type: "refresh_token",
      refresh_token: firmTokens.refreshToken,
      access_token: firmTokens.accessToken,
    };
    const response = await axios.post(
      `https://api.getsilverfin.com/f/${firmId}/oauth/token`,
      data
    );
    firmCredentials.storeNewTokenPair(firmId, response.data);
    // firm name
    const firmName = firmCredentials.getFirmName(firmId);
    if (!firmName) {
      await getFirmName(firmId);
    }
  } catch (error) {
    const description = JSON.stringify(error.response.data.error_description);
    consola.error(
      `Response Status: ${error.response.status} (${error.response.statusText})`,
      "\n",
      `Error description: ${description}`,
      "\n",
      `Error refreshing the tokens. Try running the authentication process again`
    );
    process.exit(1);
  }
}

function setAxiosDefaults(firmId) {
  const firmTokens = firmCredentials.getTokenPair(firmId);
  if (!firmTokens) {
    consola.error(`Missing authorization for firm id: ${firmId}`);
    process.exit(1);
  }
  axios.defaults.baseURL = `${BASE_URL}/api/v4/f/${firmId}`;
  axios.defaults.headers["User-Agent"] = `silverfin-cli/${pkg.version}`;
  axios.defaults.headers.common[
    "Authorization"
  ] = `Bearer ${firmTokens.accessToken}`;
}

function responseSuccessHandler(response) {
  consola.debug(
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
  if (error && error.response) {
    
    consola.error(
      `Response Status: ${error.response.status} (${error.response.statusText}) - method: ${error.response.config.method} - url: ${error.response.config.url}`
    );
  }
  // Valid Request. Not Found
  if (error.response.status === 404) {
    consola.error(
      `Response Error (404): ${JSON.stringify(error.response.data.error)}`
    );
    return;
  }
  // Bad Request
  if (error.response.status === 400) {
    consola.error(
      `Response Error (400): ${JSON.stringify(error.response.data.error)}`
    );
    return;
  }
  // No access credentials
  if (error.response.status === 401) {
    consola.debug(
      `Response Error (401): ${JSON.stringify(error.response.data.error)}`
    );
    if (refreshToken) {
      // Get a new pair of tokens
      await refreshTokens(firmId);
      //  Call the original function again
      return callbackFunction(...Object.values(callbackParameters));
    } else {
      consola.error(
        `Error 401: API calls failed, try to run the authorization process again`
      );
      process.exit(1);
    }
  }
  // Unprocessable Entity
  if (error.response.status === 422) {
    consola.error(
      `Response Error (422): ${JSON.stringify(error.response.data)}`,
      "\n",
      `You don't have the rights to update the previous parameters`
    );
    process.exit(1);
  }
  // Forbidden
  if (error.response.status === 403) {
    consola.error("Error (403): Forbidden access. Terminating process");
    process.exit(1);
  }
  // Not handled
  throw error;
}

/**
 * Retrieve firm details and store the firm name in the credentials file
 * @param {Number} firmId
 */
async function getFirmName(firmId) {
  setAxiosDefaults(firmId);
  try {
    const response = await axios.get(`/user/firm`);
    if (response && response.data) {
      firmCredentials.storeFirmName(firmId, response.data.name);
    }
  } catch (error) {}
}

module.exports = {
  BASE_URL,
  checkRequiredEnvVariables,
  getAccessToken,
  setAxiosDefaults,
  responseSuccessHandler,
  responseErrorHandler,
  refreshTokens,
  getFirmName,
};
