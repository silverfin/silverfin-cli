const fs = require("fs");
const path = require("path");
const toolkit = require("../../index");
const liquidTestRunner = require("../liquidTestRunner");
const fsUtils = require("../utils/fsUtils");
const { consola } = require("consola");
const chokidar = require('chokidar');

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

  // Watch YAML
  chokidar.watch(filePath).on('change', async (path) => {
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
  for (let filePath of liquidFiles) {
    chokidar.watch(filePath).on('change', async (path) => {
      // Run test
      await liquidTestRunner.runTestsWithOutput(
        firmId,
        handle,
        testName,
        false,
        renderInput
      );
    });
  }
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

  // The fs.watch function in Node.js can sometimes be unstable and trigger multiple events for a single change, especially on certain platforms like macOS.

  // To mitigate this, we can use a debounce function to only trigger the update after a certain amount of time has passed since the last change event
  for (let filePath of files) {
    chokidar.watch(filePath).on('change', (path) => {

      let details = fsUtils.identifyTypeAndHandle(path);
        if (!details) {
          return;
        }

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
