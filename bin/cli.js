#!/usr/bin/env node

const toolkit = require("../index.js");
const liquidTests = require("../liquid_test_generator/generator");
const stats = require("../stats_utils");
const { Command } = require("commander");
const prompt = require("prompt-sync")({ sigint: true });
const pkg = require("../package.json");
const cliUpdates = require("../resources/cliUpdates");
const program = new Command();
const devMode = require("../lib/cli/devMode");

// Load default firm id from Config Object or ENV
let firmIdDefault = undefined;
let firmStoredConfig = toolkit.getDefaultFirmID();
if (firmStoredConfig) {
  firmIdDefault = firmStoredConfig;
}
if (!firmIdDefault && process.env.SF_FIRM_ID) {
  firmIdDefault = process.env.SF_FIRM_ID;
}
function checkDefaultFirm(firmUsed) {
  if (firmUsed === firmIdDefault) {
    console.log(`Firm ID to be used: ${firmIdDefault}`);
  }
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
    console.log(
      "Only one of the following options must be used: " +
        formattedParameters.join(", ")
    );
    process.exit(1);
  }
}

program.name("silverfin");

// Version
if (pkg.version) {
  program.version(pkg.version);
}

// Import reconciliations
program
  .command("import-reconciliation")
  .description("Import reconciliation templates")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used",
    firmIdDefault
  )
  .option("-h, --handle <handle>", "Import a specific reconciliation by handle")
  .option("-i, --id <id>", "Import a specific reconciliation by id")
  .option("-a, --all", "Import all reconciliations")
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    checkUniqueOption(["handle", "id", "all"], options);
    if (!options.yes) {
      promptConfirmation();
    }
    checkDefaultFirm(options.firm);
    if (options.handle) {
      toolkit.importExistingReconciliationByHandle(
        options.firm,
        options.handle
      );
    } else if (options.id) {
      toolkit.importExistingReconciliationById(options.firm, options.id);
    } else if (options.all) {
      toolkit.importExistingReconciliations(options.firm);
    }
  });

// Update a single reconciliation
program
  .command("update-reconciliation")
  .description("Update an existing reconciliation template")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used",
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
    toolkit.persistReconciliationText(options.firm, options.handle);
  });

// Create new reconciliation
program
  .command("create-reconciliation")
  .description("Create a new reconciliation text")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used",
    firmIdDefault
  )
  .option(
    "-h, --handle <handle>",
    "Specify the handle of the reconciliation text to be created"
  )
  .option(
    "-a, --all",
    "Try to create all the reconciliation texts stored in the repository"
  )
  .action((options) => {
    checkUniqueOption(["handle", "all"], options);
    checkDefaultFirm(options.firm);
    if (options.handle) {
      toolkit.newReconciliation(options.firm, options.handle);
    } else if (options.all) {
      toolkit.newReconciliationsAll(options.firm);
    }
  });

// Import shared parts
program
  .command("import-shared-part")
  .description("Import an existing shared part")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used",
    firmIdDefault
  )
  .option("-s, --shared-part <name>", "Import a specific shared part")
  .option("-a, --all", "Import all shared parts")
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    checkUniqueOption(["sharedPart", "all"], options);
    if (!options.yes) {
      promptConfirmation();
    }
    checkDefaultFirm(options.firm);
    if (options.sharedPart) {
      toolkit.importExistingSharedPartByName(options.firm, options.sharedPart);
    } else if (options.all) {
      toolkit.importExistingSharedParts(options.firm);
    }
  });

// Update a single shared part
program
  .command("update-shared-part")
  .description("Update an existing shared part")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used",
    firmIdDefault
  )
  .requiredOption(
    "-s, --shared-part <name>",
    "Specify the shared part to be used (mandatory)"
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    if (!options.yes) {
      promptConfirmation();
    }
    checkDefaultFirm(options.firm);
    toolkit.persistSharedPart(options.firm, options.sharedPart);
  });

// Create new shared parts
program
  .command("create-shared-part")
  .description("Create a new shared part")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used",
    firmIdDefault
  )
  .option(
    "-s, --shared-part <name>",
    "Specify the name of the shared part to be created"
  )
  .option(
    "-a, --all",
    "Try to create all the shared parts stored in the repository"
  )
  .action((options) => {
    checkUniqueOption(["sharedPart", "all"], options);
    checkDefaultFirm(options.firm);
    if (options.sharedPart) {
      toolkit.newSharedPart(options.firm, options.sharedPart);
    } else if (options.all) {
      toolkit.newSharedPartsAll(options.firm);
    }
  });

// Add shared part to reconciliation
program
  .command("add-shared-part")
  .description("Add an existing shared part to an existing reconciliation")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used",
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
    toolkit.addSharedPartToReconciliation(
      options.firm,
      options.sharedPart,
      options.handle
    );
  });

// Add all shared parts
program
  .command("add-all-shared-parts")
  .description(
    "Add all shared parts to all reconciliations (based on the config file of shared parts and the handles assigned there to each reconciliation)"
  )
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used",
    firmIdDefault
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    if (!options.yes) {
      promptConfirmation();
    }
    checkDefaultFirm(options.firm);
    toolkit.addAllSharedPartsToAllReconciliation(options.firm);
  });

