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

  // Check if minimum one of the options is used
  if (optionsToCheck.length === 0) {
    let formattedParameters = uniqueParameters.map((parameter) =>
      formatOption(parameter)
    );
    consola.error(
      `One of the following options must be used: ${formattedParameters.join(
        ", "
      )}`
    );
    process.exit(1);
  }

  // Check if the options aren't used together
  if (optionsToCheck.length !== 1) {
    let formattedParameters = uniqueParameters.map((parameter) =>
      formatOption(parameter)
    );
    consola.error(
      "Used incompatible options. Only one of the following options must be used: " +
        formattedParameters.join(", ")
    );
    process.exit(1);
  }

  return true;
}

// Check which options are required in combination with a firm id
function checkRequiredFirmOrPartner(
  options,
  requiredOptions,
  partnerSupported = true
) {
  const firmOrPartnerOptionsUsed = Object.keys(options).some((option) =>
    requiredOptions.includes(option)
  );
  const { firm, partner } = options;

  if (firmOrPartnerOptionsUsed && !firm && !partner) {
    consola.error(
      `A firm${
        partnerSupported ? " or partner id" : ""
      } is required, please use --firm${
        partnerSupported ? " , --partner" : ""
      } or set a default firm id when using this command`
    );

    process.exit(1);
  }

  return true;
}

function getCommandSettings(options) {
  const type = options.partner ? "partner" : "firm";
  const envId = options.partner ? options.partner : options.firm;

  const commandSettings = {
    type,
    envId,
  };

  return commandSettings;
}

function runCommandChecks(
  requiredTemplateOptions,
  options,
  firmIdDefault,
  partnerSupported = true
) {
  if (!partnerSupported && options.partner) {
    consola.error(
      `The option "--partner" is not supported when using "--export-file"`
    );
    process.exit(1);
  }

  checkRequiredFirmOrPartner(
    options,
    requiredTemplateOptions,
    partnerSupported
  );
  checkUniqueOption(requiredTemplateOptions, options);
  const settings = getCommandSettings(options);

  if (!options.yes) {
    promptConfirmation();
  }

  if (settings.type == "firm") {
    checkDefaultFirm(options.firm, firmIdDefault);
  }

  return settings;
}

module.exports = {
  loadDefaultFirmId,
  checkDefaultFirm,
  handleUncaughtErrors,
  promptConfirmation,
  formatOption,
  checkUniqueOption,
  checkRequiredFirmOrPartner,
  getCommandSettings,
  runCommandChecks,
};
