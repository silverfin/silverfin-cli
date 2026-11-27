const pkg = require("../../package.json");
const chalk = require("chalk");
const { consola } = require("consola");
const { AuthFailureError, EXIT_AUTH_FAILURE } = require("./authError");
const { WORKFLOWS_FOLDER } = require("./constants");

// How the workflows folder is written in a message, relative to the repository root
const WORKFLOWS_PATH = `./${WORKFLOWS_FOLDER}`;

/**
 * Which firm or partner a failed API request was sent to, read from the axios config.
 * Firm instances carry an `X-Firm-ID` header, partner instances a `partner_id` param.
 * @param {object} [config] The axios request config
 * @returns {string} e.g. " for firm 12345", or "" when neither is set
 */
function requestTarget(config) {
  const firmId = config?.headers?.["X-Firm-ID"];
  if (firmId) {
    return ` for firm ${firmId}`;
  }
  const partnerId = config?.params?.partner_id;
  if (partnerId) {
    return ` for partner ${partnerId}`;
  }
  return "";
}

/**
 * A request the Silverfin API answered with a 5xx, or one that never got an answer
 * (DNS, refused or reset connection, timeout, a proxy in the way). Neither is a CLI bug,
 * so it is reported without the stack trace and without asking for a GitHub issue.
 * @param {Error} error
 * @returns {boolean} True when the error was reported and the process told to exit
 */
function apiUnavailable(error) {
  if (!error?.isAxiosError) {
    return false;
  }
  const status = error.response?.status;
  if (error.response && !(status >= 500)) {
    return false;
  }

  const target = requestTarget(error.config);
  if (error.response) {
    const statusText = error.response.statusText ? ` (${error.response.statusText})` : "";
    consola.error(`The Silverfin API returned a server error ${status}${statusText}${target}.`);
    consola.log("This is usually temporary. Wait a moment and run the command again.");
  } else {
    const code = error.code || error.message;
    consola.error(`The Silverfin API could not be reached${target}: ${code}.`);
    consola.log("Check your internet connection, VPN or proxy, and run the command again.");
  }
  // Only the stack: the error itself carries the request config, which holds the access token.
  consola.debug(error.stack);
  consola.log("Run the command with --verbose for the stack trace.");
  process.exit(1);
  return true;
}

