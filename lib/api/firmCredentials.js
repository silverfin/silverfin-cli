const fs = require("fs");
const path = require("path");
const homedir = require("os").homedir();

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
  constructor() {
    this.#createSilverfinDir();
    this.#createCredentialsFile();
    this.loadCredentials();
    this.#checkDefaultFirmsObject();
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
          console.log(`Error while writing credentials file: ${err}`);
        }
      }
    );
  }

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
      .filter((element) => element !== "defaultFirmIDs")
      .map((element) => [element, this.data[element].firmName]);
  }

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
      this.data = { defaultFirmIDs: {} };
      this.saveCredentials();
    }
  }

  /** Create `DefaultFirmIDs` if missing (for legacy compatibility of existing files)
   * @private
   */
  #checkDefaultFirmsObject() {
    if (!this.data.hasOwnProperty("defaultFirmIDs")) {
      this.data.defaultFirmIDs = {};
    }
  }
}

// Initiate Object
const firmCredentials = new FirmCredentials();
module.exports = { firmCredentials };
