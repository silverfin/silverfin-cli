const errorUtils = require("../utils/errorUtils");
const templateUtils = require("../utils/templateUtils");
const prompt = require("prompt-sync")({ sigint: true });
const { firmCredentials } = require("../api/firmCredentials");
const { consola } = require("consola");

// Load default firm id from Config Object or ENV
function loadDefaultFirmId() {
  let firmIdDefault = undefined;
  const firmStoredConfig = firmCredentials.getDefaultFirmId();
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
  const confirm = prompt("This will overwrite existing templates. Do you want to proceed? (y/n): ");
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

// Check that a date is provided as YYYY-MM-DD and that it is a real calendar date
function checkDateFormat(dateString) {
  if (typeof dateString !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    errorUtils.invalidDateFormat(dateString);
    process.exit(1);
  }

  // A regex match is not enough (e.g. 2024-02-31), so we check it round-trips
  const parsedDate = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dateString) {
    errorUtils.impossibleDate(dateString);
    process.exit(1);
  }

  return true;
}

// Stop the CLI when an id provided on the command line is not a positive integer. Whether the id is
// required is decided by checkRequiredFirmOrPartner, so an absent one passes through untouched.
// Leading zeros are rejected because the id is used as text, not as a number: it is interpolated
// into the request URL and used as the key the tokens are stored under, so "007" and "7" are two
// different firms as far as the credentials file is concerned
// @param {string|number} id The id provided by the user
// @param {string} label How to name the id in the error message (e.g. "firm id").
//   Always written here in the CLI, never taken from user input
function checkNumericIdFormat(id, label) {
  if (id === undefined || id === null) {
    return true;
  }

  if (!/^[1-9]\d*$/.test(String(id))) {
    errorUtils.invalidNumericId(id, label);
    process.exit(1);
  }

  return true;
}

// Stop the CLI when a handle provided on the command line cannot be used to build a file path.
// What makes a handle usable is decided by templateUtils.fileNameProblem and how the failure
// reads is decided by errorUtils. This only picks between the two messages and stops, since
// there is nothing left to run without a handle
// @param {string} handle The handle provided by the user
// @param {string} label How to name the handle in the error message (e.g. "workflow handle").
//   Always written here in the CLI, never taken from user input
// @param {string} [suggestedCommand] A command which lists the handles available, so the user
//   is told how to find a valid one instead of only that this one is wrong
function checkHandleFormat(handle, label, suggestedCommand) {
  const problem = templateUtils.fileNameProblem(handle);
  if (!problem) {
    return true;
  }

  // A blank handle usually means an unset variable was passed on (e.g. --handle "$HANDLE"),
  // which is worth saying instead of listing the characters a handle cannot contain
  if (problem === templateUtils.FILE_NAME_PROBLEMS.BLANK) {
    errorUtils.missingHandle(label, suggestedCommand);
  } else {
    errorUtils.invalidHandleFormat(handle, label, suggestedCommand);
  }
  process.exit(1);
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
    const formattedParameters = uniqueParameters.map((parameter) => formatOption(parameter));
    consola.error(`One of the following options must be used: ${formattedParameters.join(", ")}`);
    process.exit(1);
  }

  // Check if the options aren't used together
  if (optionsToCheck.length !== 1) {
    const formattedParameters = uniqueParameters.map((parameter) => formatOption(parameter));
    consola.error("Used incompatible options. Only one of the following options must be used: " + formattedParameters.join(", "));
    process.exit(1);
  }

  return true;
}

// Check which options are required in combination with a firm id
function checkRequiredFirmOrPartner(options, requiredOptions, partnerSupported = true) {
  const firmOrPartnerOptionsUsed = Object.keys(options).some((option) => requiredOptions.includes(option));
  const { firm, partner } = options;

  if (firmOrPartnerOptionsUsed && !firm && !partner) {
    consola.error(
      `A firm${partnerSupported ? " or partner id" : ""} is required, please use --firm${partnerSupported ? " , --partner" : ""} or set a default firm id when using this command`
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

function runCommandChecks(requiredTemplateOptions, options, firmIdDefault, messageRequired = false, skipConfirmation = false) {
  if (options.partner) {
    if (messageRequired && !options.message) {
      consola.error(`Message required when updating a partner template. Please use "--message"`);
      process.exit(1);
    }
  }

  checkRequiredFirmOrPartner(options, requiredTemplateOptions);
  checkUniqueOption(requiredTemplateOptions, options);
  checkNumericIdFormat(options.firm, "firm id");
  checkNumericIdFormat(options.partner, "partner id");
  const settings = getCommandSettings(options);

  // Ask for a confirmation if the user has not confirmed with --yes, unless the skipConfirmation is true
  if (!options.yes && !skipConfirmation) {
    promptConfirmation();
  }

  if (settings.type == "firm") {
    checkDefaultFirm(options.firm, firmIdDefault);
  }

  return settings;
}

function logCurrentHost() {
  const currentHost = firmCredentials.getHost();
  if (currentHost === firmCredentials.SF_DEFAULT_HOST) {
    return;
  }
  const hostDetails = `Current host: ${currentHost}.`;

  consola.info(hostDetails);
}

function checkPartnerSupport(options) {
  if (options.partner && options.all) {
    consola.error("Not possible to update all templates at once in a partner environment.");
    process.exit(1);
  }
}

module.exports = {
  loadDefaultFirmId,
  checkDefaultFirm,
  handleUncaughtErrors,
  promptConfirmation,
  formatOption,
  checkDateFormat,
  checkHandleFormat,
  checkNumericIdFormat,
  checkUniqueOption,
  checkRequiredFirmOrPartner,
  getCommandSettings,
  runCommandChecks,
  logCurrentHost,
  checkPartnerSupport,
};