// Uncaught Errors. Open Issue in GitHub
function uncaughtErrors(error) {
  // First, so an outage or a connection problem is not reported as a CLI bug
  if (apiUnavailable(error)) {
    return;
  }
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
  // First, so an expired credential never reaches uncaughtErrors. It is a routine
  // operational state, and reporting it as "please open an issue" both buries the real
  // cause and sends the reader somewhere that cannot help. The distinct exit code is
  // what lets a CI caller skip its retries: no amount of retrying fixes a stale token.
  if (error instanceof AuthFailureError) {
    consola.error(`Authentication failed for firm ${error.firmId}: its stored credential was rejected and was not renewed.`);
    consola.error(`Run \`silverfin authorize\` for firm ${error.firmId} to obtain a new one.`);
    if (error.cause) {
      consola.debug(error.cause);
    }
    process.exit(EXIT_AUTH_FAILURE);
    // Explicit, rather than trusting process.exit to end the function: the branches below
    // are an if/else pair and cannot fall through, but this one is a bare if and would.
    return;
  }
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

// Per template type: how it is named in a message, which config.json field its folder is
// named after, and the command that fetches its ID (`--all`, or for one template).
const TEMPLATE_ID_DETAILS = {
  reconciliationText: { label: "Reconciliation", identifier: "handle", command: "get-reconciliation-id", option: (name) => `--handle ${name}` },
  sharedPart: { label: "Shared part", identifier: "name", command: "get-shared-part-id", option: (name) => `--shared-part ${name}` },
  exportFile: { label: "Export file", identifier: "name_nl", command: "get-export-file-id", option: (name) => `--name "${name}"` },
  accountTemplate: { label: "Account template", identifier: "name_nl", command: "get-account-template-id", option: (name) => `--name "${name}"` },
};

/**
 * @param {string} templateType e.g. "reconciliationText"
 * @param {string} name The handle or name of the template
 * @returns {string} The "ID is missing" line, naming the field the folder must match
 */
function missingIdMessage(templateType, name) {
  const { label, identifier } = TEMPLATE_ID_DETAILS[templateType];
  return `${label} ${name}: ID is missing. Please check your command for typos and check if the folder name matches the ${identifier} in config.json`;
}

/**
 * @param {string} templateType e.g. "reconciliationText"
 * @param {string} [name] The template to fetch the ID for. Without it, a placeholder is shown
 * @returns {string} The `get-…-id` commands that fetch the missing ID
 */
function missingIdHint(templateType, name) {
  const { command, option } = TEMPLATE_ID_DETAILS[templateType];
  const all = chalk.bold(`silverfin ${command} --all`);
  if (name) {
    return `Try running: ${chalk.bold(`silverfin ${command} ${option(name)}`)} or ${all}`;
  }
  return `Try running: ${all} (or ${chalk.bold(`silverfin ${command} ${option("<name>")}`)} for one template)`;
}

function missingTemplateId(templateType, name) {
  consola.error(missingIdMessage(templateType, name));
  consola.log(missingIdHint(templateType, name));
  return false;
}

function missingReconciliationId(handle) {
  return missingTemplateId("reconciliationText", handle);
}

function missingSharedPartId(name) {
  return missingTemplateId("sharedPart", name);
}

function missingExportFileId(name) {
  return missingTemplateId("exportFile", name);
}

function missingAccountTemplateId(name) {
  return missingTemplateId("accountTemplate", name);
}

/**
 * The deferred error lines shared by every batch summary
 * @param {string} templateType e.g. "reconciliationText"
 * @param {Array<{ kind: string, handle?: string, name?: string, message?: string }>} errors
 */
function printBatchErrorSummary(templateType, errors) {
  if (!errors || errors.length === 0) {
    return;
  }
  const { label } = TEMPLATE_ID_DETAILS[templateType];

  consola.log("");
  consola.error(`${label} update finished with ${errors.length} error(s):`);

  for (const e of errors) {
    const name = e.handle ?? e.name;
    if (e.kind === "missing_id") {
      consola.error(missingIdMessage(templateType, name));
    } else if (e.kind === "skipped") {
      consola.error(`${label} ${name}: skipped, its files could not be read (see the warning above)`);
    } else if (e.kind === "update_failed") {
      consola.error(`${label} update failed: ${name}`);
    } else if (e.kind === "exception") {
      consola.error(name ? `${label} ${name}: ${e.message}` : e.message);
    }
  }

  if (errors.some((e) => e.kind === "missing_id")) {
    consola.log(missingIdHint(templateType));
  }
}

/** Print errors collected during publishAllReconciliations (after the loop). */
function printReconciliationBatchErrorSummary(errors) {
  printBatchErrorSummary("reconciliationText", errors);
}

/** Print errors collected during publishAllExportFiles (after the loop). */
function printExportFileBatchErrorSummary(errors) {
  printBatchErrorSummary("exportFile", errors);
}

/** Print errors collected during publishAllSharedParts (after the loop). */
function printSharedPartBatchErrorSummary(errors) {
  printBatchErrorSummary("sharedPart", errors);
}

/** Print errors collected during publishAllAccountTemplates (after the loop). */
function printAccountTemplateBatchErrorSummary(errors) {
  printBatchErrorSummary("accountTemplate", errors);
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
 * Templates listed in a workflow file which the repository does not hold. They are left out of
 * the statistics, so the user is told which ones and why the totals may be lower than expected
 * @param {string} workflowName The name of the workflow the templates were listed in
 * @param {Array<string>} missingTemplates The handles or names which have no template folder
 */
function workflowTemplatesMissing(workflowName, missingTemplates) {
  consola.warn(`${workflowName}: ${missingTemplates.length} template(s) are listed but not stored in this repository: ${missingTemplates.join(", ")}`);
  consola.log(`They are left out of the statistics. Import them, or correct the workflow file in ${WORKFLOWS_PATH}`);
  return false;
}

/**
 * The statistics were gathered, but the CSV file could not be written. The summary is
 * already on screen, so this names the file and the likely cause instead of stopping the run
 * @param {string} csvPath The file the statistics were meant to be written to
 * @param {Error} error The write failure. Kept for the debug output of the caller
 */
function statisticsNotWritten(csvPath, error) {
  const reason = error && error.code === "EACCES" ? " (no permission to write to it)" : "";
  consola.error(`The statistics could not be written to ${csvPath}${reason}. They are shown above`);
  consola.log(`Check that the file is not open in another program and run the command again`);
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
  requestTarget,
  apiUnavailable,
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
  workflowTemplatesMissing,
  statisticsNotWritten,
  printWorkflowBatchErrorSummary,
};