// Remove shared part to reconciliation
program
  .command("remove-shared-part")
  .description("Remove an existing shared part to an existing reconciliation")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used",
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
    toolkit.removeSharedPartFromReconciliation(
      options.firm,
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
    "Specify the firm to be used",
    firmIdDefault
  )
  .requiredOption(
    "-h, --handle <handle>",
    "Specify the reconciliation to be used (mandatory)"
  )
  .option(
    "-t, --test <test-name>",
    "Specify the name of the test to be run (optional)",
    ""
  )
  .option(
    "--html",
    "Get a html file of the template generated with the Liquid Test information (optional)",
    false
  )
  .action((options) => {
    checkDefaultFirm(options.firm);
    toolkit.runTestsWithOutput(
      options.firm,
      options.handle,
      options.test,
      options.html
    );
    toolkit.runTestsWithOutput(
      options.firm,
      options.handle,
      options.test,
      options.html
    );
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
    "-t, --test <test-name>",
    "Establish the name of the test. It should have no white-spaces (e.g. test_name)(optional)"
  )
  .action((options) => {
    reconciledStatus = options.unreconciled ? false : true;
    let testName = options.test ? options.test : "test_name";
    liquidTests.testGenerator(options.url, testName);
  });

// Authorize APP
program
  .command("authorize")
  .description("Authorize the CLI by entering your Silverfin API credentials")
  .action(() => {
    toolkit.authorize(firmIdDefault);
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

// Set/Get FIRM ID
program
  .command("config")
  .description("Configuration options")
  .option(
    "-s, --set-firm <firmId>",
    "Store a firm id to use it as default (setting a firm id will overwrite any existing data)"
  )
  .option("-g, --get-firm", "Check if there is any firm id already stored")
  .option("-l, --list-all", "List all the firm IDs stored")
  .action((options) => {
    checkUniqueOption(["setFirm", "getFirm", "listAll"], options);
    if (options.setFirm) {
      toolkit.setDefaultFirmID(options.setFirm);
    }
    if (options.getFirm) {
      const storedFirmId = toolkit.getDefaultFirmID();
      if (storedFirmId) {
        console.log(`Firm id previously stored: ${storedFirmId}`);
      } else {
        console.log("There is no firm id previously stored");
      }
    }
    if (options.listAll) {
      const ids = toolkit.listStoredIds() || [];
      if (ids) {
        console.log("List of authorized firms");
        ids.forEach((element) => console.log("- " + element));
      }
    }
  });

// Get all the IDs of existing reconciliations
program
  .command("get-reconciliation-id")
  .description("Fetch the ID of the reconciliation from Silverfin")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used",
    firmIdDefault
  )
  .option("-h, --handle <handle>", "Fetch the reconciliation ID by handle")
  .option("-a, --all", "Fetch the ID for every reconciliation")
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    checkUniqueOption(["handle", "all"], options);
    if (!options.yes) {
      promptConfirmation();
    }
    checkDefaultFirm(options.firm);
    if (options.handle) {
      toolkit.updateTemplateID(
        options.firm,
        "reconciliation_texts",
        options.handle
      );
    } else if (options.all) {
      toolkit.getAllTemplatesId(options.firm, "reconciliation_texts");
    }
  });

// Get all the IDs of existing shared parts
program
  .command("get-shared-part-id")
  .description("Fetch the ID of a shared part from Silverfin")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used",
    firmIdDefault
  )
  .option("-s, --shared-part <name>", "Fetch the shared part ID by name")
  .option("-a, --all", "Fetch the ID for every shared part")
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    checkUniqueOption(["sharedPart", "all"], options);
    if (!options.yes) {
      promptConfirmation();
    }
    checkDefaultFirm(options.firm);
    if (options.sharedPart) {
      toolkit.updateTemplateID(
        options.firm,
        "shared_parts",
        options.sharedPart
      );
    } else if (options.all) {
      toolkit.getAllTemplatesId(options.firm, "shared_parts");
    }
  });

// Development mode
program
  .command("development-mode")
  .description("Development mode - Watch for changes in files")
  .description("Development mode - Watch for changes in files")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used",
    firmIdDefault
  )
  .option(
    "-h, --handle <handle>",
    "Watch for changes in liquid and yaml files related to the reconcilation mentioned. Run a new Liquid Test on each save"
  )
  .option(
    "-u, --update-templates",
    "Watch for changes in any liquid file. Publish the new code of the template into the Platform on each save"
  )
  .option(
    "-t, --test <test-name>",
    "Specify the name of the test to be run (optional). It has to be used together with --handle",
    ""
  )
  .option(
    "--html",
    "Get a html file of the template generated with the Liquid Test information (optional). It has to be used together with --handle",
    false
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    checkDefaultFirm(options.firm);
    checkUniqueOption(["handle", "updateTemplates"], options);
    if (options.updateTemplates && !options.yes) {
      promptConfirmation();
    }
    if (options.handle) {
      devMode.watchLiquidTest(
        options.firm,
        options.handle,
        options.test,
        options.html
      );
    }
    if (options.updateTemplates) {
      devMode.watchLiquidFiles(options.firm);
    }
    checkUniqueOption(["handle", "updateTemplates"], options);
    if (options.updateTemplates && !options.yes) {
      promptConfirmation();
    }
    if (options.handle) {
      devMode.watchLiquidTest(
        options.firm,
        options.handle,
        options.test,
        options.html
      );
    }
    if (options.updateTemplates) {
      devMode.watchLiquidFiles(options.firm);
    }
  });

// Update the CLI
if (pkg.repository && pkg.repository.url) {
  program
    .command("update")
    .description("Update the CLI to the latest version")
    .action(() => {
      cliUpdates.performUpdate();
    });
}

// Initiate CLI
(async function () {
  // Check if there is a new version available
  await cliUpdates.checkVersions();
  program.parse();
})();
