#!/usr/bin/env node

const toolkit = require("../index");
const liquidTestGenerator = require("../lib/liquidTestGenerator");
const liquidTestRunner = require("../lib/liquidTestRunner");
const stats = require("../lib/cli/stats");
const { Command, Option } = require("commander");
const pkg = require("../package.json");
const cliUpdates = require("../lib/cli/cliUpdates");
const cliUtils = require("../lib/cli/utils");
const program = new Command();
const devMode = require("../lib/cli/devMode");
const { firmCredentials } = require("../lib/api/firmCredentials");
const SF = require("../lib/api/sfApi");
const path = require("path");
const { consola } = require("consola");
const { runCommandChecks } = require("../lib/cli/utils");

let firmIdDefault = cliUtils.loadDefaultFirmId();
cliUtils.handleUncaughtErrors();

// Name & Version
program.name("silverfin");
pkg.version ? program.version(pkg.version) : undefined;
// Verbose Option
program.option("-v, --verbose", "Verbose output");
program.on("option:verbose", () => {
  consola.level = "debug"; // default: "info"
});

// READ reconciliations
program
  .command("import-reconciliation")
  .description("Import reconciliation templates")
  .option("-f, --firm <firm-id>", "Specify the firm to be used", firmIdDefault)
  .option("-p, --partner <partner-id>", "Specify the partner to be used")
  .option(
    "-h, --handle <handle>",
    "Import a specific firm reconciliation by handle"
  )
  .option("-i, --id <id>", "Import a specific reconciliation by id")
  .option("-a, --all", "Import all reconciliations")
  .option(
    "-e, --existing",
    "Import all reconciliations (already stored in the repository)"
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action(async (options) => {
    const settings = runCommandChecks(
      ["handle", "id", "all", "existing"],
      options,
      firmIdDefault
    );

    if (options.handle) {
      toolkit.fetchReconciliationByHandle(
        settings.type,
        settings.envId,
        options.handle
      );
    } else if (options.id) {
      toolkit.fetchReconciliationById(
        settings.type,
        settings.envId,
        options.id
      );
    } else if (options.all) {
      toolkit.fetchAllReconciliations(settings.type, settings.envId);
    } else if (options.existing) {
      toolkit.fetchExistingReconciliations(settings.type, settings.envId);
    }
  });

// UPDATE reconciliation
program
  .command("update-reconciliation")
  .description("Update an existing reconciliation template")
  .option("-f, --firm <firm-id>", "Specify the firm to be used", firmIdDefault)
  .option("-p, --partner <partner-id>", "Specify the partner to be used")
  .option(
    "-h, --handle <handle>",
    "Specify the reconcilation to be used (mandatory)"
  )
  .option("-a, --all", "Update all reconciliations")
  .option(
    "-m, --message <message>",
    "Add a message to Silverfin's changelog (optional)",
    undefined
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    const settings = runCommandChecks(
      ["handle", "all"],
      options,
      firmIdDefault
    );

    if (options.handle) {
      toolkit.publishReconciliationByHandle(
        settings.type,
        settings.envId,
        options.handle,
        options.message
      );
    } else if (options.all) {
      toolkit.publishAllReconciliations(
        "firm",
        settings.envId,
        options.message
      );
    }
  });

// CREATE reconciliation
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
    cliUtils.checkUniqueOption(["handle", "all"], options);
    cliUtils.checkDefaultFirm(options.firm, firmIdDefault);
    if (options.handle) {
      toolkit.newReconciliation("firm", options.firm, options.handle);
    } else if (options.all) {
      toolkit.newAllReconciliations("firm", options.firm);
    }
  });

