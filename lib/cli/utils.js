const errorUtils = require("../utils/errorUtils");
const prompt = require("prompt-sync")({ sigint: true });
const { firmCredentials } = require("../api/firmCredentials");
const { consola } = require("consola");

// Load default firm id from Config Object or ENV
function loadDefaultFirmId() {
  let firmIdDefault = undefined;
  let firmStoredConfig = firmCredentials.getDefaultFirmId();
  if (firmStoredConfig) {
    firmIdDefault = firmStoredConfig;
  }
  // Legacy support, we shouldn't use the firm id from ENV anymore
  if (!firmIdDefault && process.env.SF_FIRM_ID) {
    firmIdDefault = process.env.SF_FIRM_ID;
  }
  return firmIdDefault;
}

function checkDefaultFirm(firmUsed, firmIdDefault) {
  if (firmUsed === firmIdDefault) {
    consola.info(`Firm ID to be used: ${firmIdDefault}`);
  }
}

// Uncaught Errors
function handleUncaughtErrors() {
  process
    .on("uncaughtException", (err) => {
      errorUtils.uncaughtErrors(err);
    })
    .on("unhandledRejection", (err) => {
      errorUtils.uncaughtErrors(err);
    });
}

// Prompt Confirmation
function promptConfirmation() {
  const confirm = prompt(
    "This will overwrite existing templates. Do you want to proceed? (y/n): "
  );
  if (confirm.toLocaleLowerCase() !== "yes" && confirm.toLowerCase() !== "y") {
    consola.warn("Operation cancelled");
    process.exit(1);
  }
  return true;
}

// Convert variable name into flag name to show in message (listAll -> list-all)
function formatOption(inputString) {
  return inputString
    .split("")
    .map((character) => {
      if (character == character.toUpperCase()) {
        return "-" + character.toLowerCase();
      } else {
        return character;
      }
    })
    .join("");
}

// Check unique options
function checkUniqueOption(uniqueParameters = [], options) {
  const optionsToCheck = Object.keys(options).filter((element) => {
    if (uniqueParameters.includes(element)) {
      return true;
    }
  });
  if (optionsToCheck.length !== 1) {
    let formattedParameters = uniqueParameters.map((parameter) =>
      formatOption(parameter)
    );
    consola.error(
      "Only one of the following options must be used: " +
        formattedParameters.join(", ")
    );
    process.exit(1);
  }
}

// Check all options are used together (or none)
function checkUsedTogether(parameters = [], options) {
  const optionsToCheck = Object.keys(options).filter((element) => {
    if (parameters.includes(element)) {
      return true;
    }
  });
  if (
    optionsToCheck.length !== parameters.length &&
    optionsToCheck.length !== 0
  ) {
    let formattedParameters = parameters.map((parameter) =>
      formatOption(parameter)
    );
    consola.error(
      "The following options must be used together: " +
        formattedParameters.join(", ")
    );
    process.exit(1);
  }
}

module.exports = {
  loadDefaultFirmId,
  checkDefaultFirm,
  handleUncaughtErrors,
  promptConfirmation,
  formatOption,
  checkUniqueOption,
  checkUsedTogether,
};
