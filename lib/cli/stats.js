const exec = require("child_process");
const fs = require("fs");
const path = require("path");
const fsUtils = require("../utils/fsUtils");
const yaml = require("yaml");
const { consola } = require("consola");

async function generateOverview(sinceDate) {
  const TODAY = new Date().toJSON().toString().slice(0, 10);
  const templateSummary = await getTemplatesSummary();
  const yamlSummary = await getYamlSummary(sinceDate);

  displayOverview(sinceDate, TODAY, templateSummary, yamlSummary);

  // Row to append to file
  const rowContent = `\r\n${sinceDate};${TODAY};${yamlSummary.created};${yamlSummary.updated};${templateSummary.reconciliations.yamlFiles};${templateSummary.reconciliations.total};${templateSummary.reconciliations.unitTests}`;
  saveOverviewToFile(rowContent);
}

// Return an object with the count of activities by file and by type
// Type could be: A (added), M (modified), D (deleted)
async function yamlFilesActivity(sinceDate) {
  const countByType = {};
  const filesChanged = exec.execSync(
    `git whatchanged --since="${sinceDate}" --name-status --pretty="format:"`
  );
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
  const YAML_EXPRESSION = `.*\/.*\/tests\/.*_liquid_test.*\.y(a)?ml`;
  const fileTypeRegExp = RegExp(YAML_EXPRESSION, "g");

  for (let row of nonEmptyRows) {
    let fileInfo = row.toString().trim().split("\t");
    let fileActivity = fileInfo[0];
    let filePath = fileInfo[1];

    // File type check
    let typeCheck = filePath.match(fileTypeRegExp);
    if (!typeCheck) {
      continue;
    }

    // Check empty file
    let fileNotEmpty = false;
    if (fs.existsSync(filePath)) {
      let contentRows = fs.readFileSync(filePath).toString().split("\n");
      if (contentRows.length > 1) {
        fileNotEmpty = true;
      }
    }
    if (!fileNotEmpty) {
      continue;
    }

    // Count By Type
    if (!countByType.hasOwnProperty(fileActivity)) {
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
  const YAML_EXPRESSION = `.*${FOLDER}\/.*\/tests\/.*_liquid_test.*\.y(a)?ml`;
  const re = new RegExp(YAML_EXPRESSION, "g");
  let countFiles = 0;
  let countTests = 0;
  for (let file of files) {
    const found = file.match(re);
    if (found && fs.existsSync(file)) {
      let fileContent = fs.readFileSync(file).toString();
      let contentRows = fileContent.split("\n");
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
  let nonEmptyTemplates = [];
  for (let template of templateNames) {
    const filePath = await setMainPath(templateType, template);
    if (!filePath) {
      continue;
    }
    let contentRows = fs.readFileSync(filePath).toString().split("\n");
    if (contentRows.length > 1) {
      nonEmptyTemplates.push(template);
    }
  }
  return nonEmptyTemplates;
}

// Return an array with the externally managed templates
async function listExternallyManagedTemplates(templateType, templateNames) {
  let externallyManagedTemplates = [];
  for (let template of templateNames) {
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
  const mainPath = path.join(
    process.cwd(),
    FOLDER,
    templateName,
    "main.liquid"
  );
  const namePath = path.join(
    process.cwd(),
    FOLDER,
    templateName,
    `${templateName}.liquid`
  );
  let filePath = undefined;
  if (fs.existsSync(mainPath)) {
    filePath = mainPath;
  } else if (fs.existsSync(namePath)) {
    filePath = namePath;
  }
  return filePath;
}

async function getTemplatesSummary() {
  const summary = {
    reconciliations: {
      total: 0,
      externallyManaged: 0,
      yamlFiles: 0,
      unitTests: 0,
    },
    sharedParts: {
      total: 0,
      externallyManaged: 0,
    },
    exportFiles: {
      total: 0,
      externallyManaged: 0,
    },
    accountTemplates: {
      total: 0,
      externallyManaged: 0,
      yamlFiles: 0,
      unitTests: 0,
    },
    all: {
      total: 0,
      externallyManaged: 0,
      yamlFiles: 0,
      unitTests: 0,
    },
  };

  // Reconciliations
  const reconciliationsNonEmpty = await listNonEmptyTemplates(
    "reconciliationText"
  );
  const reconciliationsExtMan = await listExternallyManagedTemplates(
    "reconciliationText",
    reconciliationsNonEmpty
  );
  const reconciliationsTests = await countYamlFiles("reconciliationText");
  summary.reconciliations.total = reconciliationsNonEmpty.length;
  summary.reconciliations.externallyManaged = reconciliationsExtMan.length;
  summary.reconciliations.yamlFiles = reconciliationsTests.files;
  summary.reconciliations.unitTests = reconciliationsTests.tests;

  // Shared Parts
  const sharedPartsNonEmpty = await listNonEmptyTemplates("sharedPart");
  const sharedPartsExtMan = await listExternallyManagedTemplates(
    "sharedPart",
    sharedPartsNonEmpty
  );
  summary.sharedParts.total = sharedPartsNonEmpty.length;
  summary.sharedParts.externallyManaged = sharedPartsExtMan.length;

  // Export Files
  const exportFilesNonEmpty = await listNonEmptyTemplates("exportFile");
  const exportFilesExtMan = await listExternallyManagedTemplates(
    "exportFile",
    exportFilesNonEmpty
  );
  summary.exportFiles.total = exportFilesNonEmpty.length;
  summary.exportFiles.externallyManaged = exportFilesExtMan.length;

  // Account Templates
  const accountTemplatesNonEmpty = await listNonEmptyTemplates(
    "accountTemplate"
  );
  const accountTemplatesExtMan = await listExternallyManagedTemplates(
    "accountTemplate",
    accountTemplatesNonEmpty
  );
  const accountTemplatesTests = await countYamlFiles("accountTemplate");
  summary.accountTemplates.total = accountTemplatesNonEmpty.length;
  summary.accountTemplates.externallyManaged = accountTemplatesExtMan.length;
  summary.accountTemplates.yamlFiles = accountTemplatesTests.files;
  summary.accountTemplates.unitTests = accountTemplatesTests.tests;

  // All
  summary.all.total =
    summary.reconciliations.total +
    summary.sharedParts.total +
    summary.exportFiles.total +
    summary.accountTemplates.total;
  summary.all.externallyManaged =
    summary.reconciliations.externallyManaged +
    summary.sharedParts.externallyManaged +
    summary.exportFiles.externallyManaged +
    summary.accountTemplates.externallyManaged;
  summary.all.yamlFiles =
    summary.reconciliations.yamlFiles + summary.accountTemplates.yamlFiles;
  summary.all.unitTests =
    summary.reconciliations.unitTests + summary.accountTemplates.unitTests;

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
  consola.info(`Summary ( ${sinceDate} - ${today} ):`);
  consola.log("------------------------------------");
  consola.log("");
  consola.log(`New YAML files created: ${yamlSummary.created}`);
  consola.log(`Updates to existing YAML files: ${yamlSummary.updated}`);
  consola.log("");
  consola.log("------------------------------------");
  consola.log("");
  consola.log("Reconciliations:");
  consola.log(`Templates: ${templateSummary.reconciliations.total}`);
  consola.log(
    `Externally Managed: ${templateSummary.reconciliations.externallyManaged}`
  );
  consola.log(`YAML files: ${templateSummary.reconciliations.yamlFiles}`);
  consola.log(`Unit Tests: ${templateSummary.reconciliations.unitTests}`);
  consola.log("");
  consola.log("Account Templates:");
  consola.log(`Templates: ${templateSummary.accountTemplates.total}`);
  consola.log(
    `Externally Managed: ${templateSummary.accountTemplates.externallyManaged}`
  );
  consola.log(`YAML files: ${templateSummary.accountTemplates.yamlFiles}`);
  consola.log(`Unit Tests: ${templateSummary.accountTemplates.unitTests}`);
  consola.log("");
  consola.log("Shared Parts:");
  consola.log(`Templates: ${templateSummary.sharedParts.total}`);
  consola.log(
    `Externally Managed: ${templateSummary.sharedParts.externallyManaged}`
  );
  consola.log("");
  consola.log("Export Files:");
  consola.log(`Templates: ${templateSummary.exportFiles.total}`);
  consola.log(
    `Externally Managed: ${templateSummary.exportFiles.externallyManaged}`
  );
  consola.log("");
  consola.log("All:");
  consola.log(`Templates: ${templateSummary.all.total}`);
  consola.log(`Externally Managed: ${templateSummary.all.externallyManaged}`);
  consola.log(`YAML files: ${templateSummary.all.yamlFiles}`);
  consola.log(`Unit Tests: ${templateSummary.all.unitTests}`);
  consola.log("");
  consola.log("------------------------------------");
}

// content row must be a string with each column separated by ";"
function saveOverviewToFile(rowContent) {
  const ROW_HEADER =
    "Start;End;YAML created;YAML modified;Total YAML stored;Total Reconciliations stored;Total Unit Tests";
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
  fs.appendFileSync(CSV_PATH, rowContent);
}

module.exports = { generateOverview };