// READ export file
program
  .command("import-export-file")
  .description("Import export file templates")
  .option("-f, --firm <firm-id>", "Specify the firm to be used", firmIdDefault)
  .option("-n, --name <name>", "Import a specific export file by name")
  .option("-i, --id <id>", "Import a specific export file by id")
  .option("-a, --all", "Import all existing export files")
  .option(
    "-e, --existing",
    "Import all export files (already stored in the repository)"
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    const settings = runCommandChecks(
      ["name", "id", "all", "existing"],
      options,
      firmIdDefault,
      false
    );

    if (options.name) {
      toolkit.fetchExportFileByName(
        settings.type,
        settings.envId,
        options.name
      );
    } else if (options.id) {
      toolkit.fetchExportFileById(settings.type, settings.envId, options.id);
    } else if (options.all) {
      toolkit.fetchAllExportFiles(settings.type, settings.envId);
    } else if (options.all) {
      toolkit.fetchExistingExportFiles(options.firm);
    }
  });

// UPDATE export file
program
  .command("update-export-file")
  .description("Update an existing export file template")
  .option("-f, --firm <firm-id>", "Specify the firm to be used", firmIdDefault)
  .option("-n, --name <name>", "Specify the export file to be used (mandatory)")
  .option("-a, --all", "Update all export files")
  .option(
    "-m, --message <message>",
    "Add a message to Silverfin's changelog (optional)",
    undefined
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    const settings = runCommandChecks(
      ["name", "all"],
      options,
      firmIdDefault,
      false
    );

    if (options.name) {
      toolkit.publishExportFileByName(
        settings.type,
        settings.envId,
        options.name,
        options.message
      );
    } else if (options.all) {
      toolkit.publishAllExportFiles(
        settings.type,
        settings.envId,
        options.message
      );
    }
  });

// CREATE export file
program
  .command("create-export-file")
  .description("Create a new export file template")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used",
    firmIdDefault
  )
  .option(
    "-n, --name <name>",
    "Specify the name of the export file to be created"
  )
  .option(
    "-a, --all",
    "Try to create all export files stored in the repository"
  )
  .action((options) => {
    cliUtils.checkUniqueOption(["name", "all"], options);
    cliUtils.checkDefaultFirm(options.firm, firmIdDefault);
    if (options.name) {
      toolkit.newExportFile("firm", options.firm, options.name);
    } else if (options.all) {
      toolkit.newAllExportFiles("firm", options.firm, options.name);
    }
  });

// READ account template
program
  .command("import-account-template")
  .description("Import account templates")
  .option("-f, --firm <firm-id>", "Specify the firm to be used", firmIdDefault)
  .option("-p, --partner <partner-id>", "Specify the partner to be used")
  .option("-n, --name <name>", "Import a specific account template by name")
  .option("-i, --id <id>", "Import a specific account template by id")
  .option("-a, --all", "Import all existing account templates")
  .option(
    "-e, --existing",
    "Import all account templates (already stored in the repository)"
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    const settings = runCommandChecks(
      ["name", "id", "all", "existing"],
      options,
      firmIdDefault
    );

    if (options.name) {
      toolkit.fetchAccountTemplateByName(
        settings.type,
        settings.envId,
        options.name
      );
    } else if (options.id) {
      toolkit.fetchAccountTemplateById(
        settings.type,
        settings.envId,
        options.id
      );
    } else if (options.all) {
      toolkit.fetchAllAccountTemplates(settings.type, settings.envId);
    } else if (options.existing) {
      toolkit.fetchExistingAccountTemplates(settings.type, settings.envId);
    }
  });

// UPDATE account template
program
  .command("update-account-template")
  .description("Update an existing account template")
  .option("-f, --firm <firm-id>", "Specify the firm to be used", firmIdDefault)
  .option("-p, --partner <partner-id>", "Specify the partner to be used")
  .option(
    "-n, --name <name>",
    "Specify the account template to be used (mandatory)"
  )
  .option("-a, --all", "Update all account templates")
  .option(
    "-m, --message <message>",
    "Add a message to Silverfin's changelog (optional)",
    undefined
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    const settings = runCommandChecks(["name", "all"], options, firmIdDefault);

    if (options.name) {
      toolkit.publishAccountTemplateByName(
        settings.type,
        settings.envId,
        options.name,
        options.message
      );
    } else if (options.all) {
      toolkit.publishAllAccountTemplates(
        "firm",
        settings.envId,
        options.message
      );
    }
  });

