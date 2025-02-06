const { firmCredentials } = require("../api/firmCredentials");
const { consola } = require("consola");

function checkAuthorizePartners(partner_id) {
  const partnerCredentials = firmCredentials.getPartnerCredentials(partner_id);

  return partnerCredentials;
}

function checkRequiredEnvVariables() {
  const missingVariables = ["SF_API_CLIENT_ID", "SF_API_SECRET"].filter((key) => !process.env[key]);
  if (missingVariables.length) {
    consola.error(`Error: Missing API credentials: [${missingVariables}]`);
    consola.log(`Credentials should be defined as environmental variables.`);
    consola.log(`Call export ${missingVariables[0]}=...`);
    consola.log(`If you don't have credentials yet, you need to register your app with Silverfin to get them`);
    process.exit(1);
  }
}

function responseSuccessHandler(response) {
  if (response?.status) {
    consola.debug(
      `Response Status: ${response.status} (${response?.statusText}) - method: ${response?.config?.method || response?.method} - url: ${response?.config?.url || response?.url}`
    );
  }
}

async function responseErrorHandler(error) {
  if (error && error.response) {
    consola.debug(`Response Status: ${error.response.status} (${error.response.statusText}) - method: ${error.response.config.method} - url: ${error.response.config.url}`);
  }
  if (error?.response) {
    // Valid Request. Not Found
    if (error.response.status === 404) {
      consola.error(`Response Error (404): ${JSON.stringify(error.response.data.error)}`);
      return;
    }
    // Bad Request
    if (error.response.status === 400) {
      consola.error(`Response Error (400): ${JSON.stringify(error.response.data.error)}`);
      return;
    }
    // Unprocessable Entity
    if (error.response.status === 422) {
      consola.error(`Response Error (422): ${JSON.stringify(error.response.data)}`, "\n", `You don't have the rights to update the previous parameters`);
      process.exit(1);
    }
    if (error.response.status === 401) {
      consola.debug(`Response Error (401): ${JSON.stringify(error.response.data)}`);
    }
    // Forbidden
    if (error.response.status === 403) {
      consola.error("Error (403): Forbidden access. Terminating process");
      process.exit(1);
    }
  }
  // Not handled
  throw error;
}

module.exports = {
  checkAuthorizePartners,
  checkRequiredEnvVariables,
  responseSuccessHandler,
  responseErrorHandler,
};
