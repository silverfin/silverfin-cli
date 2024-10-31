const fs = require("fs");
const path = require("path");
const homedir = require("os").homedir();
const { consola } = require("consola");

/**
 * Class to manage the credentials for the firms
 * @class FirmCredentials
 * @property {Object} data - Object containing the credentials
 * @property {string} data.[firmId].access_token - Access token
 * @property {string} data.[firmId].refresh_token - Refresh token
 * @property {Object} data.defaultFirmIDs - Object containing the default firm IDs for each directory
 * @property {Number} data.defaultFirmIDs.[directory] - Firm ID
 */
class FirmCredentials {
  #SF_FOLDER_PATH = path.resolve(homedir, ".silverfin/");
  #SF_CREDENTIALS_PATH = path.resolve(this.#SF_FOLDER_PATH, "config.json");
  #SF_DEFAULT_HOST = "https://live.getsilverfin.com";
  constructor() {
    this.#createSilverfinDir();
    this.#createCredentialsFile();
    this.loadCredentials();
    this.#checkDefaultValues();
  }

  /** Read credentials from file. It will replace already loaded credendtials */
  loadCredentials() {
    try {
      const credentials = fs.readFileSync(this.#SF_CREDENTIALS_PATH, "utf-8");
      this.data = JSON.parse(credentials);
    } catch (err) {
      this.data = {};
    }
  }

  /** Write all credentials to file */
  saveCredentials() {
    fs.writeFileSync(
      this.#SF_CREDENTIALS_PATH,
      JSON.stringify(this.data, null, 2),
      "utf8",
      (err) => {
        if (err) {
          consola.error(
            new Error(`Error while writing credentials file: ${err}`)
          );
        }
      }
    );
  }

  // FIRM CREDENTIALS

  /** Store new tokens to credentials. It will replace already stored tokens for the firm
   * @param {string} firmId - Firm ID
   * @param {Object} tokens - Object containing `access_token` and `refresh_token`
   */
  storeNewTokenPair(firmId, tokens) {
    this.data[firmId] = this.data[firmId] || {};
    this.data[firmId].accessToken = tokens.access_token || "";
    this.data[firmId].refreshToken = tokens.refresh_token || "";
    this.saveCredentials();
  }

  /**
   * Get the pair of tokens (`access_token` and `refresh_token`) stored for a particular firm
   * @param {Number} firmId
   * @returns {Object} Object containing `access_token` and `refresh_token` or `null` if they don't exists
   */
  getTokenPair(firmId) {
    if (!this.data.hasOwnProperty(firmId)) {
      return null;
    }
    return this.data[firmId];
  }

  /** Store firm name for a particular firm */
  storeFirmName(firmId, firmName) {
    this.data[firmId] = this.data[firmId] || {};
    this.data[firmId].firmName = firmName;
    this.saveCredentials();
  }

  /** Get the firm name if it has been previously stored */
  getFirmName(firmId) {
    if (!this.data.hasOwnProperty(firmId) || !this.data[firmId].firmName) {
      return null;
    }
    return this.data[firmId].firmName;
  }

  /** Store default firm id for the current directory
   * @param {Number} firmId
   */
  setDefaultFirmId(firmId) {
    const currentDirectory = path.basename(process.cwd());
    this.data.defaultFirmIDs[currentDirectory] = firmId;
    this.saveCredentials();
  }

  /** Get default firm id for the current directory
   * @returns {Number} Firm ID or `null` if it doesn't exists
   */
  getDefaultFirmId() {
    const currentDirectory = path.basename(process.cwd());
    if (!this.data.defaultFirmIDs.hasOwnProperty(currentDirectory)) {
      return null;
    }
    return this.data.defaultFirmIDs[currentDirectory];
  }

  /**
   * Get all firms which have a pair of tokens stored
   * @returns {Array} Array of [`firm ID`, `firm name`]
   */
  listAuthorizedFirms() {
    return Object.keys(this.data)
      .filter(
        (element) =>
          element !== "defaultFirmIDs" && element !== "partnerCredentials"
      )
      .map((element) => [element, this.data[element].firmName]);
  }

  // PARTNER CREDENTIALS

  /** Store new tokens to credentials. It will replace already stored tokens for the firm
   * @param {Number} partner_id - Partner environment ID
   * @param {string} partnerName - Partner environment name
   * @param {string} apiKey - string containing the api_key from the partner environment (user specific)
   *
   * @returns {Boolean} `true` if the credentials were stored successfully, `false` otherwise
   */
  storePartnerApiKey(partnerId, apiKey, partnerName = null) {
    try {
      if (!this.data.hasOwnProperty("partnerCredentials")) {
        this.data.partnerCredentials = {};
      }

      const storedPartnerName = this.data.partnerCredentials[partnerId]?.name;

      this.data.partnerCredentials[partnerId] = {
        name: partnerName ? partnerName : storedPartnerName,
        token: apiKey,
      };
      this.saveCredentials();

      return true;
    } catch (err) {
      consola.error(`Error while storing partner credentials: ${err}`);
      process.exit(1);
    }
  }

  /**
   * Get the token (api_key) and name stored for a particular partner environment
   * @param {Number} partner_id
   * @returns {Object} Object containing `name` and `token` or `null` if they don't exist
   */
  getPartnerCredentials(partner_id) {
    if (
      !this.data.hasOwnProperty("partnerCredentials") ||
      !this.data.partnerCredentials.hasOwnProperty(partner_id)
    ) {
      const existingPartners = this.listAuthorizedPartners();
      consola.error(`Missing authorization for partner id: ${partner_id}`);
      consola.log(`Only found partner ids for:`);
      existingPartners.forEach((item) =>
        consola.log(`${item.id}${item.name ? " - " + item.name : ""}`)
      );
      process.exit(1);
    }

    return {
      id: partner_id,
      ...this.data.partnerCredentials[partner_id],
    };
  }

  /**
   * Get all partners which have API keys stored
   * @returns {Array} Array of [`partner ID`, `partner name`]
   */
  listAuthorizedPartners() {
    if (this.data.hasOwnProperty("partnerCredentials")) {
      const partners = Object.keys(this.data.partnerCredentials).map(
        (element) => {
          const partnerInfo = {
            id: element,
            name: this.data.partnerCredentials[element].name,
          };
          return partnerInfo;
        }
      );

      return partners;
    }

    return [];
  }

  /**
   * Store the host for the Silverfin environment
   * @param {string} host - Host URL
   */
  setHost(host) {
    this.data.host = host;
    this.saveCredentials();
  }

  /**
   * Get the host for the Silverfin environment
   * The host can be set as an environmental variable `SF_HOST`, can be set using the `setHost` method
   * or it will default to `https://live.getsilverfin.com`
   * @returns {string} Host URL
   */
  getHost() {
    const env_host = process.env.SF_HOST;
    return env_host ? env_host : this.data.host;
  }

  // PRIVATE METHODS

  /** Create `.silverfin` folder in home directory if it doesn't exist yet
   * @private
   */
  #createSilverfinDir() {
    if (!fs.existsSync(this.#SF_FOLDER_PATH)) {
      fs.mkdirSync(this.#SF_FOLDER_PATH);
    }
  }

  /** Create a file to store the credentials if it doesn't exist yet
   * @private
   */
  #createCredentialsFile() {
    if (!fs.existsSync(this.#SF_CREDENTIALS_PATH)) {
      this.data = {
        defaultFirmIDs: {},
        host: this.#SF_DEFAULT_HOST,
      };
      this.saveCredentials();
    }
  }

  /** Create `DefaultFirmIDs` and `host` if missing (for legacy compatibility of existing files)
   * @private
   */
  #checkDefaultValues() {
    if (!this.data.hasOwnProperty("defaultFirmIDs")) {
      this.data.defaultFirmIDs = {};
    }
    if (!this.data.hasOwnProperty("host")) {
      this.data.host = this.#SF_DEFAULT_HOST;
    }
  }
}

// Initiate Object
const firmCredentials = new FirmCredentials();
module.exports = { firmCredentials };
