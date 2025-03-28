const pkg = require("../../package.json");
const chalk = require("chalk");
const { consola } = require("consola");

// Uncaught Errors. Open Issue in GitHub
function uncaughtErrors(error) {
  if (error.stack) {
    console.error("----------------------------");
    console.error(`!!! Please open an issue including this log on ${pkg.bugs.url}`);
    console.error("");
    consola.error(error.message);
    console.error(`silverfin: v${pkg.version}, node: ${process.version}`);
    console.error("");
    console.error(error.stack);
    console.error("----------------------------");
  }
  process.exit(1);
}

function errorHandler(error) {
  if (error.code == "ENOENT") {
    consola.error(`The path ${error.path} was not found, please ensure you've imported or created all required files`);
    process.exit(1);
  } else {
    uncaughtErrors(error);
  }
}

function missingConfig(identifier) {
  consola.error(`Missing config file for "${identifier}"`);
  process.exit(1);
}

function missingReconciliationId(handle) {
  consola.error(`Reconciliation ${handle}: ID is missing. Please check your command for typos and check if the folder name matches the name_nl`);
  consola.log(`Try running: ${chalk.bold(`silverfin get-reconciliation-id --handle ${handle}`)} or ${chalk.bold(`silverfin get-reconciliation-id --all`)}`);
  return false;
}

function missingSharedPartId(name) {
  consola.error(`Shared part ${name}: ID is missing. Aborted. Please check your command for typos and check if the folder name matches the name_nl`);
  consola.info(`Try running: ${chalk.bold(`silverfin get-shared-part-id --shared-part ${name}`)} or ${chalk.bold(`silverfin get-shared-part-id --all`)}`);
  return false;
}

function missingExportFileId(name) {
  consola.error(`Export file ${name}: ID is missing. Aborted. Please check your command for typos and check if the folder name matches the name_nl`);
  return false;
}

function missingAccountTemplateId(name) {
  consola.error(`Account template ${name}: ID is missing. Aborted. Please check your command for typos and check if the folder name matches the name_nl`);
  return false;
}

module.exports = {
  uncaughtErrors,
  errorHandler,
  missingConfig,
  missingReconciliationId,
  missingSharedPartId,
  missingExportFileId,
  missingAccountTemplateId,
};
