const fs = require("fs");
const path = require("path");
const toolkit = require("./index");

const CWD = process.cwd();

// Recursive is not available in every OS (Linux)
function watch(firmId) {
  console.log("Watching... FIRM: " + firmId);
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

function listFiles() {
  const baseDirectory = fs.readdirSync(CWD);
  const basePath = path.resolve(CWD);
  const array = recursiveInspect(basePath, baseDirectory);
  return array;
}

function recursiveInspect(
  basePath,
  collection,
  pathsArray = [],
  typeCheck = "liquid"
) {
  collection.forEach((filePath) => {
    let fullPath = path.resolve(basePath, filePath);
    let fileStats = fs.statSync(fullPath, () => {});
    if (fileStats.isDirectory()) {
      let directory = fs.readdirSync(fullPath);
      recursiveInspect(fullPath, directory, pathsArray);
    }
    let fileType = fullPath.split(".")[fullPath.split.length - 1];
    if (fileType === typeCheck) {
      pathsArray.push(fullPath);
    }
  });
  return pathsArray;
}

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

module.exports = { watch };
