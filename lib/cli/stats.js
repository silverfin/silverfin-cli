const exec = require("child_process");
const chalk = require("chalk");
const fs = require("fs");
const path = require("path");
const fsUtils = require("../utils/fsUtils");
const templateUtils = require("../utils/templateUtils");
const errorUtils = require("../utils/errorUtils");
const yaml = require("yaml");
const { consola } = require("consola");

async function generateOverview(sinceDate) {
  const TODAY = new Date().toJSON().toString().slice(0, 10);
  const templateSummary = await getTemplatesSummary();
  const yamlSummary = await getYamlSummary(sinceDate);
  displayOverview(sinceDate, TODAY, templateSummary, yamlSummary);
  const row = createRow(sinceDate, TODAY, templateSummary, yamlSummary);
  saveOverviewToFile(row);
}

// Report on a single workflow when a handle is given, or on every workflow stored in the
// workflows folder when it is not
// @param {string} sinceDate The date the statistics start from (YYYY-MM-DD)
// @param {string} [workflowHandle] The workflow to report on. Every workflow when omitted
// @returns {boolean} False when nothing could be reported on. This function does not know
// whether it is the whole run, so stopping is left to the caller
async function generateWorkflowOverview(sinceDate, workflowHandle) {
  if (workflowHandle) {
    return reportOnWorkflow(sinceDate, workflowHandle);
  }
  return reportOnAllWorkflows(sinceDate);
}

// Build, display and save the statistics of one workflow
// @returns {boolean} False when the workflow could not be read. getWorkflow has already
// said why, so nothing is reported here
async function reportOnWorkflow(sinceDate, workflowHandle) {
  const workflow = fsUtils.getWorkflow(workflowHandle);
  if (!workflow) {
    return false;
  }
  const TODAY = new Date().toJSON().toString().slice(0, 10);
  const templateSummary = await getWorkflowTemplateSummary(workflow);
  const yamlSummary = await getYamlSummary(sinceDate, workflow);
  displayWorkflowOverview(sinceDate, TODAY, templateSummary, yamlSummary);
  const row = createWorkflowRow(sinceDate, TODAY, templateSummary, yamlSummary);
  // A failed write is reported by saveWorkflowOverviewToFile and does not make this a skipped
  // workflow: the statistics were gathered and displayed, only the CSV row was lost
  saveWorkflowOverviewToFile(row, workflowHandle);
  return true;
}

// Report on every workflow stored in the workflows folder. One faulty workflow must not
// block the others, so failures are collected and summarised once the loop is over
// @returns {boolean} False when not a single workflow could be reported on
async function reportOnAllWorkflows(sinceDate) {
  const workflowHandles = fsUtils.getAllWorkflowHandles();
  if (workflowHandles.length === 0) {
    errorUtils.noWorkflowsStored();
    return false;
  }

  const skippedHandles = [];
  for (const handle of workflowHandles) {
    const reported = await reportOnWorkflow(sinceDate, handle);
    if (!reported) {
      consola.warn(`Skipping workflow "${handle}"`);
      skippedHandles.push(handle);
    }
  }

  // Make sure a partial run is never mistaken for a complete one
  errorUtils.printWorkflowBatchErrorSummary(skippedHandles, workflowHandles.length);
  return skippedHandles.length < workflowHandles.length;
}

// Template names are interpolated into a regular expression. Reconciliation handles are
// restricted to word characters, but account template and export file names are not
function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Build the alternation used to match the templates of a workflow (e.g. "(handle_1|handle_2)")
// The group is always capturing, so callers can read back which template a path belongs to
// Returns undefined when there are no templates to match, since an empty alternation
// would silently match nothing at all
function buildTemplatePattern(templateNames) {
  if (!templateNames) {
    // A single folder name, not ".*": a greedy match would swallow the rest of the path
    return "([^/]+)";
  }
  if (templateNames.length === 0) {
    return undefined;
  }
  return `(${templateNames.map(escapeForRegExp).join("|")})`;
}

