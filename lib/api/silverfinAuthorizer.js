const { firmCredentials } = require("../api/firmCredentials");
const prompt = require("prompt-sync")({ sigint: true });
const { AxiosFactory } = require("./axiosFactory");
const open = require("open");
const { consola } = require("consola");

class SilverfinAuthorizer {
  constructor() {}

  /**
   * Authorize a firm by providing the firm ID
   * It will prompt for the firm ID, open the browser for authorization and prompt for the authorization code
   * It will reach for the access and refresh tokens and store them in the credentials file
   * It will also store the firm name in the credentials file
   * @param {Number} firmId
   */
  static async authorizeFirm(firmId = undefined) {
    this.BASE_URL = firmCredentials.getHost();

    const firmIdUser = await this.#promptForId(firmId);
    !firmIdUser ? this.#missingFirmIdMessage() : null;

    await this.#openBrowser(firmIdUser);
    const authCode = await this.#promptForAuthCode();

    const tokens = await this.#getFirmAccessToken(firmIdUser, authCode);

    if (tokens) {
      consola.success("Authentication successful");
    }

    await this.#getFirmName(firmIdUser);
  }

  /**
   * Refresh the tokens for a firm
   * It will store the new tokens in the credentials file
   * @param {Number} firmId
   * @returns {Boolean} It will return true if the tokens were refreshed successfully
   */
  static async refreshFirm(firmId) {
    try {
      const firmTokens = firmCredentials.getTokenPair(firmId);
      if (!firmTokens) {
        consola.error(`Firm ${firmId} is not authorized. Please authorize the firm first`);
        process.exit(1);
      }

      const BASE_URL = firmCredentials.getHost();
      const data = {
        client_id: process.env.SF_API_CLIENT_ID,
        client_secret: process.env.SF_API_SECRET,
        redirect_uri: encodeURIComponent("urn:ietf:wg:oauth:2.0:oob"),
        grant_type: "refresh_token",
        refresh_token: firmTokens.refreshToken,
        access_token: firmTokens.accessToken,
      };
      const instance = AxiosFactory.createInstance("firm", firmId);
      const response = await instance.post(`${BASE_URL}/f/${firmId}/oauth/token`, data);

      firmCredentials.storeNewTokenPair(firmId, response.data);

      return true;
    } catch (error) {
      if (error.response) {
        const description = error?.response?.data?.error_description || error?.request?.data;

        consola.error(
          `Response Status: ${error.response.status} (${error.response.statusText})`,
          description ? `\nError description: ${description}` : "",
          "\nError refreshing the tokens. Try running the authentication process again"
        );
      }
      process.exit(1);
    }
  }

  /**
   * Refresh the Partner API Keys
   * It will store the new token in the credentials file
   * @param {Number} partnerId
   * @returns {Boolean} It will return true if the API Key was refreshed successfully
   */
  static async refreshPartner(partnerId) {
    try {
      const partnerCredentials = firmCredentials.getPartnerCredentials(partnerId);

      if (!partnerCredentials) {
        consola.error(`Partner ${partnerId} is not authorized. Please authorize the partner first`);
        process.exit(1);
      }

      const BASE_URL = firmCredentials.getHost();
      const instance = AxiosFactory.createInstance("partner", partnerId);
      const response = await instance.post(`${BASE_URL}/api/partner/v1/refresh_api_key?api_key=${partnerCredentials.token}`);

      firmCredentials.storePartnerApiKey(partnerId, response.data.api_key, partnerCredentials?.name);

      return true;
    } catch (error) {
      if (error.response) {
        consola.error(`Response Status: ${error.response.status} (${error.response.statusText}). An error occurred trying to refresh the partner API key`);
      }
      process.exit(1);
    }
  }

  // PRIVATE METHODS

  static async #promptForId(firmId = undefined) {
    consola.info(`NOTE: if you need to exit this process you can press "Ctrl/Cmmd + C"`);

    let firmIdPrompt;
    if (firmId) {
      firmIdPrompt = prompt(`Enter the firm ID (leave blank to use ${firmId}): `, { value: firmId });
    } else {
      firmIdPrompt = prompt("Enter the firm ID: ");
    }
    return firmIdPrompt.trim();
  }

  static async #openBrowser(firmId) {
    consola.info(`You need to authorize your APP in the browser now`);

    const redirectUri = encodeURIComponent("urn:ietf:wg:oauth:2.0:oob");
    const scope = encodeURIComponent("administration:read administration:write financials:read financials:write workflows:read");
    const SF_API_CLIENT_ID = process.env.SF_API_CLIENT_ID;
    const url = `${this.BASE_URL}/f/${firmId}/oauth/authorize?client_id=${SF_API_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;

    await open(url);
  }

  static async #promptForAuthCode() {
    try {
      consola.log("Insert your credentials...");
      const authCode = prompt("Enter your API authorization code: ", {
        echo: "*",
      });
      return authCode.trim();
    } catch (error) {
      consola.error(error);
      process.exit(1);
    }
  }

  // Get Tokens for the first time with an authorization code
  static async #getFirmAccessToken(firmId, authCode) {
    try {
      const grantType = "authorization_code";
      const redirectUri = encodeURIComponent("urn:ietf:wg:oauth:2.0:oob");
      const SF_API_CLIENT_ID = process.env.SF_API_CLIENT_ID;
      const SF_API_SECRET = process.env.SF_API_SECRET;
      const url = `${this.BASE_URL}/f/${firmId}/oauth/token?client_id=${SF_API_CLIENT_ID}&client_secret=${SF_API_SECRET}&redirect_uri=${redirectUri}&grant_type=${grantType}&code=${authCode}`;

      const instance = AxiosFactory.createAuthInstanceForFirm(firmId);
      const response = await instance.post(url);

      firmCredentials.storeNewTokenPair(firmId, response.data);

      return true;
    } catch (error) {
      consola.error(`Response Status: ${error.response.status} (${error.response.statusText})`);
      consola.error(`Error description: ${JSON.stringify(error.response.data.error_description)}`);
      process.exit(1);
    }
  }

  /**
   * Retrieve firm details and store the firm name in the credentials file
   * @param {Number} firmId
   */
  static async #getFirmName(firmId) {
    try {
      const instance = AxiosFactory.createInstance("firm", firmId);
      const response = await instance.get(`/user/firm`);
      if (response && response.data) {
        firmCredentials.storeFirmName(firmId, response.data.name);
      }
    } catch (error) {
      consola.debug("Failed to fetch firm name:", error.message);
    }
  }

  static #missingFirmIdMessage() {
    consola.error("Firm ID is missing. Please provide a valid one.");
    process.exit(1);
  }
}

module.exports = { SilverfinAuthorizer };
