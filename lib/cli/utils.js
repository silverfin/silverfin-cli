const errorUtils = require("../utils/errorUtils");
const fsUtils = require("../utils/fsUtils");
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

// @returns {string|undefined} The first problem found, undefined when the options are usable
function samplerOptionsProblem(options) {
  for (const flag of ["addDiffsFolder", "extractFlaggedOnly"]) {
    if (options[flag] && !options.fromZip) return `--${formatOption(flag)} requires --from-zip <path>`;
  }
  // Both are written while printing the compact diff, which only a --compact or --from-zip run does
  for (const flag of ["keepExtracted", "json"]) {
    if (options[flag] && !options.compact && !options.fromZip) return `--${formatOption(flag)} requires --compact or --from-zip <path>`;
  }

  const outputDirs = ["keepExtracted", "extractFlaggedOnly"].filter((flag) => options[flag]);
  const { keepExtracted, extractFlaggedOnly } = options;
  if (outputDirs.length === 2 && (fsUtils.isSameOrInside(keepExtracted, extractFlaggedOnly) || fsUtils.isSameOrInside(extractFlaggedOnly, keepExtracted))) {
    return "--keep-extracted and --extract-flagged-only must point at separate, non-nested directories";
  }
  if (options.json) {
    for (const flag of outputDirs) {
      if (fsUtils.isSameOrInside(options.json, options[flag])) return `--json must not point inside --${formatOption(flag)}, which has to be empty when it is written`;
    }
    if (options.fromZip && fsUtils.isSameFile(options.json, options.fromZip)) return "--json must not point at the --from-zip archive";
    if (fsUtils.isDirectory(options.json)) return `--json: ${options.json} is a directory`;
  }
  for (const flag of outputDirs) {
    let usable;
    try {
      usable = fsUtils.isAbsentOrEmptyDir(options[flag]);
    } catch (error) {
      return `--${formatOption(flag)}: cannot use ${options[flag]}: ${error.message}`;
    }
    if (!usable) return `--${formatOption(flag)}: ${options[flag]} already exists and is not an empty directory - remove it or pick another path.`;
  }
  return undefined;
}

// Stop run-sampler on flags that would be silently ignored, or on output paths it cannot use.
// Checked before any work: a live run takes 30-60 min, and --extract-flagged-only runs after
// --add-diffs-folder has already rewritten the zip
function checkSamplerOptions(options) {
  const problem = samplerOptionsProblem(options);
  if (problem) {
    consola.error(problem);
    process.exit(1);
  }
  return true;
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
  logCurrentHost,
  checkPartnerSupport,
  checkSamplerOptions,
};