// Return an object with the count of activities by file and by type
// Type could be: A (added), M (modified), D (deleted)
async function yamlFilesActivity(sinceDate, workflow) {
  const countByType = {};

  // Files to Search (YAML)
  const templatesInWorkflow = workflow ? workflow.templates.reconciliations.concat(workflow.templates.accounts) : undefined;
  const TEMPLATE_PATTERN = buildTemplatePattern(templatesInWorkflow);
  if (!TEMPLATE_PATTERN) {
    consola.info("This workflow contains no reconciliations or account templates, so no YAML file changes can be counted");
    return countByType;
  }
  const YAML_EXPRESSION = `.*/${TEMPLATE_PATTERN}/tests/.*_liquid_test.*.y(a)?ml`;
  const fileTypeRegExp = RegExp(YAML_EXPRESSION, "g");

  const filesChanged = exec.execSync(`git whatchanged --since="${sinceDate}" --name-status --pretty="format:"`);
  if (!filesChanged) {
    consola.info("No files were changed since the date provided");
    return countByType;
  }

  const rows = filesChanged.toString().split("\n");
  const nonEmptyRows = rows.filter(Boolean);
  if (!nonEmptyRows || nonEmptyRows.length === 0) {
    consola.info("No files were changed since the date provided");
    return countByType;
  }

  for (const row of nonEmptyRows) {
    const fileInfo = row.toString().trim().split("\t");
    const fileActivity = fileInfo[0];
    const filePath = fileInfo[1];

    // File type check
    const typeCheck = filePath.match(fileTypeRegExp);
    if (!typeCheck) {
      continue;
    }

    // Check empty file
    let fileNotEmpty = false;
    if (fs.existsSync(filePath)) {
      const contentRows = fs.readFileSync(filePath).toString().split("\n");
      if (contentRows.length > 1) {
        fileNotEmpty = true;
      }
    }
    if (!fileNotEmpty) {
      continue;
    }

    // Count By Type
    if (!Object.hasOwn(countByType, fileActivity)) {
      countByType[fileActivity] = 1;
    } else {
      countByType[fileActivity] += 1;
    }
  }
  return countByType;
}

// Count how many templates hold at least one non empty YAML file, how many unit tests are
// stored (we base on the presence of a title for each unit test) and how many templates hold
// at least two unit tests
// A template is counted once no matter how many test files sit in its tests folder, since the
// counts are compared against a number of templates
async function countYamlFiles(templateType, templatesInWorkflow) {
  const TEMPLATE_PATTERN = buildTemplatePattern(templatesInWorkflow);
  // The workflow holds no template of this type, so there is nothing to count
  if (!TEMPLATE_PATTERN) {
    return { templatesWithTests: 0, tests: 0, templatesWithAtLeastTwoTests: 0 };
  }
  const yamlFiles = fsUtils.listExistingFiles("yml");
  const FOLDER = fsUtils.FOLDERS[templateType];
  const YAML_EXPRESSION = `.*${FOLDER}/${TEMPLATE_PATTERN}/tests/.*_liquid_test.*.y(a)?ml`;
  // No global flag: the first match is the one we need, and its capture group names the template
  const re = new RegExp(YAML_EXPRESSION);
  // Unit tests found per template, so several test files in one tests folder are added up
  const testsPerTemplate = {};
  for (const yamlFile of yamlFiles) {
    const found = yamlFile.match(re);
    if (found && fs.existsSync(yamlFile)) {
      const templateName = found[1];
      const fileContent = fs.readFileSync(yamlFile).toString();
      const contentRows = fileContent.split("\n");
      if (contentRows.length > 1) {
        testsPerTemplate[templateName] = testsPerTemplate[templateName] || 0;
        try {
          const yamlContent = await yaml.parse(fileContent, {
            maxAliasCount: 10000,
          });
          testsPerTemplate[templateName] += Object.keys(yamlContent).length || 0;
        } catch (error) {
          // The file exists but cannot be read as YAML. It still counts as a test file, and the
          // template keeps the unit tests found in its other files
          consola.debug(`${yamlFile} could not be parsed as YAML: ${error.message}`);
        }
      }
    }
  }
  const testCounts = Object.values(testsPerTemplate);
  return {
    templatesWithTests: testCounts.length,
    tests: testCounts.reduce((total, count) => total + count, 0),
    templatesWithAtLeastTwoTests: testCounts.filter((count) => count >= 2).length,
  };
}

// Return an array with non empty template names of a given type
// We base on the presence of a non empty main.
async function listNonEmptyTemplates(templateType) {
  const templateNames = fsUtils.getAllTemplatesOfAType(templateType);
  const nonEmptyTemplates = [];
  for (const template of templateNames) {
    const filePath = await setMainPath(templateType, template);
    if (!filePath) {
      continue;
    }
    const contentRows = fs.readFileSync(filePath).toString().split("\n");
    if (contentRows.length > 1) {
      nonEmptyTemplates.push(template);
    }
  }
  return nonEmptyTemplates;
}