// CREATE account template
program
  .command("create-account-template")
  .description("Create a new account template")
  .requiredOption(
    "-f, --firm <firm-id>",
    "Specify the firm to be used",
    firmIdDefault
  )
  .option(
    "-n, --name <name>",
    "Specify the name of the account template to be created"
  )
  .option(
    "-a, --all",
    "Try to create all account templates stored in the repository"
  )
  .action((options) => {
    cliUtils.checkUniqueOption(["name", "all"], options);
    cliUtils.checkDefaultFirm(options.firm, firmIdDefault);
    if (options.name) {
      toolkit.newAccountTemplate("firm", options.firm, options.name);
    } else if (options.all) {
      toolkit.newAllAccountTemplates("firm", options.firm, options.name);
    }
  });

// READ shared part
program
  .command("import-shared-part")
  .description("Import an existing shared part")
  .option("-f, --firm <firm-id>", "Specify the firm to be used", firmIdDefault)
  .option("-p, --partner <partner-id>", "Specify the partner to be used")
  .option("-s, --shared-part <name>", "Import a specific shared part")
  .option("-i, --id <id>", "Import a specific shared part by id")
  .option("-a, --all", "Import all shared parts")
  .option(
    "-e, --existing",
    "Import all shared parts (already stored in the repository)"
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action(async (options) => {
    const settings = runCommandChecks(
      ["sharedPart", "id", "all", "existing"],
      options,
      firmIdDefault
    );

    if (options.sharedPart) {
      await toolkit.fetchSharedPartByName(
        settings.type,
        settings.envId,
        options.sharedPart
      );
    } else if (options.id) {
      await toolkit.fetchSharedPartById(
        settings.type,
        settings.envId,
        options.id
      );
    } else if (options.all) {
      await toolkit.fetchAllSharedParts(settings.type, settings.envId);
    } else if (options.existing) {
      toolkit.fetchExistingSharedParts(settings.type, settings.envId);
    }
  });

// UPDATE shared part
program
  .command("update-shared-part")
  .description("Update an existing shared part")
  .option("-f, --firm <firm-id>", "Specify the firm to be used", firmIdDefault)
  .option("-p, --partner <partner-id>", "Specify the partner to be used")
  .option(
    "-s, --shared-part <name>",
    "Specify the shared part to be used (mandatory)"
  )
  .option("-a, --all", "Import all shared parts")
  .option(
    "-m, --message <message>",
    "Add a message to Silverfin's changelog (optional)",
    undefined
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    const settings = runCommandChecks(
      ["sharedPart", "all"],
      options,
      firmIdDefault
    );

    if (options.sharedPart) {
      toolkit.publishSharedPartByName(
        settings.type,
        settings.envId,
        options.sharedPart,
        options.message
      );
    } else if (options.all) {
      toolkit.publishAllSharedParts("firm", settings.envId, options.message);
    }
  });

// CREATE shared part
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
    cliUtils.checkUniqueOption(["sharedPart", "all"], options);
    cliUtils.checkDefaultFirm(options.firm, firmIdDefault);
    if (options.sharedPart) {
      toolkit.newSharedPart("firm", options.firm, options.sharedPart);
    } else if (options.all) {
      toolkit.newAllSharedParts("firm", options.firm);
    }
  });

