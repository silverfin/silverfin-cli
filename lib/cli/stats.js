const exec = require("child_process");
const chalk = require("chalk");
const fs = require("fs");
const path = require("path");
const fsUtils = require("../utils/fsUtils");
const yaml = require("yaml");
const { consola } = require("consola");

async function generateOverview(sinceDate) {
  const TODAY = new Date().toJSON().toString().slice(0, 10);
  const templateSummary = await getTemplatesSummary();
  const yamlSummary = await getYamlSummary(sinceDate);
  // Terminal
  displayOverview(sinceDate, TODAY, templateSummary, yamlSummary);
  // File
  const row = createRow(sinceDate, TODAY, templateSummary, yamlSummary);
  saveOverviewToFile(row);
}

// Return an object with the count of activities by file and by type
// Type could be: A (added), M (modified), D (deleted)
async function yamlFilesActivity(sinceDate) {
  const countByType = {};
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

  // Files to Search (YAML)
  const YAML_EXPRESSION = `.*/.*/tests/.*_liquid_test.*.y(a)?ml`;
  const fileTypeRegExp = RegExp(YAML_EXPRESSION, "g");

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

// Count how many YAML files are stored. We base on the presence of a non empty file
// Count how many unit tests are stored. We base on the presence of a title for each unit test
async function countYamlFiles(templateType) {
  const files = fsUtils.listExistingFiles("yml");
  const FOLDER = fsUtils.FOLDERS[templateType];
  const YAML_EXPRESSION = `.*${FOLDER}/.*/tests/.*_liquid_test.*.y(a)?ml`;
  const re = new RegExp(YAML_EXPRESSION, "g");
  let countFiles = 0;
  let countTests = 0;
  for (const file of files) {
    const found = file.match(re);
    if (found && fs.existsSync(file)) {
      const fileContent = fs.readFileSync(file).toString();
      const contentRows = fileContent.split("\n");
      if (contentRows.length > 1) {
        countFiles += 1;
        try {
          const yamlContent = await yaml.parse(fileContent, {
            maxAliasCount: 10000,
          });
          const unitTestsCount = Object.keys(yamlContent).length || 0;
          countTests += unitTestsCount;
        } catch (e) {
          // Error while parsing the YAML file
          // consola.log(e);
        }
      }
    }
  }
  return { files: countFiles, tests: countTests };
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
      yamlFiles: 0,
      yamlFilesPerc: 0,
      unitTests: 0,
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
      yamlFiles: 0,
      yamlFilesPerc: 0,
      unitTests: 0,
    },
    all: {
      total: 0,
      externallyManaged: 0,
      externallyManagedPerc: 0,
      yamlFiles: 0,
      yamlFilesPerc: 0,
      unitTests: 0,
    },
  };

  // Reconciliations
  const reconciliationsNonEmpty = await listNonEmptyTemplates("reconciliationText");
  const reconciliationsExtMan = await listExternallyManagedTemplates("reconciliationText", reconciliationsNonEmpty);
  const reconciliationsTests = await countYamlFiles("reconciliationText");
  summary.reconciliations.total = reconciliationsNonEmpty.length;
  summary.reconciliations.externallyManaged = reconciliationsExtMan.length;
  summary.reconciliations.externallyManagedPerc = percentageRoundTwo(summary.reconciliations.externallyManaged, summary.reconciliations.total);
  summary.reconciliations.yamlFiles = reconciliationsTests.files;
  summary.reconciliations.yamlFilesPerc = percentageRoundTwo(summary.reconciliations.yamlFiles, summary.reconciliations.total);
  summary.reconciliations.unitTests = reconciliationsTests.tests;

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
  summary.accountTemplates.yamlFiles = accountTemplatesTests.files;
  summary.accountTemplates.yamlFilesPerc = percentageRoundTwo(summary.accountTemplates.yamlFiles, summary.accountTemplates.total);
  summary.accountTemplates.unitTests = accountTemplatesTests.tests;

  // All
  summary.all.total = summary.reconciliations.total + summary.sharedParts.total + summary.exportFiles.total + summary.accountTemplates.total;
  summary.all.externallyManaged =
    summary.reconciliations.externallyManaged + summary.sharedParts.externallyManaged + summary.exportFiles.externallyManaged + summary.accountTemplates.externallyManaged;
  summary.all.externallyManagedPerc = percentageRoundTwo(summary.all.externallyManaged, summary.all.total);
  summary.all.yamlFiles = summary.reconciliations.yamlFiles + summary.accountTemplates.yamlFiles;
  summary.all.yamlFilesPerc = percentageRoundTwo(summary.all.yamlFiles, summary.reconciliations.total + summary.accountTemplates.total);
  summary.all.unitTests = summary.reconciliations.unitTests + summary.accountTemplates.unitTests;

  return summary;
}

async function getYamlSummary(sinceDate) {
  const yamlActivity = await yamlFilesActivity(sinceDate);
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
  consola.log(`YAML files: ${templateSummary.reconciliations.yamlFiles} (${templateSummary.reconciliations.yamlFilesPerc}%)`);
  consola.log(`Unit Tests: ${templateSummary.reconciliations.unitTests}`);
  consola.log("");
  consola.log(`${chalk.bold("Account Templates:")}`);
  consola.log(`Templates: ${templateSummary.accountTemplates.total}`);
  consola.log(`Externally Managed: ${templateSummary.accountTemplates.externallyManaged} (${templateSummary.accountTemplates.externallyManagedPerc}%)`);
  consola.log(`YAML files: ${templateSummary.accountTemplates.yamlFiles} (${templateSummary.accountTemplates.yamlFilesPerc}%)`);
  consola.log(`Unit Tests: ${templateSummary.accountTemplates.unitTests}`);
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
  consola.log(`YAML files: ${templateSummary.all.yamlFiles} (${templateSummary.all.yamlFilesPerc}%)`);
  consola.log(`Unit Tests: ${templateSummary.all.unitTests}`);
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
    templateSummary.all.yamlFiles,
    templateSummary.all.unitTests,
    templateSummary.reconciliations.total,
    templateSummary.reconciliations.externallyManaged,
    templateSummary.reconciliations.yamlFiles,
    templateSummary.reconciliations.unitTests,
    templateSummary.accountTemplates.total,
    templateSummary.accountTemplates.externallyManaged,
    templateSummary.accountTemplates.yamlFiles,
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
    templateSummary.all.yamlFilesPerc,
    templateSummary.reconciliations.yamlFilesPerc,
    templateSummary.accountTemplates.yamlFilesPerc,
  ];
  const row = `\r\n${rowContent.join(";")}`;
  return row;
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
    "All - yaml files",
    "All - unit tests",
    "Reconciliations - templates",
    "Reconciliations - externally managed",
    "Reconciliations - yaml files",
    "Reconciliations - unit tests",
    "Account Templates - templates",
    "Account Templates - externally managed",
    "Account Templates - yaml files",
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
    "All - yaml files (%)",
    "Reconciliations - yaml files (%)",
    "Account Templates - yaml files (%)",
  ];
  const ROW_HEADER = `${COLUMNS.join(";")}`;
  const CSV_PATH = `./stats/overview.csv`;
  // Create file and header columns
  if (!fs.existsSync("./stats")) {
    fs.mkdirSync("stats");
  }
  if (!fs.existsSync(CSV_PATH)) {
    fs.writeFileSync(CSV_PATH, ROW_HEADER, (err) => {
      consola.error(err);
    });
  }
  // Append content
  fs.appendFileSync(CSV_PATH, row);
}

module.exports = { generateOverview };