// Return an array with the externally managed templates
async function listExternallyManagedTemplates(templateType, templateNames) {
  const externallyManagedTemplates = [];
  for (const template of templateNames) {
    const configTemplate = fsUtils.readConfig(templateType, template);
    const externallyManaged = configTemplate.externally_managed || false;
    if (externallyManaged) {
      externallyManagedTemplates.push(template);
    }
  }
  return externallyManagedTemplates;
}

async function setMainPath(templateType, templateName) {
  const FOLDER = fsUtils.FOLDERS[templateType];
  const mainPath = path.join(process.cwd(), FOLDER, templateName, "main.liquid");
  const namePath = path.join(process.cwd(), FOLDER, templateName, `${templateName}.liquid`);
  let filePath = undefined;
  if (fs.existsSync(mainPath)) {
    filePath = mainPath;
  } else if (fs.existsSync(namePath)) {
    filePath = namePath;
  }
  return filePath;
}

function percentageRoundTwo(numerator, denominator) {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}

async function getTemplatesSummary() {
  const summary = {
    reconciliations: {
      total: 0,
      externallyManaged: 0,
      externallyManagedPerc: 0,
      templatesWithTests: 0,
      templatesWithTestsPerc: 0,
      unitTests: 0,
      templatesWithAtLeastTwoTests: 0,
      templatesWithAtLeastTwoTestsPerc: 0,
    },
    sharedParts: {
      total: 0,
      externallyManaged: 0,
      externallyManagedPerc: 0,
    },
    exportFiles: {
      total: 0,
      externallyManaged: 0,
      externallyManagedPerc: 0,
    },
    accountTemplates: {
      total: 0,
      externallyManaged: 0,
      externallyManagedPerc: 0,
      templatesWithTests: 0,
      templatesWithTestsPerc: 0,
      unitTests: 0,
      templatesWithAtLeastTwoTests: 0,
      templatesWithAtLeastTwoTestsPerc: 0,
    },
    all: {
      total: 0,
      externallyManaged: 0,
      externallyManagedPerc: 0,
      templatesWithTests: 0,
      templatesWithTestsPerc: 0,
      unitTests: 0,
      templatesWithAtLeastTwoTests: 0,
      templatesWithAtLeastTwoTestsPerc: 0,
    },
  };

  // Reconciliations
  const reconciliationsNonEmpty = await listNonEmptyTemplates("reconciliationText");
  const reconciliationsExtMan = await listExternallyManagedTemplates("reconciliationText", reconciliationsNonEmpty);
  const reconciliationsTests = await countYamlFiles("reconciliationText");
  summary.reconciliations.total = reconciliationsNonEmpty.length;
  summary.reconciliations.externallyManaged = reconciliationsExtMan.length;
  summary.reconciliations.externallyManagedPerc = percentageRoundTwo(summary.reconciliations.externallyManaged, summary.reconciliations.total);
  summary.reconciliations.templatesWithTests = reconciliationsTests.templatesWithTests;
  summary.reconciliations.templatesWithTestsPerc = percentageRoundTwo(summary.reconciliations.templatesWithTests, summary.reconciliations.total);
  summary.reconciliations.unitTests = reconciliationsTests.tests;
  summary.reconciliations.templatesWithAtLeastTwoTests = reconciliationsTests.templatesWithAtLeastTwoTests;
  summary.reconciliations.templatesWithAtLeastTwoTestsPerc = percentageRoundTwo(summary.reconciliations.templatesWithAtLeastTwoTests, summary.reconciliations.total);

  // Shared Parts
  const sharedPartsNonEmpty = await listNonEmptyTemplates("sharedPart");
  const sharedPartsExtMan = await listExternallyManagedTemplates("sharedPart", sharedPartsNonEmpty);
  summary.sharedParts.total = sharedPartsNonEmpty.length;
  summary.sharedParts.externallyManaged = sharedPartsExtMan.length;
  summary.sharedParts.externallyManagedPerc = percentageRoundTwo(summary.sharedParts.externallyManaged, summary.sharedParts.total);

  // Export Files
  const exportFilesNonEmpty = await listNonEmptyTemplates("exportFile");
  const exportFilesExtMan = await listExternallyManagedTemplates("exportFile", exportFilesNonEmpty);
  summary.exportFiles.total = exportFilesNonEmpty.length;
  summary.exportFiles.externallyManaged = exportFilesExtMan.length;
  summary.exportFiles.externallyManagedPerc = percentageRoundTwo(summary.exportFiles.externallyManaged, summary.exportFiles.total);

  // Account Templates
  const accountTemplatesNonEmpty = await listNonEmptyTemplates("accountTemplate");
  const accountTemplatesExtMan = await listExternallyManagedTemplates("accountTemplate", accountTemplatesNonEmpty);
  const accountTemplatesTests = await countYamlFiles("accountTemplate");
  summary.accountTemplates.total = accountTemplatesNonEmpty.length;
  summary.accountTemplates.externallyManaged = accountTemplatesExtMan.length;
  summary.accountTemplates.externallyManagedPerc = percentageRoundTwo(summary.accountTemplates.externallyManaged, summary.accountTemplates.total);
  summary.accountTemplates.templatesWithTests = accountTemplatesTests.templatesWithTests;
  summary.accountTemplates.templatesWithTestsPerc = percentageRoundTwo(summary.accountTemplates.templatesWithTests, summary.accountTemplates.total);
  summary.accountTemplates.unitTests = accountTemplatesTests.tests;
  summary.accountTemplates.templatesWithAtLeastTwoTests = accountTemplatesTests.templatesWithAtLeastTwoTests;
  summary.accountTemplates.templatesWithAtLeastTwoTestsPerc = percentageRoundTwo(summary.accountTemplates.templatesWithAtLeastTwoTests, summary.accountTemplates.total);

  // All
  summary.all.total = summary.reconciliations.total + summary.sharedParts.total + summary.exportFiles.total + summary.accountTemplates.total;
  summary.all.externallyManaged =
    summary.reconciliations.externallyManaged + summary.sharedParts.externallyManaged + summary.exportFiles.externallyManaged + summary.accountTemplates.externallyManaged;
  summary.all.externallyManagedPerc = percentageRoundTwo(summary.all.externallyManaged, summary.all.total);
  summary.all.templatesWithTests = summary.reconciliations.templatesWithTests + summary.accountTemplates.templatesWithTests;
  summary.all.templatesWithTestsPerc = percentageRoundTwo(summary.all.templatesWithTests, summary.reconciliations.total + summary.accountTemplates.total);
  summary.all.unitTests = summary.reconciliations.unitTests + summary.accountTemplates.unitTests;
  summary.all.templatesWithAtLeastTwoTests = summary.reconciliations.templatesWithAtLeastTwoTests + summary.accountTemplates.templatesWithAtLeastTwoTests;
  summary.all.templatesWithAtLeastTwoTestsPerc = percentageRoundTwo(summary.all.templatesWithAtLeastTwoTests, summary.reconciliations.total + summary.accountTemplates.total);

  return summary;
}

