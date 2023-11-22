const { firmCredentials } = require("../api/firmCredentials");
const pkg = require("../../package.json");
const axios = require("axios");
const { consola } = require("consola");

const BASE_URL = process.env.SF_HOST || "https://live.getsilverfin.com";

function checkAuthorizePartners(partnerId) {
  const partnerCredentials = firmCredentials.getPartnerCredentials(partnerId);

  return partnerCredentials;
}

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
async function refreshTokens(instance, firmId) {
  try {
    consola.debug(`refreshing tokens for firm ${firmId}`);
    const firmTokens = firmCredentials.getTokenPair(firmId);
    let data = {
      client_id: process.env.SF_API_CLIENT_ID,
      client_secret: process.env.SF_API_SECRET,
      redirect_uri: "urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob",
      grant_type: "refresh_token",
      refresh_token: firmTokens.refreshToken,
      access_token: firmTokens.accessToken,
    };
    const response = await instance.post(
      `https://api.getsilverfin.com/f/${firmId}/oauth/token`,
      data
    );
    firmCredentials.storeNewTokenPair(firmId, response.data);
    // firm name
    const firmName = firmCredentials.getFirmName(firmId);

    if (!firmName) {
      await getFirmName(firmId);
    }

    return true;
  } catch (error) {
    const description =
      error?.response?.data?.error_description || error?.request?.data;

    consola.error(
      `Response Status: ${error.response.status} (${error.response.statusText})`,
      description ? `\nError description: ${description}` : "",
      "\n",
      `Error refreshing the tokens. Try running the authentication process again`
    );
    process.exit(1);
  }
}

function setAxiosDefaults(type, envId) {
  let axiosInstance;

  if (type == "firm") {
    const firmTokens = firmCredentials.getTokenPair(envId);
    if (!firmTokens) {
      consola.error(`Missing authorization for firm id: ${envId}`);
      process.exit(1);
    }

    axiosInstance = axios.create({
      baseURL: `${BASE_URL}/api/v4/f/${envId}`,
      headers: {
        "User-Agent": `silverfin-cli/${pkg.version}`,
        Authorization: `Bearer ${firmTokens.accessToken}`,
      },
    });

    axiosInstance.interceptors.response.use(
      (res) => {
        return res;
      },
      async (error) => {
        const originalConfig = error.config;
        if (error.response) {
          if (error.response.status === 401 && !originalConfig._retry) {
            // Set _retry to true after trying the first refresh request on 401 status to avoid an infinite loop
            originalConfig._retry = true;

            try {
              // Get a refreshed set of tokens
              const firmId = originalConfig.baseURL.split("/").pop();
              await refreshTokens(axiosInstance, firmId);

              // Set the Authorization header with the new access token
              const firmTokens = firmCredentials.getTokenPair(firmId);
              consola.debug(`refreshed tokens for firm ${firmId}`);

              axiosInstance.defaults.headers.common[
                "Authorization"
              ] = `Bearer ${firmTokens.accessToken}`;

              originalConfig.headers.Authorization = `Bearer ${firmTokens.accessToken}`;

              return axiosInstance(originalConfig);
            } catch (_error) {
              consola.error(
                `Error 401: Failed to refresh the firm access token automatically, try to manually authorize the firm again with the authorize command`
              );

              if (_error.response && _error.response.data) {
                return Promise.reject(_error.response.data);
              }

              return Promise.reject(_error);
            }
          }
        }

        return Promise.reject(error);
      }
    );
  } else if (type == "partner") {
    axiosInstance = axios.create({
      baseURL: `${BASE_URL}/api/partner/v1`,
      headers: {
        "User-Agent": `silverfin-cli/${pkg.version}`,
      },
    });

    axiosInstance.interceptors.request.use((config) => {
      // Fetch the stored partner api key
      const partnerToken = firmCredentials.getPartnerCredentials(envId)?.token;

      // Set the partner api key and id as a query param to every request
      config.params = {
        ...config.params,
        partner_id: envId,
        api_key: partnerToken,
      };

      return config;
    });

    axiosInstance.interceptors.response.use(
      (res) => {
        return res;
      },
      async (error) => {
        const originalConfig = error.config;
        if (error.response) {
          if (error.response.status === 401 && !originalConfig._retry) {
            // Set _retry to true after trying the first refresh request on 401 status to avoid an infinite loop
            originalConfig._retry = true;

            try {
              // Get a refresh API key
              const originalPartnerId = originalConfig.params.partner_id;
              const originalPartnerApiKey = originalConfig.params.api_key;

              const response = await axios.post(
                `${BASE_URL}/api/partner/v1/refresh_api_key?api_key=${originalPartnerApiKey}`
              );

              firmCredentials.storePartnerApiKey(
                originalPartnerId,
                response.data.api_key
              );

              consola.debug("refreshed partner api key");

              return axiosInstance(originalConfig);
            } catch (_error) {
              consola.error(
                `Error 401: Failed to refresh the partner api key automatically, try to manually authorize the partner again with the authorize-partner command`
              );

              if (_error.response && _error.response.data) {
                return Promise.reject(_error.response.data);
              }

              return Promise.reject(_error);
            }
          }
        }

        return Promise.reject(error);
      }
    );
  }

  return axiosInstance;
}

function responseSuccessHandler(response) {
  if (response?.status) {
    consola.debug(
      `Response Status: ${response.status} (${
        response?.statusText
      }) - method: ${response?.config?.method || response?.method} - url: ${
        response?.config?.url || response?.url
      }`
    );
  }
}

async function responseErrorHandler(error) {
  if (error && error.response) {
    consola.debug(
      `Response Status: ${error.response.status} (${error.response.statusText}) - method: ${error.response.config.method} - url: ${error.response.config.url}`
    );
  }
  if (error?.response) {
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
    // Unprocessable Entity
    if (error.response.status === 422) {
      consola.error(
        `Response Error (422): ${JSON.stringify(error.response.data)}`,
        "\n",
        `You don't have the rights to update the previous parameters`
      );
      process.exit(1);
    }
    if (error.response.status === 401) {
      consola.debug(
        `Response Error (401): ${JSON.stringify(error.response.data)}`
      );
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
  checkAuthorizePartners,
};
