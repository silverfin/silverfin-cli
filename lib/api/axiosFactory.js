const { firmCredentials } = require("./firmCredentials");
const axios = require("axios");
const { consola } = require("consola");
const pkg = require("../../package.json");

class AxiosFactory {
  constructor() {}

  /**
   * Create an axios instance for a given type and environment id.
   * It will add the necessary headers and interceptors to handle the authorization, and refresh the tokens if needed.
   * The created instance will be used to make requests to the Silverfin API.
   * @param {String} type - The type of instance to create (firm or partner)
   * @param {Number} envId - The environment id to create the instance for
   * @returns {Object} - The created axios instance
   */
  static createInstance(type, envId) {
    this.BASE_URL = firmCredentials.getHost();
    let axiosInstance;

    switch (type) {
      case "firm":
        axiosInstance = this.#createAxiosInstanceForFirms(envId);
        break;
      case "partner":
        axiosInstance = this.#createAxiosInstanceForPartners(envId);
        break;
      default:
        consola.error(`Invalid type environment: ${type}`);
        process.exit(1);
    }

    return axiosInstance;
  }

  // PRIVATE METHODS

  static #createAxiosInstanceForFirms(envId) {
    const firmTokens = firmCredentials.getTokenPair(envId);
    if (!firmTokens) {
      consola.error(`Missing authorization for firm id: ${envId}`);
      process.exit(1);
    }

    let baseHeaders = {
      "User-Agent": `silverfin-cli/${pkg.version}`,
      "X-Firm-ID": envId,
    };

    let axiosDetails;
    if (this.#isStaging()) {
      axiosDetails = {
        baseURL: `${this.BASE_URL}/api/v4/f/${envId}`,
        headers: {
          ...baseHeaders,
          Authorization: this.#basicAuthHeader(),
        },
        params: {
          access_token: firmTokens.accessToken,
        },
      };
    } else {
      axiosDetails = {
        baseURL: `${this.BASE_URL}/api/v4/f/${envId}`,
        headers: {
          ...baseHeaders,
          Authorization: `Bearer ${firmTokens.accessToken}`,
        },
      };
    }

    let axiosInstance = axios.create(axiosDetails);
    axiosInstance = this.#addFirmTokenRefresher(axiosInstance);

    return axiosInstance;
  }

  // Add a response interceptor to refresh the access token if it's expired
  static #addFirmTokenRefresher(axiosInstance) {
    axiosInstance.interceptors.response.use(
      (response) => {
        return response;
      },
      async (error) => {
        const originalConfig = error.config;
        if (error.response) {
          if (error.response.status === 401 && !originalConfig._retry) {
            // Set _retry to true after trying the first refresh request on 401 status to avoid an infinite loop
            originalConfig._retry = true;

            try {
              // Get a refreshed set of tokens
              const firmId = originalConfig.headers["X-Firm-ID"];

              await this.#refreshFirmTokens(axiosInstance, firmId);

              const firmTokens = firmCredentials.getTokenPair(firmId);

              // Set the new access token for current and future requests
              if (this.#isStaging()) {
                axiosInstance.defaults.params = {
                  ...axiosInstance.defaults.params,
                  access_token: firmTokens.accessToken,
                };
                originalConfig.params = {
                  ...originalConfig.params,
                  access_token: firmTokens.accessToken,
                };
              } else {
                axiosInstance.defaults.headers.common["Authorization"] =
                  `Bearer ${firmTokens.accessToken}`;
                originalConfig.headers.Authorization = `Bearer ${firmTokens.accessToken}`;
              }

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

    return axiosInstance;
  }

  static #createAxiosInstanceForPartners(envId) {
    const partnerToken = firmCredentials.getPartnerCredentials(envId)?.token;
    if (!partnerToken) {
      consola.error(`Missing authorization for partner id: ${envId}`);
      process.exit(1);
    }

    let axiosDetails = {
      baseURL: `${this.BASE_URL}/api/partner/v1`,
      headers: {
        "User-Agent": `silverfin-cli/${pkg.version}`,
      },
      params: {
        partner_id: envId,
        api_key: partnerToken,
      },
    };

    if (this.#isStaging()) {
      axiosDetails.headers.Authorization = this.#basicAuthHeader();
    }

    let axiosInstance = axios.create(axiosDetails);
    axiosInstance = this.#addPartnerTokenRefresher(axiosInstance);

    return axiosInstance;
  }

  // Add a response interceptor to refresh the partner token if it's expired
  static #addPartnerTokenRefresher(axiosInstance) {
    axiosInstance.interceptors.response.use(
      (response) => {
        return response;
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

              const response = await axiosInstance.post(
                `${this.BASE_URL}/api/partner/v1/refresh_api_key?api_key=${originalPartnerApiKey}`
              );

              firmCredentials.storePartnerApiKey(
                originalPartnerId,
                response.data.api_key
              );

              consola.debug("Refreshed partner api key");

              // Set the new access token for current and future requests
              axiosInstance.defaults.params.api_key = response.data.api_key;
              originalConfig.params.api_key = response.data.api_key;

              return axiosInstance(originalConfig);
            } catch (_error) {
              consola.error(
                `Error 401: Failed to refresh the partner API key automatically, try to manually authorize the partner again with the authorize-partner command`
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

    return axiosInstance;
  }

  /**
   * Check if current host is staging or not
   * @returns {Boolean}
   */
  static #isStaging() {
    return /staging\.getsilverfin/.test(this.BASE_URL);
  }

  static #basicAuthHeader() {
    if (!process.env.SF_BASIC_AUTH) {
      consola.error(`Missing environment variable: SF_BASIC_AUTH`);
      process.exit(1);
    }
    return `Basic ${process.env.SF_BASIC_AUTH}`;
  }

  /**
   * Get a new set of tokens for a given firm id
   */
  static async #refreshFirmTokens(axiosInstance, firmId) {
    try {
      consola.debug(`Refreshing tokens for firm ${firmId}`);
      const firmTokens = firmCredentials.getTokenPair(firmId);
      let data = {
        client_id: process.env.SF_API_CLIENT_ID,
        client_secret: process.env.SF_API_SECRET,
        redirect_uri: encodeURIComponent("urn:ietf:wg:oauth:2.0:oob"),
        grant_type: "refresh_token",
        refresh_token: firmTokens.refreshToken,
        access_token: firmTokens.accessToken,
      };
      const response = await axiosInstance.post(
        `${this.BASE_URL}/f/${firmId}/oauth/token`,
        data
      );

      firmCredentials.storeNewTokenPair(firmId, response.data);
      consola.debug(`Refreshed tokens for firm ${firmId}`);

      return true;
    } catch (error) {
      // NOTE: Should we handle the error differently? No response
      if (!error?.response) {
        throw error;
      }

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
}

module.exports = { AxiosFactory };