async function getWorkflowTemplateSummary(workflow) {
  const summary = {
    workflow_name: "",
    reconciliations: {
      total: 0,
      externallyManaged: 0,
      externallyManagedPerc: 0,
      templatesWithTests: 0,
      templatesWithTestsPerc: 0,
      unitTests: 0,
      templatesWithAtLeastTwoTests: 0,
      templatesWithAtLeastTwoTestsPerc: 0,
    },
    exportFiles: {
      total: 0,
      externallyManaged: 0,
      externallyManagedPerc: 0,
    },
    accountTemplates: {
      total: 0,
      externallyManaged: 0,
      externallyManagedPerc: 0,
      templatesWithTests: 0,
      templatesWithTestsPerc: 0,
      unitTests: 0,
      templatesWithAtLeastTwoTests: 0,
      templatesWithAtLeastTwoTestsPerc: 0,
    },
    all: {
      total: 0,
      externallyManaged: 0,
      externallyManagedPerc: 0,
      templatesWithTests: 0,
      templatesWithTestsPerc: 0,
      unitTests: 0,
      templatesWithAtLeastTwoTests: 0,
      templatesWithAtLeastTwoTestsPerc: 0,
    },
  };

  // Fetch workflow
  // Assume no empty items if present within the workflow.
  summary.workflow_name = workflow.name;

  // Reconciliations
  const reconciliationsInWorkflow = workflow.templates.reconciliations;
  const reconciliationsExtMan = await listExternallyManagedTemplates("reconciliationText", reconciliationsInWorkflow);
  const reconciliationsTests = await countYamlFiles("reconciliationText", reconciliationsInWorkflow);
  summary.reconciliations.total = reconciliationsInWorkflow.length;
  summary.reconciliations.externallyManaged = reconciliationsExtMan.length;
  summary.reconciliations.externallyManagedPerc = percentageRoundTwo(summary.reconciliations.externallyManaged, summary.reconciliations.total);
  summary.reconciliations.templatesWithTests = reconciliationsTests.templatesWithTests;
  summary.reconciliations.templatesWithTestsPerc = percentageRoundTwo(summary.reconciliations.templatesWithTests, summary.reconciliations.total);
  summary.reconciliations.unitTests = reconciliationsTests.tests;
  summary.reconciliations.templatesWithAtLeastTwoTests = reconciliationsTests.templatesWithAtLeastTwoTests;
  summary.reconciliations.templatesWithAtLeastTwoTestsPerc = percentageRoundTwo(summary.reconciliations.templatesWithAtLeastTwoTests, summary.reconciliations.total);

  // Export Files
  const exportFilesInWorkflow = workflow.templates.exports;
  const exportFilesExtMan = await listExternallyManagedTemplates("exportFile", exportFilesInWorkflow);
  summary.exportFiles.total = exportFilesInWorkflow.length;
  summary.exportFiles.externallyManaged = exportFilesExtMan.length;
  summary.exportFiles.externallyManagedPerc = percentageRoundTwo(summary.exportFiles.externallyManaged, summary.exportFiles.total);

  // Account Templates
  const accountTemplatesInWorkflow = workflow.templates.accounts;
  const accountTemplatesExtMan = await listExternallyManagedTemplates("accountTemplate", accountTemplatesInWorkflow);
  const accountTemplatesTests = await countYamlFiles("accountTemplate", accountTemplatesInWorkflow);
  summary.accountTemplates.total = accountTemplatesInWorkflow.length;
  summary.accountTemplates.externallyManaged = accountTemplatesExtMan.length;
  summary.accountTemplates.externallyManagedPerc = percentageRoundTwo(summary.accountTemplates.externallyManaged, summary.accountTemplates.total);
  summary.accountTemplates.templatesWithTests = accountTemplatesTests.templatesWithTests;
  summary.accountTemplates.templatesWithTestsPerc = percentageRoundTwo(summary.accountTemplates.templatesWithTests, summary.accountTemplates.total);
  summary.accountTemplates.unitTests = accountTemplatesTests.tests;
  summary.accountTemplates.templatesWithAtLeastTwoTests = accountTemplatesTests.templatesWithAtLeastTwoTests;
  summary.accountTemplates.templatesWithAtLeastTwoTestsPerc = percentageRoundTwo(summary.accountTemplates.templatesWithAtLeastTwoTests, summary.accountTemplates.total);

  // All
  summary.all.total = summary.reconciliations.total + summary.exportFiles.total + summary.accountTemplates.total;
  summary.all.externallyManaged =
    summary.reconciliations.externallyManaged + summary.exportFiles.externallyManaged + summary.accountTemplates.externallyManaged;
  summary.all.externallyManagedPerc = percentageRoundTwo(summary.all.externallyManaged, summary.all.total);
  summary.all.templatesWithTests = summary.reconciliations.templatesWithTests + summary.accountTemplates.templatesWithTests;
  summary.all.templatesWithTestsPerc = percentageRoundTwo(summary.all.templatesWithTests, summary.reconciliations.total + summary.accountTemplates.total);
  summary.all.unitTests = summary.reconciliations.unitTests + summary.accountTemplates.unitTests;
  summary.all.templatesWithAtLeastTwoTests = summary.reconciliations.templatesWithAtLeastTwoTests + summary.accountTemplates.templatesWithAtLeastTwoTests;
  summary.all.templatesWithAtLeastTwoTestsPerc = percentageRoundTwo(summary.all.templatesWithAtLeastTwoTests, summary.reconciliations.total + summary.accountTemplates.total);

  return summary;
}

