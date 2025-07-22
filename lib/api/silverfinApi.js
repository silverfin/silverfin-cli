const { consola } = require("consola");
const { BaseApi } = require("./baseApi");
const { AuthenticationApi } = require("./authenticationApi");
const { ReconciliationTextsApi } = require("./reconciliationTextsApi");
const { SharedPartsApi } = require("./sharedPartsApi");
const { ExportFilesApi } = require("./exportFilesApi");
const { AccountTemplatesApi } = require("./accountTemplatesApi");
const { LiquidTestingApi } = require("./liquidTestingApi");
const { CompanyDataApi } = require("./companyDataApi");

class SilverfinApi extends BaseApi {
  constructor() {
    super();
    this.#checkRequiredEnvVariables();
    this.authentication = new AuthenticationApi(this);
    this.reconciliationTexts = new ReconciliationTextsApi(this);
    this.sharedParts = new SharedPartsApi(this);
    this.exportFiles = new ExportFilesApi(this);
    this.accountTemplates = new AccountTemplatesApi(this);
    this.testing = new LiquidTestingApi(this);
    this.companyData = new CompanyDataApi(this);
  }

  #checkRequiredEnvVariables() {
    const missingVariables = ["SF_API_CLIENT_ID", "SF_API_SECRET"].filter((key) => !process.env[key]);
    if (missingVariables.length) {
      consola.error(`Error: Missing API credentials: [${missingVariables}]`);
      consola.log(`Credentials should be defined as environmental variables.`);
      consola.log(`Call export ${missingVariables[0]}=...`);
      consola.log(`If you don't have credentials yet, you need to register your app with Silverfin to get them`);
      process.exit(1);
    }
  }
}

module.exports = { SilverfinApi };
