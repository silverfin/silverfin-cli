const fs = require("fs");
const path = require("path");

// Location
const homedir = require("os").homedir();
const sfFolder = path.resolve(homedir, ".silverfin/");
if (!fs.existsSync(sfFolder)) {
  fs.mkdirSync(sfFolder);
}

class Config {
  constructor() {
    try {
      this.path = path.resolve(homedir, ".silverfin/config.json");
      const fileData = fs.readFileSync(this.path, "utf-8");
      this.data = JSON.parse(fileData);
    } catch (err) {
      this.data = { defaultFirmIDs: {} };
    }
  }

  // Write file
  saveConfig() {
    fs.writeFileSync(
      this.path,
      JSON.stringify(this.data, null, 2),
      "utf8",
      (err) => {
        if (err) {
          console.log(`Error while writing config file: ${err}`);
        } else {
          console.log(`Config file was written successfully`);
        }
      }
    );
  }

  // Store new tokens to config
  // { firmId: {accessToken: string, refreshToken: string}}
  storeNewTokens(responseTokens, firmId) {
    if (responseTokens) {
      this.data[firmId] = {
        accessToken: responseTokens.data.access_token,
        refreshToken: responseTokens.data.refresh_token,
      };
      this.saveConfig();
    }
  }

  // Get Access Token
  getTokens(firmId) {
    this.checkDefaultFirmsObject();
    if (this.data.hasOwnProperty(firmId)) {
      return this.data[firmId];
    } else {
      return null;
    }
  }

  // Set default firm id
  setFirmId(firmId) {
    this.checkDefaultFirmsObject();
    const currentDirectory = path.basename(process.cwd());
    this.data.defaultFirmIDs[currentDirectory] = firmId;
    this.saveConfig();
  }

  // Get default firm id
  getFirmId() {
    this.checkDefaultFirmsObject();
    const currentDirectory = path.basename(process.cwd());
    if (this.data.defaultFirmIDs.hasOwnProperty(currentDirectory)) {
      return this.data.defaultFirmIDs[currentDirectory];
    } else {
      return null;
    }
  }

  // Create DefaultFirmIDs (for legacy compatibility of existing files)
  checkDefaultFirmsObject() {
    if (!this.data.hasOwnProperty("defaultFirmIDs")) {
      this.data.defaultFirmIDs = {};
    }
  }
}

// Initiate Object
const config = new Config();

module.exports = { config };