async function getYamlSummary(sinceDate, templatesInWorkflow) {
  const yamlActivity = await yamlFilesActivity(sinceDate, templatesInWorkflow);
  const summary = { created: 0, updated: 0 };
  summary.created = (yamlActivity["A"] || 0) - (yamlActivity["D"] || 0);
  summary.updated = yamlActivity["M"] || 0;
  return summary;
}

function displayOverview(sinceDate, today, templateSummary, yamlSummary) {
  consola.log("");
  consola.info(`${chalk.bold(`Summary ( ${sinceDate} - ${today} ):`)}`);
  consola.log("------------------------------------");
  consola.log("");
  consola.log(`New YAML files created in the period: ${yamlSummary.created}`);
  consola.log(`Updates to existing YAML files in the period: ${yamlSummary.updated}`);
  consola.log("");
  consola.log("------------------------------------");
  consola.log("");
  consola.log(`${chalk.bold("Reconciliations:")}`);
  consola.log(`Templates: ${templateSummary.reconciliations.total}`);
  consola.log(`Externally Managed: ${templateSummary.reconciliations.externallyManaged} (${templateSummary.reconciliations.externallyManagedPerc}%)`);
  consola.log(`Templates with YAML tests: ${templateSummary.reconciliations.templatesWithTests} (${templateSummary.reconciliations.templatesWithTestsPerc}%)`);
  consola.log(`Unit Tests: ${templateSummary.reconciliations.unitTests}`);
  consola.log(
    `Templates with at least two unit tests: ${templateSummary.reconciliations.templatesWithAtLeastTwoTests} (${templateSummary.reconciliations.templatesWithAtLeastTwoTestsPerc}%)`
  );
  consola.log("");
  consola.log(`${chalk.bold("Account Templates:")}`);
  consola.log(`Templates: ${templateSummary.accountTemplates.total}`);
  consola.log(`Externally Managed: ${templateSummary.accountTemplates.externallyManaged} (${templateSummary.accountTemplates.externallyManagedPerc}%)`);
  consola.log(`Templates with YAML tests: ${templateSummary.accountTemplates.templatesWithTests} (${templateSummary.accountTemplates.templatesWithTestsPerc}%)`);
  consola.log(`Unit Tests: ${templateSummary.accountTemplates.unitTests}`);
  consola.log(
    `Templates with at least two unit tests: ${templateSummary.accountTemplates.templatesWithAtLeastTwoTests} (${templateSummary.accountTemplates.templatesWithAtLeastTwoTestsPerc}%)`
  );
  consola.log("");
  consola.log(`${chalk.bold("Shared Parts:")}`);
  consola.log(`Templates: ${templateSummary.sharedParts.total}`);
  consola.log(`Externally Managed: ${templateSummary.sharedParts.externallyManaged} (${templateSummary.sharedParts.externallyManagedPerc}%)`);
  consola.log("");
  consola.log(`${chalk.bold("Export Files:")}`);
  consola.log(`Templates: ${templateSummary.exportFiles.total}`);
  consola.log(`Externally Managed: ${templateSummary.exportFiles.externallyManaged} (${templateSummary.exportFiles.externallyManagedPerc}%)`);
  consola.log("");
  consola.log(`${chalk.bold("All:")}`);
  consola.log(`Templates: ${templateSummary.all.total}`);
  consola.log(`Externally Managed: ${templateSummary.all.externallyManaged} (${templateSummary.all.externallyManagedPerc}%)`);
  consola.log(`Templates with YAML tests: ${templateSummary.all.templatesWithTests} (${templateSummary.all.templatesWithTestsPerc}%)`);
  consola.log(`Unit Tests: ${templateSummary.all.unitTests}`);
  consola.log(`Templates with at least two unit tests: ${templateSummary.all.templatesWithAtLeastTwoTests} (${templateSummary.all.templatesWithAtLeastTwoTestsPerc}%)`);
  consola.log("");
  consola.log("------------------------------------");
}

