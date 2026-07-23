const { firmCredentials } = require("./firmCredentials");
const axios = require("axios");
const { consola } = require("consola");
const pkg = require("../../package.json");

class AxiosFactory {
  constructor() {}

  // Cache of "does this staging host sit behind an HTTP Basic Auth gateway", keyed by host.
  static #basicGateByHost = {};

  // When true, a failed token/API-key refresh (see #handleFailedRefresh) rejects the request
  // with a normal (marked) Error instead of calling process.exit(1). Off by default so every
  // existing single-shot CLI command keeps its current "print + hard exit" behaviour unchanged.
  // Batch callers that run many independent requests in the same process (e.g. `run-test
  // --status`'s Promise.all over handles) opt in via #setSuppressExitOnAuthFailure so that one
  // stale/expired token fails only the request(s) that hit it, instead of killing every other
  // in-flight request in the same batch.
  static suppressExitOnAuthFailure = false;

  /**
   * Toggle whether a failed refresh throws (rejecting only the affected request) instead of
   * calling process.exit(1) (killing the whole process). Intended for batch callers that need to
   * isolate a stale-token failure to a single item instead of aborting everything in flight.
   * @param {Boolean} value
   */
  static setSuppressExitOnAuthFailure(value) {
    this.suppressExitOnAuthFailure = Boolean(value);
  }

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
   * Create an axios instance for a firm's OAuth token endpoint (initial authorize and token refresh).
   * It has no token-refresh interceptor and does not read stored tokens, so it is safe to use during
   * the authorization process when tokens are not available yet.
   *
   * On staging the HTTP Basic Auth header is attached ONLY when the staging gateway actually requires
   * it (see #stagingRequiresBasicAuth). When the gateway is disabled the header is omitted, because
   * Doorkeeper would otherwise mistake the gateway credentials for the OAuth client and reject the
   * request with "unknown client". On production the header is never added.
   * @param {Number} envId - The environment id to create the instance for
   * @returns {Promise<Object>} - The created axios instance
   */
  static async createTokenInstanceForFirm(envId) {
    this.BASE_URL = firmCredentials.getHost();

    const axiosDetails = {
      baseURL: `${this.BASE_URL}/api/v4/f/${envId}`,
      headers: {
        "User-Agent": `silverfin-cli/${pkg.version}`,
        "X-Firm-ID": envId,
      },
    };
    if (await this.#stagingRequiresBasicAuth()) {
      axiosDetails.headers.Authorization = this.#basicAuthHeader();
    }

    return axios.create(axiosDetails);
  }

  // PRIVATE METHODS

  /**
   * Detect whether the current host sits behind an HTTP Basic Auth gateway (only staging hosts can).
   * Such a gateway answers an unauthenticated request with `401 WWW-Authenticate: Basic`. When it is
   * present the OAuth token request needs the Basic header to get through; when it is absent (a staging
   * set up with "disable HTTP basic auth") the header must be omitted, or Doorkeeper reads the gateway
   * credentials as the OAuth client and fails. The result is cached per host.
   * @returns {Promise<Boolean>}
   */
  static async #stagingRequiresBasicAuth() {
    if (!this.#isStaging()) return false;

    const host = firmCredentials.getHost();
    if (Object.hasOwn(this.#basicGateByHost, host)) return this.#basicGateByHost[host];

    let required = false;
    try {
      const response = await axios.get(host, { validateStatus: () => true, maxRedirects: 0, timeout: 10000 });
      required = /basic/i.test(response?.headers?.["www-authenticate"] || "");
    } catch (error) {
      // A Basic challenge can surface as a thrown error depending on the transport; inspect it too.
      // But a transport-level failure (timeout/DNS/TLS) has no response and is indeterminate: never
      // cache it as "gateway disabled", or one transient blip would suppress the Basic header for the
      // rest of the process and break every following token exchange on a gated host. Re-throw so the
      // caller fails loudly and the next attempt re-probes.
      if (!error?.response) {
        throw error;
      }
      required = /basic/i.test(error.response.headers?.["www-authenticate"] || "");
    }

    this.#basicGateByHost[host] = required;
    return required;
  }

  static #createAxiosInstanceForFirms(envId) {
    const firmTokens = firmCredentials.getTokenPair(envId);
    if (!firmTokens) {
      consola.error(`Missing authorization for firm id: ${envId}`);
      process.exit(1);
    }

    const baseHeaders = {
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
    const axiosDetails = {
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

    const axiosDetails = this.#prepareAxiosDetailsForPartners(envId, partnerToken);
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
      const data = {
        client_id: process.env.SF_API_CLIENT_ID,
        client_secret: process.env.SF_API_SECRET,
        redirect_uri: encodeURIComponent("urn:ietf:wg:oauth:2.0:oob"),
        grant_type: "refresh_token",
        refresh_token: firmTokens.refreshToken,
        access_token: firmTokens.accessToken,
      };

      // Token-only instance: no interceptors (avoids a refresh loop) and the Basic header is added
      // only when the staging gateway requires it (otherwise Doorkeeper rejects the refresh).
      const axiosInstance = await this.createTokenInstanceForFirm(firmId);

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

    if (this.suppressExitOnAuthFailure) {
      // Let this specific request fail instead of taking down the whole process, so a caller
      // running many requests in parallel (e.g. a Promise.all batch) can isolate the failure to
      // just the item(s) that hit a stale/expired token.
      const authError = new Error("Authentication error: failed to refresh credentials");
      authError.isAuthFailure = true;
      authError.cause = error;
      throw authError;
    }

    process.exit(1);
  }
}

module.exports = { AxiosFactory };