// Add shared part to reconciliation
program
  .command("add-shared-part")
  .description("Add an existing shared part to an existing template")
  .option("-f, --firm <firm-id>", "Specify the firm to be used", firmIdDefault)
  .option("-p, --partner <partner-id>", "Specify the partner to be used")
  .option(
    "-s, --shared-part <name>",
    `Specify the shared part to be added (used together with "--handle" or "--export-file")`
  )
  .option(
    "-h, --handle <handle>",
    `Specify the reconciliation that needs to be updated (used together with "--shared-part")`
  )
  .option(
    "-e, --export-file <name>",
    `Specify the export file that needs to be updated (used together with "--shared-part")`
  )
  .option(
    "-at, --account-template <name>",
    `Specify the account template that needs to be updated (used together with "--shared-part")`
  )
  .option(
    "-a, --all",
    "Add all shared parts to all templates (based on the config file of shared parts and the handles assigned there to each template)"
  )
  .option(
    "-f, --force",
    `Force adding shared parts to all templates, even if they already have it. It can only be used together with "--all" (optional)`,
    false
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    const partnerSupported = options.exportFile ? false : true;
    const settings = runCommandChecks(
      ["sharedPart", "all"],
      options,
      firmIdDefault,
      partnerSupported
    );

    if (options.sharedPart) {
      cliUtils.checkUniqueOption(
        ["handle", "exportFile", "accountTemplate"],
        options
      );
    } else {
      cliUtils.checkUniqueOption(
        ["handle", "exportFile", "accountTemplate", "all"],
        options
      );
    }
    if (options.handle) {
      toolkit.addSharedPart(
        settings.type,
        settings.envId,
        options.sharedPart,
        options.handle,
        "reconciliationText"
      );
    } else if (options.exportFile) {
      toolkit.addSharedPart(
        settings.type,
        settings.envId,
        options.sharedPart,
        options.exportFile,
        "exportFile"
      );
    } else if (options.accountTemplate) {
      toolkit.addSharedPart(
        settings.type,
        settings.envId,
        options.sharedPart,
        options.accountTemplate,
        "accountTemplate"
      );
    } else if (options.all) {
      toolkit.addAllSharedParts(settings.type, settings.envId, options.force);
    }
  });

// Remove shared part to reconciliation
program
  .command("remove-shared-part")
  .description("Remove an existing shared part from an existing template")
  .option("-f, --firm <firm-id>", "Specify the firm to be used", firmIdDefault)
  .option("-p, --partner <partner-id>", "Specify the partner to be used")
  .requiredOption(
    "-s, --shared-part <name>",
    `Specify the shared part to be removed (mandatory, used together with "--handle" or "--export-file")`
  )
  .option(
    "-h, --handle <handle>",
    `Specify the reconciliation that needs to be updated (used together with "--shared-part")`
  )
  .option(
    "-e, --export-file <name>",
    `Specify the export file that needs to be updated (used together with "--shared-part")`
  )
  .option(
    "-at, --account-template <name>",
    `Specify the account template that needs to be updated (used together with "--shared-part")`
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    const partnerSupported = options.exportFile ? false : true;
    const settings = runCommandChecks(
      ["handle", "exportFile", "accountTemplate"],
      options,
      firmIdDefault,
      partnerSupported
    );

    if (options.handle) {
      toolkit.removeSharedPart(
        settings.type,
        settings.envId,
        options.sharedPart,
        options.handle,
        "reconciliationText"
      );
    } else if (options.exportFile) {
      toolkit.removeSharedPart(
        settings.type,
        settings.envId,
        options.sharedPart,
        options.exportFile,
        "exportFile"
      );
    } else if (options.accountTemplate) {
      toolkit.removeSharedPart(
        settings.type,
        settings.envId,
        options.sharedPart,
        options.accountTemplate,
        "accountTemplate"
      );
    }
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
    "--html-input",
    "Get a static html of the input-view of the template generated with the Liquid Test data (optional)",
    false
  )
  .option(
    "--html-preview",
    "Get a static html of the export-view of the template generated with the Liquid Test data (optional)",
    false
  )
  .option(
    "--preview-only",
    "Skip the checking of the results of the Liquid Test in case you only want to generate a preview template (optional)",
    false
  )
  .option(
    "--status",
    "Only return the status of the test runs as PASSED/FAILED (optional)",
    false
  )
  .action((options) => {
    cliUtils.checkDefaultFirm(options.firm, firmIdDefault);
    if (options.status) {
      liquidTestRunner.runTestsStatusOnly(
        options.firm,
        options.handle,
        options.test
      );
    } else {
      if (options.previewOnly && !options.htmlInput && !options.htmlPreview) {
        consola.info(
          `When using "--preview-only" you need to specify at least one of the following options: "--html-input", "--html-preview"`
        );
        process.exit(1);
      }
      liquidTestRunner.runTestsWithOutput(
        options.firm,
        options.handle,
        options.test,
        options.previewOnly,
        options.htmlInput,
        options.htmlPreview
      );
    }
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
    liquidTestGenerator.testGenerator(options.url, testName);
  });

