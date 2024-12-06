const { firmCredentials } = require("../api/firmCredentials");
const prompt = require("prompt-sync")({ sigint: true });
const axios = require("axios");
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
    await this.#promptForAuthCode(firmIdUser);
  }

  // PRIVATE METHODS

  static async #promptForId(firmId = undefined) {
    consola.info(
      `NOTE: if you need to exit this process you can press "Ctrl/Cmmd + C"`
    );

    let firmIdPrompt;
    if (firmId) {
      firmIdPrompt = prompt(
        `Enter the firm ID (leave blank to use ${firmId}): `,
        { value: firmId }
      );
    } else {
      firmIdPrompt = prompt("Enter the firm ID: ");
    }
    return firmIdPrompt.trim();
  }

  static async #openBrowser(firmId) {
    consola.info(`You need to authorize your APP in the browser now`);

    const redirectUri = encodeURIComponent("urn:ietf:wg:oauth:2.0:oob");
    const scope = encodeURIComponent(
      "administration:read administration:write financials:read financials:write workflows:read"
    );
    const SF_API_CLIENT_ID = process.env.SF_API_CLIENT_ID;
    const url = `${this.BASE_URL}/f/${firmId}/oauth/authorize?client_id=${SF_API_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;

    await open(url);
  }

  static async #promptForAuthCode(firmId) {
    try {
      consola.log("Insert your credentials...");
      const authCode = prompt("Enter your API authorization code: ", {
        echo: "*",
      });

      const tokens = await this.#getFirmAccessToken(firmId, authCode);
      if (tokens) {
        consola.success("Authentication successful");
      }
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
      let requestDetails = {
        method: "POST",
        url: `${this.BASE_URL}/f/${firmId}/oauth/token?client_id=${SF_API_CLIENT_ID}&client_secret=${SF_API_SECRET}&redirect_uri=${redirectUri}&grant_type=${grantType}&code=${authCode}`,
      };
      const response = await axios(requestDetails);

      firmCredentials.storeNewTokenPair(firmId, response.data);

      await this.#getFirmName(firmId);

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

  /**
   * Retrieve firm details and store the firm name in the credentials file
   * @param {Number} firmId
   */
  static async #getFirmName(firmId) {
    try {
      const response = await axios.get(`/user/firm`);
      if (response && response.data) {
        firmCredentials.storeFirmName(firmId, response.data.name);
      }
    } catch (error) {}
  }

  static #missingFirmIdMessage() {
    consola.error("Firm ID is missing. Please provide a valid one.");
    process.exit(1);
  }
}

module.exports = { SilverfinAuthorizer };
