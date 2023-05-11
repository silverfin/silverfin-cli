const fs = require("fs");
const path = require("path");
const toolkit = require("./index");

const CWD = process.cwd();

// Watch for changes in an specific YAML
// Publish updates when file is saved
async function watchYaml(firmId, handle, testName, html_render) {
  console.log("Watching for changes in the YAML file...");
  const filePath = path.resolve(
    CWD,
    "reconciliation_texts",
    handle,
    "tests",
    `${handle}_liquid_test.yml`
  );
  if (!fs.existsSync(filePath)) {
    console.log("YAML file not found: ", filePath);
    return;
  }
  const lastUpdates = {};

  fs.watch(filePath, async (eventType, filename) => {
    if (eventType !== "change") return;

    // Check last update (avoid multiple updates)
    let fileStats = fs.statSync(filePath);
    if (lastUpdates[filename] === fileStats.mtimeMs) return;
    lastUpdates[filename] = fileStats.mtimeMs;

    // Run test
    await toolkit.runTestsWithOutput(firmId, handle, testName, html_render);
  });
}

// Watch for changes in any file .liquid
// Identify if it's a reconciliation or shared part
// Publish updates when file is saved
function watchLiquid(firmId) {
  console.log("Watching for changes in liquid files...");
  const files = listFiles();
  const lastUpdates = {};
  files.forEach((filePath) => {
    fs.watch(filePath, (eventType, filename) => {
      if (eventType !== "change") {
        return;
      }
      let details = identifyTypeAndHandle(filePath);
      if (!details) {
        return;
      }
      // Check last update (avoid multiple updates)
      let fileStats = fs.statSync(filePath);
      if (lastUpdates[filename] === fileStats.mtimeMs) return;
      lastUpdates[filename] = fileStats.mtimeMs;
      // Update template
      if (details.type === "reconciliationText") {
        toolkit.persistReconciliationText(firmId, details.handle);
        console.log(`Reconciliation updated: ${details.handle}`);
      }
      if (details.type === "sharedPart") {
        toolkit.persistSharedPart(firmId, details.handle);
        console.log(`Shared part updated: ${details.handle}`);
      }
    });
  });
}

// List all files of a specific type (recursive search)
// Return an array with their full paths
function listFiles(typeCheck = "liquid") {
  const baseDirectory = fs.readdirSync(CWD);
  const basePath = path.resolve(CWD);
  const array = recursiveInspectDirectory({
    basePath: basePath,
    collection: baseDirectory,
    pathsArray: undefined,
    typeCheck: typeCheck,
  });
  return array;
}

// Recursive option for fs.watch is not available in every OS (e.g. Linux)
function recursiveInspectDirectory({
  basePath,
  collection,
  pathsArray = [],
  typeCheck = "liquid",
}) {
  collection.forEach((filePath) => {
    let fullPath = path.resolve(basePath, filePath);
    let fileStats = fs.statSync(fullPath, () => {});

    if (fileStats.isDirectory()) {
      let directory = fs.readdirSync(fullPath);
      recursiveInspectDirectory({
        basePath: fullPath,
        collection: directory,
        pathsArray: pathsArray,
        typeCheck: typeCheck,
      });
    }
    let fileType = fullPath.split(".")[fullPath.split.length - 1];
    if (fileType === typeCheck) {
      pathsArray.push(fullPath);
    }
  });
  return pathsArray;
}

// Return {type, handle} of a template
// type: reconciliationText | sharedPart
function identifyTypeAndHandle(filePath) {
  let index;
  const pathParts = path.resolve(filePath).split(path.sep);
  const sharedPartCheck = (element) => element === "shared_parts";
  const reconciliationCheck = (element) => element === "reconciliation_texts";
  index = pathParts.findIndex(sharedPartCheck);
  if (index !== -1) {
    return { type: "sharedPart", handle: pathParts[index + 1] };
  }
  index = pathParts.findIndex(reconciliationCheck);
  if (index !== -1) {
    return { type: "reconciliationText", handle: pathParts[index + 1] };
  }
  return false;
}

module.exports = { watchYaml, watchLiquid };
