const pkg = require("../../package.json");
const chalk = require("chalk");
const { consola } = require("consola");
const { WORKFLOWS_FOLDER } = require("./constants");

// How the workflows folder is written in a message, relative to the repository root
const WORKFLOWS_PATH = `./${WORKFLOWS_FOLDER}`;

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

// --- Command line input ---

/**
 * Both handle messages end the same way: the command which lists the handles that exist when
 * the caller knows one, and otherwise the shortest thing the user can do about it
 * @param {string} label How the handle is named in the message (e.g. "workflow handle")
 * @param {string} [suggestedCommand] A command which lists the handles available
 */
function suggestValidHandle(label, suggestedCommand) {
  if (suggestedCommand) {
    consola.log(`To see the ${label}s available, try running: ${chalk.bold(suggestedCommand)}`);
  } else {
    consola.log(`Please provide a valid ${label}`);
  }
}

/**
 * A handle was expected on the command line but none arrived
 * @param {string} label How to name the handle in the message (e.g. "workflow handle")
 * @param {string} [suggestedCommand] A command which lists the handles available
 * @returns {boolean} False
 */
function missingHandle(label, suggestedCommand) {
  consola.error(`No ${label} was provided. Please pass a ${label}, or check that the variable you passed is set`);
  suggestValidHandle(label, suggestedCommand);
  return false;
}

/**
 * A handle provided on the command line cannot be used to build a file path
 * @param {string} handle The handle provided by the user
 * @param {string} label How to name the handle in the message (e.g. "workflow handle")
 * @param {string} [suggestedCommand] A command which lists the handles available
 * @returns {boolean} False
 */
function invalidHandleFormat(handle, label, suggestedCommand) {
  consola.error(`Invalid ${label} "${handle}". A ${label} names a file or folder in this repository, so it cannot contain slashes, start with a dot, or contain ".."`);
  suggestValidHandle(label, suggestedCommand);
  return false;
}

// --- Workflows ---

function invalidWorkflowHandle(handle) {
  consola.error(`Workflow handle "${handle}" is not valid: it must be the name of a file in ${WORKFLOWS_PATH}`);
  return false;
}

function missingWorkflow(handle, existingHandles = []) {
  consola.error(`Workflow "${handle}" was not found in the workflows folder`);
  if (existingHandles.length === 0) {
    consola.log(`There are no workflows stored in ${WORKFLOWS_PATH}`);
  } else {
    consola.log(`Workflows available: ${existingHandles.join(", ")}`);
  }
  return false;
}

function unparsableWorkflow(handle, reason) {
  consola.error(`Workflow "${handle}" could not be parsed as JSON: ${reason}`);
  consola.log(`Check ${chalk.bold(`${WORKFLOWS_PATH}/${handle}.json`)}`);
  return false;
}

function invalidWorkflow(handle, problems) {
  consola.error(`Workflow "${handle}" is not valid: ${problems.join("; ")}`);
  consola.log(`Check ${chalk.bold(`${WORKFLOWS_PATH}/${handle}.json`)}`);
  return false;
}

function noWorkflowsStored() {
  consola.error(`No workflows were found in ${WORKFLOWS_PATH}. Please add a workflow file before generating workflow statistics`);
  return false;
}

function workflowStatisticsNotSaved(handle) {
  consola.error(`Statistics for "${handle}" were not saved: it is not a valid workflow handle`);
  return false;
}

/**
 * Print the workflows skipped during generateWorkflowOverview (after the loop),
 * so a partial run is never mistaken for a complete one.
 * @param {Array<string>} skippedHandles
 * @param {number} total The number of workflows the run started with
 */
function printWorkflowBatchErrorSummary(skippedHandles, total) {
  if (!skippedHandles || skippedHandles.length === 0) {
    return;
  }
  consola.log("");
  consola.error(`${skippedHandles.length} of ${total} workflows were skipped: ${skippedHandles.join(", ")}`);
  consola.log(`Correct the workflow files in ${WORKFLOWS_PATH} and run the command again`);
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
  missingHandle,
  invalidHandleFormat,
  invalidWorkflowHandle,
  missingWorkflow,
  unparsableWorkflow,
  invalidWorkflow,
  noWorkflowsStored,
  workflowStatisticsNotSaved,
  printWorkflowBatchErrorSummary,
};
