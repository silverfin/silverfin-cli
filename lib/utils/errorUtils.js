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

/**
 * Print errors collected during publishAllReconciliations (after the loop).
 * @param {Array<{ kind: string, handle?: string, message?: string, stack?: string, rawError?: unknown }>} errors
 */
function printReconciliationBatchErrorSummary(errors) {
  if (!errors || errors.length === 0) {
    return;
  }

  consola.log("");
  consola.error(`Reconciliation update finished with ${errors.length} error(s):`);

  const hadMissingId = errors.some((e) => e.kind === "missing_id");

  for (const e of errors) {
    if (e.kind === "missing_id") {
      consola.error(
        `Reconciliation ${e.handle}: ID is missing. Please check your command for typos and check if the folder name matches the name_nl`
      );
    } else if (e.kind === "update_failed") {
      consola.error(`Reconciliation update failed: ${e.handle}`);
    } else if (e.kind === "exception") {
      consola.error(e.handle ? `Reconciliation ${e.handle}: ${e.message}` : e.message);
    }
  }

  if (hadMissingId) {
    consola.log(
      `Try running: ${chalk.bold("silverfin get-reconciliation-id --all")} (or ${chalk.bold("silverfin get-reconciliation-id --handle <handle>")} for one template)`
    );
  }
}

/**
 * Print errors collected during publishAllExportFiles (after the loop).
 * @param {Array<{ kind: string, name?: string, message?: string, stack?: string, rawError?: unknown }>} errors
 */
function printExportFileBatchErrorSummary(errors) {
  if (!errors || errors.length === 0) {
    return;
  }

  consola.log("");
  consola.error(`Export file update finished with ${errors.length} error(s):`);

  const hadMissingId = errors.some((e) => e.kind === "missing_id");

  for (const e of errors) {
    if (e.kind === "missing_id") {
      consola.error(
        `Export file ${e.name}: ID is missing. Aborted. Please check your command for typos and check if the folder name matches the name_nl`
      );
    } else if (e.kind === "update_failed") {
      consola.error(`Export file update failed: ${e.name}`);
    } else if (e.kind === "exception") {
      consola.error(e.name ? `Export file ${e.name}: ${e.message}` : e.message);
    }
  }

  if (hadMissingId) {
    consola.log(
      `Try running: ${chalk.bold("silverfin get-export-file-id --all")} (or ${chalk.bold('silverfin get-export-file-id --name "<name>"')} for one template)`
    );
  }
}

/**
 * Print errors collected during publishAllSharedParts (after the loop).
 * @param {Array<{ kind: string, name?: string, message?: string, stack?: string, rawError?: unknown }>} errors
 */
function printSharedPartBatchErrorSummary(errors) {
  if (!errors || errors.length === 0) {
    return;
  }

  consola.log("");
  consola.error(`Shared part update finished with ${errors.length} error(s):`);

  const hadMissingId = errors.some((e) => e.kind === "missing_id");

  for (const e of errors) {
    if (e.kind === "missing_id") {
      consola.error(
        `Shared part ${e.name}: ID is missing. Aborted. Please check your command for typos and check if the folder name matches the name_nl`
      );
    } else if (e.kind === "update_failed") {
      consola.error(`Shared part update failed: ${e.name}`);
    } else if (e.kind === "exception") {
      consola.error(e.name ? `Shared part ${e.name}: ${e.message}` : e.message);
    }
  }

  if (hadMissingId) {
    consola.log(
      `Try running: ${chalk.bold("silverfin get-shared-part-id --all")} (or ${chalk.bold("silverfin get-shared-part-id --shared-part <name>")} for one template)`
    );
  }
}

/**
 * Print errors collected during publishAllAccountTemplates (after the loop).
 * @param {Array<{ kind: string, name?: string, message?: string, stack?: string, rawError?: unknown }>} errors
 */
function printAccountTemplateBatchErrorSummary(errors) {
  if (!errors || errors.length === 0) {
    return;
  }

  consola.log("");
  consola.error(`Account template update finished with ${errors.length} error(s):`);

  const hadMissingId = errors.some((e) => e.kind === "missing_id");

  for (const e of errors) {
    if (e.kind === "missing_id") {
      consola.error(
        `Account template ${e.name}: ID is missing. Aborted. Please check your command for typos and check if the folder name matches the name_nl`
      );
    } else if (e.kind === "update_failed") {
      consola.error(`Account template update failed: ${e.name}`);
    } else if (e.kind === "exception") {
      consola.error(e.name ? `Account template ${e.name}: ${e.message}` : e.message);
    }
  }

  if (hadMissingId) {
    consola.log(
      `Try running: ${chalk.bold("silverfin get-account-template-id --all")} (or ${chalk.bold('silverfin get-account-template-id --name "<name>"')} for one template)`
    );
  }
}

module.exports = {
  uncaughtErrors,
  errorHandler,
  missingConfig,
  missingReconciliationId,
  missingSharedPartId,
  missingExportFileId,
  missingAccountTemplateId,
  printReconciliationBatchErrorSummary,
  printExportFileBatchErrorSummary,
  printSharedPartBatchErrorSummary,
  printAccountTemplateBatchErrorSummary,
};
