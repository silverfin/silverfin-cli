#!/usr/bin/env node

const toolkit = require("../index.js");
const liquidTests = require("../liquid_test_generator/generator");
const stats = require("../stats_utils");
const { Command } = require("commander");
const prompt = require("prompt-sync")({ sigint: true });
const pkg = require("../package.json");
const program = new Command();

// Load firm id from ENV vars
let firmIdDefault = undefined;
if (process.env.SF_FIRM_ID) {
  firmIdDefault = process.env.SF_FIRM_ID;
}
function checkDefaultFirm(firmUsed) {
  if (firmUsed === firmIdDefault) {
    console.log(`Firm ID to be used: ${firmIdDefault}`);
  }
}

// Version
if (pkg.version) {
  program.version(pkg.version);
}

// Uncaught Errors
process
  .on("uncaughtException", (err) => {
    toolkit.uncaughtErrors(err);
  })
  .on("unhandledRejection", (err) => {
    toolkit.uncaughtErrors(err);
  });

// Prompt Confirmation
function promptConfirmation() {
  const confirm = prompt(
    "This will overwrite existing templates. Do you want to proceed? (y/n): "
  );
  if (confirm.toLocaleLowerCase() !== "yes" && confirm.toLowerCase() !== "y") {
    console.log("Operation cancelled");
    process.exit(1);
  }
  return true;
}

// Import a single reconciliation
program
  .command("import-reconciliation")
  .description("Import an existing reconciliation template")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used (mandatory)",
    firmIdDefault
  )
  .requiredOption(
    "-h, --handle <handle>",
    "Specify the reconcilation to be used (mandatory)"
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    if (!options.yes) {
      promptConfirmation();
    }
    checkDefaultFirm(options.firm);
    firmId = options.firm;
    toolkit.importExistingReconciliationByHandle(options.handle);
  });

// Update a single reconciliation
program
  .command("update-reconciliation")
  .description("Update an existing reconciliation template")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used (mandatory)",
    firmIdDefault
  )
  .requiredOption(
    "-h, --handle <handle>",
    "Specify the reconcilation to be used (mandatory)"
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    if (!options.yes) {
      promptConfirmation();
    }
    checkDefaultFirm(options.firm);
    firmId = options.firm;
    toolkit.persistReconciliationText(options.handle);
  });

// Import all reconciliations
program
  .command("import-all-reconciliations")
  .description("Import all reconciliations at once")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used (mandatory)",
    firmIdDefault
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    if (!options.yes) {
      promptConfirmation();
    }
    checkDefaultFirm(options.firm);
    firmId = options.firm;
    toolkit.importExistingReconciliations();
  });

// Import a single shared part
program
  .command("import-shared-part")
  .description("Import an existing shared part")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used (mandatory)",
    firmIdDefault
  )
  .requiredOption(
    "-h, --handle <handle>",
    "Specify the shared part to be used (mandatory)"
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    if (!options.yes) {
      promptConfirmation();
    }
    checkDefaultFirm(options.firm);
    firmId = options.firm;
    toolkit.importExistingSharedPartByName(options.handle);
  });

// Update a single shared part
program
  .command("update-shared-part")
  .description("Update an existing shared part")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used (mandatory)",
    firmIdDefault
  )
  .requiredOption(
    "-h, --handle <handle>",
    "Specify the shared part to be used (mandatory)"
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    if (!options.yes) {
      promptConfirmation();
    }
    checkDefaultFirm(options.firm);
    firmId = options.firm;
    toolkit.persistSharedPart(options.handle);
  });

// Import all shared parts
program
  .command("import-all-shared-parts")
  .description("Import all shared parts at once")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used (mandatory)",
    firmIdDefault
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    if (!options.yes) {
      promptConfirmation();
    }
    checkDefaultFirm(options.firm);
    firmId = options.firm;
    toolkit.importExistingSharedParts();
  });

// Update shared parts used in a reconciliation
program
  .command("shared-parts-used")
  .description("Update the list of shared used for a specific reconciliation")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used (mandatory)",
    firmIdDefault
  )
  .requiredOption(
    "-h, --handle <handle>",
    "Specify the reconciliation to be used (mandatory)"
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    if (!options.yes) {
      promptConfirmation();
    }
    checkDefaultFirm(options.firm);
    firmId = options.firm;
    toolkit.refreshSharedPartsUsed(options.handle);
  });

// Add shared part to reconciliation
program
  .command("add-shared-part")
  .description("Add an existing shared part to an existing reconciliation")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used (mandatory)",
    firmIdDefault
  )
  .requiredOption(
    "-s, --shared-part <name>",
    "Specify the shared part to be added (mandatory)"
  )
  .requiredOption(
    "-h, --handle <handle>",
    "Specify the reconciliation that needs to be updated (mandatory)"
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    if (!options.yes) {
      promptConfirmation();
    }
    checkDefaultFirm(options.firm);
    firmId = options.firm;
    toolkit.addSharedPartToReconciliation(options.sharedPart, options.handle);
  });

// Remove shared part to reconciliation
program
  .command("remove-shared-part")
  .description("Remove an existing shared part to an existing reconciliation")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used (mandatory)",
    firmIdDefault
  )
  .requiredOption(
    "-s, --shared-part <name>",
    "Specify the shared part to be removed (mandatory)"
  )
  .requiredOption(
    "-h, --handle <handle>",
    "Specify the reconciliation that needs to be updated (mandatory)"
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    if (!options.yes) {
      promptConfirmation();
    }
    checkDefaultFirm(options.firm);
    firmId = options.firm;
    toolkit.removeSharedPartFromReconciliation(
      options.sharedPart,
      options.handle
    );
  });

// Run Liquid Test
program
  .command("run-test")
  .description(
    "Run Liquid Tests for a reconciliation template from a YAML file"
  )
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used (mandatory)",
    firmIdDefault
  )
  .requiredOption(
    "-h, --handle <handle>",
    "Specify the reconciliation to be used (mandatory)"
  )
  .action((options) => {
    checkDefaultFirm(options.firm);
    firmId = options.firm;
    toolkit.runTests(options.handle);
  });

// Create Liquid Test
program
  .command("create-test")
  .description(
    "Create Liquid Test (YAML file) from an existing reconciliation in a company file"
  )
  .requiredOption("-u, --url <url>", "Specify the url to be used (mandatory)")
  .option(
    "--unreconciled",
    "By default, the reconciled status will be set as true. Add this option to set it as false (optional)"
  )
  .option(
    "-t, --test-name <testName>",
    "Establish the name of the test. It should have no white-spaces (e.g. test_name)(optional)"
  )
  .action((options) => {
    reconciledStatus = options.unreconciled ? false : true;
    testName = options.testName ? options.testName : "test_name";
    liquidTests.testGenerator(options.url);
  });

// Authorize APP
program
  .command("authorize")
  .description("Authorize the CLI by entering your Silverfin API credentials")
  .action(() => {
    toolkit.authorize();
  });

// Repositories Statistics
program
  .command("stats")
  .description("Generate an overview with some statistics")
  .requiredOption(
    "-s, --since <date>, Specify the date which is going to be used to filter the data from (format: YYYY-MM-DD) (mandatory)"
  )
  .action((options) => {
    stats.generateStatsOverview(options.since);
  });

program.parse();
