const pkg = require("../../package.json");
const chalk = require("chalk");

// Uncaught Errors. Open Issue in GitHub
function uncaughtErrors(error) {
  if (error.stack) {
    console.error("");
    console.error(
      `!!! Please open an issue including this log on ${pkg.bugs.url}`
    );
    console.error("");
    console.error(error.message);
    console.error(`silverfin: v${pkg.version}, node: ${process.version}`);
    console.error("");
    console.error(error.stack);
  }
  process.exit(1);
}

function errorHandler(error) {
  if (error.code == "ENOENT") {
    console.log(
      `The path ${error.path} was not found, please ensure you've imported or created all required files`
    );
    process.exit();
  } else {
    uncaughtErrors(error);
  }
}

function missingReconciliationId(handle) {
  console.log(`Reconciliation ${handle}: ID is missing. Aborted`);
  console.log(
    `Try running: ${chalk.bold(
      `silverfin get-reconciliation-id --handle ${handle}`
    )} or ${chalk.bold(`silverfin get-reconciliation-id --all`)}`
  );
  process.exit(1);
}

function missingSharedPartId(name) {
  console.log(`Shared part ${name}: ID is missing. Aborted`);
  console.log(
    `Try running: ${chalk.bold(
      `silverfin get-shared-part-id --shared-part ${name}`
    )} or ${chalk.bold(`silverfin get-shared-part-id --all`)}`
  );
  process.exit(1);
}

function missingExportFileId(name) {
  console.log(`Export file ${name}: ID is missing. Aborted`);
  process.exit(1);
}

module.exports = {
  uncaughtErrors,
  errorHandler,
  missingReconciliationId,
  missingSharedPartId,
  missingExportFileId,
};