function displayWorkflowOverview(sinceDate, today, templateSummary, yamlSummary) {
  // Header
  consola.log("");
  consola.info(`${chalk.bold(`Workflow Summary - ${templateSummary.workflow_name} ( ${sinceDate} - ${today} ):`)}`);
  consola.log("------------------------------------");
  consola.log("");
  // YAML file changes
  consola.log(`New YAML files created in the period: ${yamlSummary.created}`);
  consola.log(`Updates to existing YAML files in the period: ${yamlSummary.updated}`);
  consola.log("");
  consola.log("------------------------------------");
  consola.log("");
  // Reconciliations
  consola.log(`${chalk.bold("Reconciliations:")}`);
  consola.log(`Templates: ${templateSummary.reconciliations.total}`);
  consola.log(`Externally Managed: ${templateSummary.reconciliations.externallyManaged} (${templateSummary.reconciliations.externallyManagedPerc}%)`);
  consola.log(`Templates with YAML tests: ${templateSummary.reconciliations.templatesWithTests} (${templateSummary.reconciliations.templatesWithTestsPerc}%)`);
  consola.log(`Unit Tests: ${templateSummary.reconciliations.unitTests}`);
  consola.log(
    `Templates with at least two unit tests: ${templateSummary.reconciliations.templatesWithAtLeastTwoTests} (${templateSummary.reconciliations.templatesWithAtLeastTwoTestsPerc}%)`
  );
  consola.log("");
  // Account Templates
  consola.log(`${chalk.bold("Account Templates:")}`);
  consola.log(`Templates: ${templateSummary.accountTemplates.total}`);
  consola.log(`Externally Managed: ${templateSummary.accountTemplates.externallyManaged} (${templateSummary.accountTemplates.externallyManagedPerc}%)`);
  consola.log(`Templates with YAML tests: ${templateSummary.accountTemplates.templatesWithTests} (${templateSummary.accountTemplates.templatesWithTestsPerc}%)`);
  consola.log(`Unit Tests: ${templateSummary.accountTemplates.unitTests}`);
  consola.log(
    `Templates with at least two unit tests: ${templateSummary.accountTemplates.templatesWithAtLeastTwoTests} (${templateSummary.accountTemplates.templatesWithAtLeastTwoTestsPerc}%)`
  );
  consola.log("");
  // Export Files
  consola.log(`${chalk.bold("Export Files:")}`);
  consola.log(`Templates: ${templateSummary.exportFiles.total}`);
  consola.log(`Externally Managed: ${templateSummary.exportFiles.externallyManaged} (${templateSummary.exportFiles.externallyManagedPerc}%)`);
  consola.log("");
  // All
  consola.log(`${chalk.bold("All:")}`);
  consola.log(`Templates: ${templateSummary.all.total}`);
  consola.log(`Externally Managed: ${templateSummary.all.externallyManaged} (${templateSummary.all.externallyManagedPerc}%)`);
  consola.log(`Templates with YAML tests: ${templateSummary.all.templatesWithTests} (${templateSummary.all.templatesWithTestsPerc}%)`);
  consola.log(`Unit Tests: ${templateSummary.all.unitTests}`);
  consola.log(`Templates with at least two unit tests: ${templateSummary.all.templatesWithAtLeastTwoTests} (${templateSummary.all.templatesWithAtLeastTwoTestsPerc}%)`);
  consola.log("");
  consola.log("------------------------------------");
}

