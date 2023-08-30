const exec = require("child_process");
const fs = require("fs");
const fsUtils = require("../utils/fsUtils");
const yaml = require("yaml");
const { consola } = require("consola");

const YAML_EXPRESSION = `.*reconciliation_texts\/.*\/tests\/.*_liquid_test.*\.y(a)?ml`;
const MAIN_EXPRESSION = `.*reconciliation_texts\/.*\/main\.liquid`;

async function yamlFilesActivity(sinceDate) {
  const filesChanged = exec.execSync(
    `git whatchanged --since="${sinceDate}" --name-status --pretty="format:"`
  );
  if (!filesChanged) {
    consola.info("No files were changed since the date provided");
    process.exit(0);
  }

  const rows = filesChanged.toString().split("\n");
  const nonEmptyRows = rows.filter(Boolean);

  if (!nonEmptyRows || nonEmptyRows.length === 0) {
    consola.info("No files were changed since the date provided");
    process.exit(0);
  }

  // Files to Search (YAML)
  const fileTypeRegExp = RegExp(YAML_EXPRESSION, "g");

  const countByFile = {};
  const countByType = {};

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

    // Create Object
    if (!countByFile.hasOwnProperty(filePath)) {
      countByFile[filePath] = {};
    }

    // Count By File
    if (!countByFile[filePath].hasOwnProperty(fileActivity)) {
      countByFile[filePath][fileActivity] = 1;
    } else {
      countByFile[filePath][fileActivity] += 1;
    }

    // Count By Type
    if (!countByType.hasOwnProperty(fileActivity)) {
      countByType[fileActivity] = 1;
    } else {
      countByType[fileActivity] += 1;
    }
  }
  return { countByFile, countByType };
}

// Count how many reconciliations texts are stored
// we base on the presence of a non empty main.liquid file
async function countReconciliations() {
  const files = fsUtils.listExistingFiles("liquid");
  const re = new RegExp(MAIN_EXPRESSION, "g");
  let count = 0;
  for (let file of files) {
    const found = file.match(re);
    if (found && fs.existsSync(file)) {
      let contentRows = fs.readFileSync(file).toString().split("\n");
      if (contentRows.length > 1) {
        count += 1;
      }
    }
  }
  return count;
}

// Count how many YAML files are stored
// we base on the presence of a non empty file
// Count how many unit tests are stored
// We base on the presence of a title for each unit test
async function countYamlFiles() {
  const files = fsUtils.listExistingFiles("yml");
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

async function generateStatsOverview(sinceDate) {
  // Commits on YAML Files
  const { countByFile, countByType } = await yamlFilesActivity(sinceDate);

  // Total Reconciliations & YAML files stored
  const fileCount = {
    reconciliations: 0,
    yaml: 0,
    tests: 0,
  };
  fileCount.reconciliations = await countReconciliations();
  const yamlFiles = await countYamlFiles();
  fileCount.yaml = yamlFiles.files;
  fileCount.tests = yamlFiles.tests;

  // Today
  const today = new Date().toJSON().toString().slice(0, 10);

  // Overview
  consola.log(`Summary ( ${sinceDate} - ${today} ):`);
  consola.log("------------------------------------");
  consola.log("");
  // Added - Deleted
  consola.log(
    `New YAML files created: ${
      (countByType["A"] || 0) - (countByType["D"] || 0)
    }`
  );
  // Modified
  consola.log(`Updates to existing YAML files: ${countByType["M"] || 0}`);
  // Not showing any information about moved/renamed

  consola.log("");
  consola.log(`Total Reconciliations stored: ${fileCount.reconciliations}`);
  consola.log(`Total YAML files stored: ${fileCount.yaml}`);
  consola.log(`Total Unit Tests stored: ${fileCount.tests}`);

  // Row to append
  constRowContent = `\r\n${sinceDate};${today};${
    (countByType["A"] || 0) - (countByType["D"] || 0)
  };${countByType["M"] || 0};${fileCount.yaml};${fileCount.reconciliations};${
    fileCount.tests
  }`;
  constRowHeader =
    "Start;End;YAML created;YAML modified;Total YAML stored;Total Reconciliations stored;Total Unit Tests";
  // Write File
  const csvPath = `./stats/overview.csv`;
  // Create file and header columns
  if (!fs.existsSync("./stats")) {
    fs.mkdirSync("stats");
  }
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, constRowHeader, (err) => {
      consola.error(err);
    });
  }
  // Append content
  fs.appendFileSync(csvPath, constRowContent);
}

module.exports = { generateStatsOverview };
