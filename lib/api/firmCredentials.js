const fs = require("fs");
const path = require("path");
const homedir = require("os").homedir();
const { consola } = require("consola");
const errorUtils = require("../utils/errorUtils");

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
  #loadFailed = false;
  SF_DEFAULT_HOST = "https://live.getsilverfin.com";
  constructor() {
    this.#createSilverfinDir();
    this.#createCredentialsFile();
    this.loadCredentials();
    this.#checkDefaultValues();
  }

  /** Record a failed load: keep the CLI usable with empty in-memory defaults, but mark the
   * state so `saveCredentials()` refuses to persist it.
   * @param {string} reason Why the load failed, already formatted for display
   * @private
   */
  #failLoad(reason) {
    // defaultFirmIDs must exist: setDefaultFirmId() writes into it unconditionally, with no
    // guard the way other per-firm lookups have.
    this.data = { defaultFirmIDs: {}, host: this.SF_DEFAULT_HOST };
    this.#loadFailed = true;
    errorUtils.credentialsFileNotLoaded(this.#SF_CREDENTIALS_PATH, reason);
  }

  /** Read credentials from file. It will replace already loaded credendtials.
   * On a read/parse failure, or a file that doesn't contain a JSON object, logs the error and
   * falls back to an empty in-memory object so unrelated commands keep working -
   * `saveCredentials()` then refuses to persist that empty state, so the failure can't silently
   * discard every firm's stored tokens.
   */
  loadCredentials() {
    this.#loadFailed = false;

    let credentials;
    try {
      credentials = fs.readFileSync(this.#SF_CREDENTIALS_PATH, "utf-8");
    } catch (err) {
      consola.debug(err);
      this.#failLoad(`the file could not be read (${err.message})`);
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(credentials);
    } catch (err) {
      consola.debug(err);
      this.#failLoad(`the file is not valid JSON (${err.message})`);
      return;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      this.#failLoad(`the file does not contain a JSON object`);
      return;
    }

    this.data = parsed;
  }

  /** Write all credentials to file.
   * @returns {boolean} False if the last `loadCredentials()` call failed (the in-memory data is
   * an empty placeholder in that case, and writing it would discard every firm's stored tokens)
   * or the write itself failed; true on success.
   */
  saveCredentials() {
    if (this.#loadFailed) {
      return errorUtils.credentialsFileNotSaved(this.#SF_CREDENTIALS_PATH);
    }
    try {
      fs.writeFileSync(this.#SF_CREDENTIALS_PATH, JSON.stringify(this.data, null, 2), "utf8");
      return true;
    } catch (err) {
      consola.debug(err);
      return errorUtils.credentialsFileWriteFailed(this.#SF_CREDENTIALS_PATH, err);
    }
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
    return this.saveCredentials();
  }

  /**
   * Get the pair of tokens (`access_token` and `refresh_token`) stored for a particular firm
   * @param {Number} firmId
   * @returns {Object} Object containing `access_token` and `refresh_token` or `null` if they don't exists
   */
  getTokenPair(firmId) {
    if (!Object.hasOwn(this.data, firmId)) {
      return null;
    }
    return this.data[firmId];
  }

  /** Store firm name for a particular firm */
  storeFirmName(firmId, firmName) {
    this.data[firmId] = this.data[firmId] || {};
    this.data[firmId].firmName = firmName;
    return this.saveCredentials();
  }

  /** Get the firm name if it has been previously stored */
  getFirmName(firmId) {
    if (!Object.hasOwn(this.data, firmId) || !this.data[firmId].firmName) {
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
    return this.saveCredentials();
  }

  /** Get default firm id for the current directory
   * @returns {Number} Firm ID or `null` if it doesn't exists
   */
  getDefaultFirmId() {
    const currentDirectory = path.basename(process.cwd());
    if (!Object.hasOwn(this.data.defaultFirmIDs, currentDirectory)) {
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
      .filter((element) => element !== "defaultFirmIDs" && element !== "partnerCredentials")
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
      if (!Object.hasOwn(this.data, "partnerCredentials")) {
        this.data.partnerCredentials = {};
      }

      const storedPartnerName = this.data.partnerCredentials[partnerId]?.name;

      this.data.partnerCredentials[partnerId] = {
        name: partnerName ? partnerName : storedPartnerName,
        token: apiKey,
      };
      if (!this.saveCredentials()) {
        return false;
      }

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
    if (!Object.hasOwn(this.data, "partnerCredentials") || !Object.hasOwn(this.data.partnerCredentials, partner_id)) {
      const existingPartners = this.listAuthorizedPartners();
      consola.error(`Missing authorization for partner id: ${partner_id}`);
      consola.log(`Only found partner ids for:`);
      existingPartners.forEach((item) => consola.log(`${item.id}${item.name ? " - " + item.name : ""}`));
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
    if (Object.hasOwn(this.data, "partnerCredentials")) {
      const partners = Object.keys(this.data.partnerCredentials).map((element) => {
        const partnerInfo = {
          id: element,
          name: this.data.partnerCredentials[element].name,
        };
        return partnerInfo;
      });

      return partners;
    }

    return [];
  }

  /**
   * Store the host for the Silverfin environment
   * @param {string} host - Host URL
   */
  setHost(host) {
    this.data.host = host.toString().trim();
    return this.saveCredentials();
  }

  /**
   * Get the host for the Silverfin environment
   * The host can be set as an environmental variable `SF_HOST`, can be set using the `setHost` method
   * or it will default to `https://live.getsilverfin.com`
   * @returns {string} Host URL
   */
  getHost() {
    const envHost = process.env.SF_HOST;
    return envHost ? envHost : this.data.host;
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
        host: this.SF_DEFAULT_HOST,
      };
      this.saveCredentials();
    }
  }

  /** Create `DefaultFirmIDs` and `host` if missing (for legacy compatibility of existing files)
   * @private
   */
  #checkDefaultValues() {
    if (!Object.hasOwn(this.data, "defaultFirmIDs")) {
      this.data.defaultFirmIDs = {};
    }
    if (!Object.hasOwn(this.data, "host")) {
      this.data.host = this.SF_DEFAULT_HOST;
    }
  }
}

// Initiate Object
const firmCredentials = new FirmCredentials();
module.exports = { firmCredentials };