function createRow(sinceDate, today, templateSummary, yamlSummary) {
  // Row to append to file
  const rowContent = [
    sinceDate,
    today,
    yamlSummary.created,
    yamlSummary.updated,
    templateSummary.all.total,
    templateSummary.all.externallyManaged,
    templateSummary.all.templatesWithTests,
    templateSummary.all.unitTests,
    templateSummary.reconciliations.total,
    templateSummary.reconciliations.externallyManaged,
    templateSummary.reconciliations.templatesWithTests,
    templateSummary.reconciliations.unitTests,
    templateSummary.accountTemplates.total,
    templateSummary.accountTemplates.externallyManaged,
    templateSummary.accountTemplates.templatesWithTests,
    templateSummary.accountTemplates.unitTests,
    templateSummary.sharedParts.total,
    templateSummary.sharedParts.externallyManaged,
    templateSummary.exportFiles.total,
    templateSummary.exportFiles.externallyManaged,
    templateSummary.all.externallyManagedPerc,
    templateSummary.reconciliations.externallyManagedPerc,
    templateSummary.accountTemplates.externallyManagedPerc,
    templateSummary.sharedParts.externallyManagedPerc,
    templateSummary.exportFiles.externallyManagedPerc,
    templateSummary.all.templatesWithTestsPerc,
    templateSummary.reconciliations.templatesWithTestsPerc,
    templateSummary.accountTemplates.templatesWithTestsPerc,
    templateSummary.reconciliations.templatesWithAtLeastTwoTests,
    templateSummary.reconciliations.templatesWithAtLeastTwoTestsPerc,
    templateSummary.accountTemplates.templatesWithAtLeastTwoTests,
    templateSummary.accountTemplates.templatesWithAtLeastTwoTestsPerc,
  ];
  const row = `\r\n${rowContent.join(";")}`;
  return row;
}

function createWorkflowRow(sinceDate, today, templateSummary, yamlSummary) {
  const rowContent = [
    templateSummary.workflow_name,
    sinceDate,
    today,
    yamlSummary.created,
    yamlSummary.updated,
    templateSummary.all.total,
    templateSummary.all.externallyManaged,
    templateSummary.all.templatesWithTests,
    templateSummary.all.unitTests,
    templateSummary.reconciliations.total,
    templateSummary.reconciliations.externallyManaged,
    templateSummary.reconciliations.templatesWithTests,
    templateSummary.reconciliations.unitTests,
    templateSummary.accountTemplates.total,
    templateSummary.accountTemplates.externallyManaged,
    templateSummary.accountTemplates.templatesWithTests,
    templateSummary.accountTemplates.unitTests,
    templateSummary.exportFiles.total,
    templateSummary.exportFiles.externallyManaged,
    templateSummary.all.externallyManagedPerc,
    templateSummary.reconciliations.externallyManagedPerc,
    templateSummary.accountTemplates.externallyManagedPerc,
    templateSummary.exportFiles.externallyManagedPerc,
    templateSummary.all.templatesWithTestsPerc,
    templateSummary.reconciliations.templatesWithTestsPerc,
    templateSummary.accountTemplates.templatesWithTestsPerc,
    templateSummary.reconciliations.templatesWithAtLeastTwoTests,
    templateSummary.reconciliations.templatesWithAtLeastTwoTestsPerc,
    templateSummary.accountTemplates.templatesWithAtLeastTwoTests,
    templateSummary.accountTemplates.templatesWithAtLeastTwoTestsPerc,
  ];
  const row = `\r\n${rowContent.join(";")}`;
  return row;
}

