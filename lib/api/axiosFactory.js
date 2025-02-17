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

  /**
   * Create an axios instance for a given environment id (type firm)
   * It will add the necessary headers to handle the authorization, for example Basic Auth for staging.
   * It won't have any token refresh mechanism, and it won't check or load the tokens from the credentials file.
   * It is intended to be used for the authorization process, where tokens could not be available yet.
   * @param {Number} envId - The environment id to create the instance for
   * @returns {Object} - The created axios instance
   */
  static createAuthInstanceForFirm(envId) {
    this.BASE_URL = firmCredentials.getHost();
    return this.#createSimpleAxiosInstanceForFirms(envId);
  }

  // PRIVATE METHODS

  static #createSimpleAxiosInstanceForFirms(envId) {
    let baseHeaders = {
      "User-Agent": `silverfin-cli/${pkg.version}`,
      "X-Firm-ID": envId,
    };

    let axiosDetails = {
      baseURL: `${this.BASE_URL}/api/v4/f/${envId}`,
      headers: {
        ...baseHeaders,
      },
    };
    if (this.#isStaging()) {
      axiosDetails.headers.Authorization = this.#basicAuthHeader();
    }

    return axios.create(axiosDetails);
  }

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
        if (error.response) {
          if (error.response.status === 401) {
            const originalConfig = error.config;
            if (!originalConfig._retry) {
              try {
                // Set _retry to true after trying the first refresh request on 401 status to avoid an infinite loop
                originalConfig._retry = true;

                // Get a refreshed set of tokens
                const firmId = originalConfig.headers["X-Firm-ID"];

                await this.#refreshFirmTokens(firmId);

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
                  axiosInstance.defaults.headers.common["Authorization"] = `Bearer ${firmTokens.accessToken}`;
                  originalConfig.headers.Authorization = `Bearer ${firmTokens.accessToken}`;
                }

                return axiosInstance(originalConfig);
              } catch (_error) {
                return Promise.reject(_error);
              }
            }

            // Refresh failed
            this.#handleFailedRefresh(error);
          }
        }

        // Return any error that is not related to the token
        return Promise.reject(error);
      }
    );

    return axiosInstance;
  }

  static #prepareAxiosDetailsForPartners(envId, partnerToken) {
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

    return axiosDetails;
  }

  static #createAxiosInstanceForPartners(envId) {
    const partnerToken = firmCredentials.getPartnerCredentials(envId)?.token;
    if (!partnerToken) {
      consola.error(`Missing authorization for partner id: ${envId}`);
      process.exit(1);
    }

    let axiosDetails = this.#prepareAxiosDetailsForPartners(envId, partnerToken);
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
          if (error.response.status === 401) {
            if (!originalConfig._retry) {
              try {
                // Set _retry to true after trying the first refresh request on 401 status to avoid an infinite loop
                originalConfig._retry = true;
                const partnerId = originalConfig.params.partner_id;

                await this.#refreshPartnerApiKey(partnerId);

                const newPartnerToken = firmCredentials.getPartnerCredentials(partnerId).token;

                // Set the new access token for current and future requests
                axiosInstance.defaults.params.api_key = newPartnerToken;
                originalConfig.params.api_key = newPartnerToken;

                return axiosInstance(originalConfig);
              } catch (_error) {
                return Promise.reject(_error);
              }
            }

            // Refresh failed
            this.#handleFailedRefresh(error);
          }
        }

        // Return any error that is not related to the token
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
  static async #refreshFirmTokens(firmId) {
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

      // We create an instance without interceptors to avoid an infinite loop
      const axiosInstance = this.#createSimpleAxiosInstanceForFirms(firmId);

      const response = await axiosInstance.post(`${this.BASE_URL}/f/${firmId}/oauth/token`, data);

      firmCredentials.storeNewTokenPair(firmId, response.data);
      consola.debug(`Refreshed tokens for firm ${firmId}`);

      return true;
    } catch (error) {
      this.#handleFailedRefresh(error);
    }
  }

  /**
   * Get a new API key for a given partner id
   */
  static async #refreshPartnerApiKey(partnerId) {
    try {
      consola.debug(`Refreshing API key for partner ${partnerId}`);

      const partnerToken = firmCredentials.getPartnerCredentials(partnerId).token;

      // Create a new instance with not interceptors to avoid an infinite loop
      const newAxiosDetails = this.#prepareAxiosDetailsForPartners(partnerId, partnerToken);
      const newAxiosInstance = axios.create(newAxiosDetails);
      const response = await newAxiosInstance.post(`${this.BASE_URL}/api/partner/v1/refresh_api_key?api_key=${partnerToken}`);

      firmCredentials.storePartnerApiKey(partnerId, response.data.api_key);

      consola.debug(`Refreshed API key for partner ${partnerId}`);

      return true;
    } catch (error) {
      this.#handleFailedRefresh(error);
    }
  }

  static #handleFailedRefresh(error) {
    if (error.response) {
      consola.error(`Response Status: ${error.response.status} (${error.response.statusText})`);
    }
    consola.error(`Error refreshing credentials. Try running the authentication process again`);
    process.exit(1);
  }
}

module.exports = { AxiosFactory };