// Authorize APP
program
  .command("authorize")
  .description("Authorize the CLI by entering your Silverfin API credentials")
  .action(() => {
    SF.authorizeApp(firmIdDefault);
  });

// Authorize PARTNER
program
  .command("authorize-partner")
  .description(
    "Authorize a Silverfin partner environment by entering the API key and partner information"
  )
  .requiredOption(
    "-i, --partner-id <partner-id>",
    "Specify the partner environment id to be added"
  )
  .requiredOption(
    "-k, --api-key <api-key>",
    "Specify the api key of the partner environment to be added"
  )
  .option(
    "-n, --partner-name <partner-name>",
    "Specify the partner environment name to be added"
  )
  .action((options) => {
    const stored = firmCredentials.storePartnerApiKey(
      options.partner_id,
      options.apiKey,
      options.partnerName
    );

    if (stored) {
      consola.success("Partner API key succesfully stored");
    }
  });

// Repositories Statistics
program
  .command("stats")
  .description("Generate an overview with some statistics")
  .requiredOption(
    "-s, --since <date>, Specify the date which is going to be used to filter the data from (format: YYYY-MM-DD) (mandatory)"
  )
  .action((options) => {
    stats.generateOverview(options.since);
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
  .addOption(
    new Option(
      "-n, --update-name [firmId]",
      "Update the name of the firm (fetched from Silverfin)"
    ).preset(firmIdDefault)
  )
  .addOption(
    new Option(
      "-r, --refresh-token [firmId]",
      "Get a new pair of credentials using the stored refresh token"
    ).preset(firmIdDefault)
  )
  .addOption(
    new Option(
      "--refresh-partner-token [partner_id]",
      "Get a new partner api key using the stored api key"
    )
  )
  .action(async (options) => {
    cliUtils.checkUniqueOption(
      [
        "setFirm",
        "getFirm",
        "listAll",
        "updateName",
        "refreshToken",
        "refreshPartnerToken",
      ],
      options
    );
    if (options.setFirm) {
      firmCredentials.setDefaultFirmId(options.setFirm);
      const currentDirectory = path.basename(process.cwd());
      consola.success(`${currentDirectory}: firm id set to ${options.setFirm}`);
    }
    if (options.getFirm) {
      const storedFirmId = firmCredentials.getDefaultFirmId();
      if (storedFirmId) {
        consola.info(`Firm id previously stored: ${storedFirmId}`);
      } else {
        consola.info("There is no firm id previously stored");
      }
    }
    if (options.listAll) {
      const firms = firmCredentials.listAuthorizedFirms() || [];
      if (firms) {
        consola.info("List of authorized firms");
        firms.forEach((element) =>
          consola.log(`- ${element[0]}${element[1] ? ` (${element[1]})` : ""}`)
        );
      }

      const partners = firmCredentials.listAuthorizedPartners();
      if (partners.length > 0) {
        consola.log("\n");
        consola.info("List of authorized partners");
        partners.forEach((element) =>
          consola.log(
            `- ${element.id}${element.name ? ` (${element.name})` : ""}`
          )
        );
      }
    }
    if (options.updateName) {
      cliUtils.checkDefaultFirm(options.updateName, firmIdDefault);
      toolkit.updateFirmName(options.updateName);
    }
    if (options.refreshToken) {
      cliUtils.checkDefaultFirm(options.refreshToken, firmIdDefault);
      const refreshedTokens = await SF.refreshTokens(
        "firm",
        options.refreshToken
      );

      if (refreshedTokens) {
        consola.success(
          `Tokens refreshed for firm ID: ${options.refreshToken}`
        );
      }
    }
    if (options.refreshPartnerToken) {
      const refreshedTokens = await SF.refreshPartnerToken(
        options.refreshPartnerToken
      );

      if (refreshedTokens && refreshedTokens.partner_id) {
        consola.success(
          `Partner API key refreshed for partner ID: ${refreshedTokens.partner_id}`
        );
      }
    }
    if (options.refreshPartnerToken) {
      const refreshedTokens = await SF.refreshPartnerToken(
        options.refreshPartnerToken
      );

      if (refreshedTokens && refreshedTokens.partnerId) {
        consola.success(
          `Partner API key refreshed for partner ID: ${refreshedTokens.partner_id}`
        );
      }
    }
  });

program
  .command("get-reconciliation-id")
  .description("Fetch the ID of the reconciliation from Silverfin")
  .option("-f, --firm <firm-id>", "Specify the firm to be used", firmIdDefault)
  .option("-p, --partner <partner-id>", "Specify the partner to be used")
  .option("-h, --handle <handle>", "Fetch the reconciliation ID by handle")
  .option("-a, --all", "Fetch the ID for every reconciliation")
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    const settings = runCommandChecks(
      ["handle", "all"],
      options,
      firmIdDefault
    );

    if (options.handle) {
      toolkit.getTemplateId(
        settings.type,
        settings.envId,
        "reconciliationText",
        options.handle
      );
    } else if (options.all) {
      toolkit.getAllTemplatesId(
        settings.type,
        settings.envId,
        "reconciliationText"
      );
    }
  });

