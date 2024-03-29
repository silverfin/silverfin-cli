const fs = require("fs");
const path = require("path");
const toolkit = require("../../index");
const liquidTestRunner = require("../liquidTestRunner");
const fsUtils = require("../utils/fsUtils");
const { consola } = require("consola");

/**
 *  Watch for changes in an specific YAML and their related liquid files. Run a new test when file is saved.
 * @param {Number} firmId - Firm ID
 * @param {String} handle - template handle
 * @param {String} testName - Test name (empty string to run all tests)
 * @param {boolean} renderInput - Open browser and show the HTML from input view
 */
async function watchLiquidTest(firmId, handle, testName, renderInput) {
  consola.info(
    `Watching for changes related to reconciliation "${handle}" to run a new test...`
  );
  consola.warn(
    `Don't forget to terminate this process when you don't need it anymore! (Ctrl + C)`
  );
  const filePath = path.resolve(
    process.cwd(),
    "reconciliation_texts",
    handle,
    "tests",
    `${handle}_liquid_test.yml`
  );
  if (!fs.existsSync(filePath)) {
    consola.warn("YAML file not found: ", filePath);
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
      false,
      renderInput
    );
  });

  // Watch liquid files
  const liquidFiles = fsUtils.listExistingRelatedLiquidFiles(firmId, handle);
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
        false,
        renderInput
      );
    });
  });
}

/**
 * Watch for changes in any file `.liquid`. Identify if it's a `reconciliationText` or `sharedPart`. **Publish updates to Silverfin when file is saved**.
 * @param {Number} firmId
 */
function watchLiquidFiles(firmId) {
  consola.info(
    "Watching for changes in all liquid files to publish their updates..."
  );
  consola.warn(
    `Don't forget to terminate this process when you don't need it anymore! (Ctrl + C)`
  );
  const files = fsUtils.listExistingFiles("liquid");
  const lastUpdates = {};
  for (let filePath of files) {
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
        toolkit.publishReconciliationByHandle("firm", firmId, details.handle);
      }
      if (details.type === "sharedPart") {
        toolkit.publishSharedPartByName("firm", firmId, details.handle);
      }
      if (details.type === "exportFile") {
        toolkit.publishExportFileByName("firm", firmId, details.handle);
      }
      if (details.type === "accountTemplate") {
        toolkit.publishAccountTemplateByName("firm", firmId, details.handle);
      }
    });
  }
}

module.exports = { watchLiquidTest, watchLiquidFiles };