// Write one row of statistics, creating the file and its header columns when needed
// The summary has already been displayed, so a write failure is reported and the run ends
// normally instead of throwing at the user
// @returns {boolean} False when the statistics could not be written
function writeStatisticsRow(csvPath, rowHeader, row) {
  try {
    if (!fs.existsSync("./stats")) {
      fs.mkdirSync("stats");
    }
    if (!fs.existsSync(csvPath)) {
      fs.writeFileSync(csvPath, rowHeader);
    }
    fs.appendFileSync(csvPath, row);
    return true;
  } catch (error) {
    consola.debug(error);
    return errorUtils.statisticsNotWritten(csvPath, error);
  }
}

// content row must be a string with each column separated by ";"
function saveOverviewToFile(row) {
  const COLUMNS = [
    "Period - Start",
    "Period - End",
    "yaml files created in period",
    "yaml files modified in period",
    "All - templates",
    "All - externally managed",
    "All - templates with yaml tests",
    "All - unit tests",
    "Reconciliations - templates",
    "Reconciliations - externally managed",
    "Reconciliations - templates with yaml tests",
    "Reconciliations - unit tests",
    "Account Templates - templates",
    "Account Templates - externally managed",
    "Account Templates - templates with yaml tests",
    "Account Templates - unit tests",
    "Shared Parts - templates",
    "Shared Parts - externally managed",
    "Export Files - templates",
    "Export Files - externally managed",
    "All - externally managed (%)",
    "Reconciliations - externally managed (%)",
    "Account Templates - externally managed (%)",
    "Shared Parts - externally managed (%)",
    "Export Files - externally managed (%)",
    "All - templates with yaml tests (%)",
    "Reconciliations - templates with yaml tests (%)",
    "Account Templates - templates with yaml tests (%)",
    "Reconciliations - templates with at least two tests",
    "Reconciliations - templates with at least two tests (%)",
    "Account Templates - templates with at least two tests",
    "Account Templates - templates with at least two tests (%)",
  ];
  const ROW_HEADER = `${COLUMNS.join(";")}`;
  const CSV_PATH = `./stats/overview.csv`;
  return writeStatisticsRow(CSV_PATH, ROW_HEADER, row);
}

// content row must be a string with each column separated by ";"
function saveWorkflowOverviewToFile(row, workflowHandle) {
  // The handle becomes part of the file name, so an unsafe one would write outside ./stats
  if (!templateUtils.isSafeName(workflowHandle)) {
    errorUtils.workflowStatisticsNotSaved(workflowHandle);
    return;
  }

  const COLUMNS = [
    "Workflow Name",
    "Period - Start",
    "Period - End",
    "yaml files created in period",
    "yaml files modified in period",
    "All - templates",
    "All - externally managed",
    "All - templates with yaml tests",
    "All - unit tests",
    "Reconciliations - templates",
    "Reconciliations - externally managed",
    "Reconciliations - templates with yaml tests",
    "Reconciliations - unit tests",
    "Account Templates - templates",
    "Account Templates - externally managed",
    "Account Templates - templates with yaml tests",
    "Account Templates - unit tests",
    "Export Files - templates",
    "Export Files - externally managed",
    "All - externally managed (%)",
    "Reconciliations - externally managed (%)",
    "Account Templates - externally managed (%)",
    "Export Files - externally managed (%)",
    "All - templates with yaml tests (%)",
    "Reconciliations - templates with yaml tests (%)",
    "Account Templates - templates with yaml tests (%)",
    "Reconciliations - templates with at least two tests",
    "Reconciliations - templates with at least two tests (%)",
    "Account Templates - templates with at least two tests",
    "Account Templates - templates with at least two tests (%)",
  ];
  const ROW_HEADER = `${COLUMNS.join(";")}`;
  const CSV_PATH = `./stats/${workflowHandle}_stats.csv`;
  return writeStatisticsRow(CSV_PATH, ROW_HEADER, row);
}

module.exports = { generateOverview, generateWorkflowOverview };