program
  .command("get-export-file-id")
  .description("Fetch the ID of an export file from Silverfin")
  .option("-f, --firm <firm-id>", "Specify the firm to be used", firmIdDefault)
  .option("-n, --name <name>", "Fetch the export file ID by name")
  .option("-a, --all", "Fetch the ID for every export file")
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    const settings = runCommandChecks(
      ["name", "all"],
      options,
      firmIdDefault,
      false
    );

    if (options.name) {
      toolkit.getTemplateId(
        settings.type,
        settings.envId,
        "exportFile",
        options.name
      );
    } else if (options.all) {
      toolkit.getAllTemplatesId(settings.type, settings.envId, "exportFile");
    }
  });

program
  .command("get-account-template-id")
  .description("Fetch the ID of an account template from Silverfin")
  .option("-f, --firm <firm-id>", "Specify the firm to be used", firmIdDefault)
  .option("-p, --partner <partner-id>", "Specify the partner to be used")
  .option("-n, --name <name>", "Fetch the account template ID by name")
  .option("-a, --all", "Fetch the ID for every account template")
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    const settings = runCommandChecks(["name", "all"], options, firmIdDefault);

    if (options.name) {
      toolkit.getTemplateId(
        settings.type,
        settings.envId,
        "accountTemplate",
        options.name
      );
    } else if (options.all) {
      toolkit.getAllTemplatesId(
        settings.type,
        settings.envId,
        "accountTemplate"
      );
    }
  });

program
  .command("get-shared-part-id")
  .description("Fetch the ID of a shared part from Silverfin")
  .option("-f, --firm <firm-id>", "Specify the firm to be used", firmIdDefault)
  .option("-p, --partner <partner-id>", "Specify the partner to be used")
  .option("-s, --shared-part <name>", "Fetch the shared part ID by name")
  .option("-a, --all", "Fetch the ID for every shared part")
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    const settings = runCommandChecks(
      ["sharedPart", "all"],
      options,
      firmIdDefault
    );

    if (options.sharedPart) {
      toolkit.getTemplateId(
        settings.type,
        settings.envId,
        "sharedPart",
        options.sharedPart
      );
    } else if (options.all) {
      toolkit.getAllTemplatesId(settings.type, settings.envId, "sharedPart");
    }
  });

// Development mode
program
  .command("development-mode")
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
    `Specify the name of the test to be run (optional). It has to be used together with "--handle"`,
    ""
  )
  .option(
    "--html",
    `Get a html file of the template's input-view generated with the Liquid Test information (optional). It has to be used together with "--handle"`,
    false
  )
  .option("--yes", "Skip the prompt confirmation (optional)")
  .action((options) => {
    cliUtils.checkDefaultFirm(options.firm, firmIdDefault);
    cliUtils.checkUniqueOption(["handle", "updateTemplates"], options);

    if (options.updateTemplates && !options.yes) {
      cliUtils.promptConfirmation();
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
  await program.parseAsync();
})();
