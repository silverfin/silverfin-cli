const fs = require("fs");
const path = require("path");
const toolkit = require("../../index");
const liquidTestRunner = require("../liquidTestRunner");
const fsUtils = require("../utils/fsUtils");
const CWD = process.cwd();

// Watch for changes in an specific YAML and their related liquid files
// Run a new test when file is saved
async function watchLiquidTest(firmId, handle, testName, html_render) {
  console.log(
    `Watching for changes related to reconciliation "${handle}" to run a new test...`
  );
  console.log(
    `Don't forget to terminate this process when you don't need it anymore! (Ctrl + C)`
  );
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

  // Watch YAML
  fs.watch(filePath, async (eventType, filename) => {
    if (eventType !== "change") return;

    // Check last update (avoid multiple updates)
    let fileStats = fs.statSync(filePath);
    if (lastUpdates[filename] === fileStats.mtimeMs) return;
    lastUpdates[filename] = fileStats.mtimeMs;

    // Run test
    await liquidTestRunner.runTestsWithOutput(
      firmId,
      handle,
      testName,
      html_render
    );
  });

  // Watch liquid files
  const liquidFiles = fsUtils.listExistingRelatedLiquidFiles(firmId, handle);
  console.log(liquidFiles);
  liquidFiles.forEach((filePath) => {
    fs.watch(filePath, async (eventType, filename) => {
      if (eventType !== "change") return;

      // Check last update (avoid multiple updates)
      let fileStats = fs.statSync(filePath);
      if (lastUpdates[filename] === fileStats.mtimeMs) return;
      lastUpdates[filename] = fileStats.mtimeMs;

      // Run test
      await liquidTestRunner.runTestsWithOutput(
        firmId,
        handle,
        testName,
        html_render
      );
    });
  });
}

// Watch for changes in any file .liquid
// Identify if it's a reconciliation or shared part
// Publish updates when file is saved
function watchLiquidFiles(firmId) {
  console.log(
    "Watching for changes in all liquid files to publish their updates..."
  );
  console.log(
    `Don't forget to terminate this process when you don't need it anymore! (Ctrl + C)`
  );
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
        toolkit.publishReconciliationByHandle(firmId, details.handle);
        console.log(`Reconciliation updated: ${details.handle}`);
      }
      if (details.type === "sharedPart") {
        toolkit.publishSharedPartByName(firmId, details.handle);
        console.log(`Shared part updated: ${details.handle}`);
      }
    });
  });
}

module.exports = { watchLiquidTest, watchLiquidFiles };
