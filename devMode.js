const fs = require("fs");
const path = require("path");
const toolkit = require("./index");
const fsUtils = require("./fs_utils");
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
  const files = fsUtils.listExistingFiles();
  const lastUpdates = {};
  files.forEach((filePath) => {
    fs.watch(filePath, (eventType, filename) => {
      if (eventType !== "change") {
        return;
      }
      let details = fsUtils.identifyTypeAndHandle(filePath);
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

module.exports = { watchYaml, watchLiquid };
