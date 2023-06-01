const exec = require("child_process");
const fs = require("fs");

async function fileActivity(sinceDate) {
  const filesChanged = exec.execSync(
    `git whatchanged --since="${sinceDate}" --name-status --pretty="format:"`
  );
  if (!filesChanged) {
    process.exit(1);
  }

  const rows = filesChanged.toString().split("\n");
  const nonEmptyRows = rows.filter(Boolean);

  if (!nonEmptyRows || nonEmptyRows.length === 0) {
    console.log("No information to process");
    process.exit(0);
  }

  // Files to Search (YAML)
  const fileTypeRegExp = RegExp(/y(a)?ml/);

  const countByFile = {};
  const countByType = {};

  for (row of nonEmptyRows) {
    let fileInfo = row.toString().trim().split("\t");
    let fileActivity = fileInfo[0];
    let filePath = fileInfo[1];
    let filePathParts = filePath.split(".");
    let fileType = filePathParts[filePathParts.length - 1];

    // File type check
    let typeCheck = fileType.match(fileTypeRegExp);
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

async function nonEmptyFiles() {
  const fileCount = {
    yaml: 0,
    liquid: 0,
  };

  let allReconciliations = fs.readdirSync(`./reconciliation_texts`);
  for (reconciliation of allReconciliations) {
    let mainLiquidPath = `./reconciliation_texts/${reconciliation}/main.liquid`;
    let ymlPath = `./reconciliation_texts/${reconciliation}/tests/${reconciliation}_liquid_test.yml`;

    if (fs.existsSync(mainLiquidPath)) {
      let contentRows = fs.readFileSync(mainLiquidPath).toString().split("\n");
      if (contentRows.length > 1) {
        fileCount.liquid += 1;
      }
    }
    if (fs.existsSync(ymlPath)) {
      let contentRows = fs.readFileSync(ymlPath).toString().split("\n");
      if (contentRows.length > 1) {
        fileCount.yaml += 1;
      }
    }
  }
  return fileCount;
}

async function generateStatsOverview(sinceDate) {
  // Commits on YAML Files
  const { countByFile, countByType } = await fileActivity(sinceDate);

  // Total Liquid & YAML files stored
  const fileCount = await nonEmptyFiles();

  // Today
  const today = new Date().toJSON().toString().slice(0, 10);

  // Overview
  console.log(`Summary ( ${sinceDate} - ${today} ):`);
  console.log("");
  // Added - Deleted
  console.log(
    `New files created: ${(countByType["A"] || 0) - (countByType["D"] || 0)}`
  );
  // Modified
  console.log(`Updates to existing files: ${countByType["M"] || 0}`);
  // Not showing any information about moved/renamed

  console.log("");
  console.log(`Total Liquid files stored: ${fileCount.liquid}`);
  console.log(`Total YAML files stored: ${fileCount.yaml}`);

  // Row to append
  constRowContent = `\r\n${sinceDate};${today};${
    (countByType["A"] || 0) - (countByType["D"] || 0)
  };${countByType["M"] || 0};${fileCount.yaml};${fileCount.liquid}`;
  constRowHeader =
    "Start;End;YAML created;YAML modified;Total YAML stored;Total Liquid stored";
  // Write File
  const csvPath = `./stats/overview.csv`;
  // Create file and header columns
  if (!fs.existsSync("./stats")) {
    fs.mkdirSync("stats");
  }
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, constRowHeader, (err) => {
      console.log(err);
    });
  }
  // Append content
  fs.appendFileSync(csvPath, constRowContent);
}

module.exports = { generateStatsOverview };
