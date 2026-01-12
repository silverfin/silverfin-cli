const fs = require("fs");
const path = require("path");
const toolkit = require("../../index");
const liquidTestRunner = require("../liquidTestRunner");
const fsUtils = require("../utils/fsUtils");
const { consola } = require("consola");
const chokidar = require("chokidar");

/**
 *  Watch for changes in an specific YAML and their related liquid files. Run a new test when file is saved.
 * @param {Number} firmId - Firm ID
 * @param {String} handle - template handle
 * @param {String} testName - Test name (empty string to run all tests)
 * @param {boolean} renderInput - Open browser and show the HTML from input view
 * @param {String} templateType - Template type (reconciliationText, accountTemplate)
 * @param {String} pattern - Pattern to match test names (empty string to run all tests)
 */
async function watchLiquidTest(firmId, handle, testName, renderInput, templateType, pattern = "") {
  if (templateType !== "reconciliationText" && templateType !== "accountTemplate") {
    consola.error(`Template type is missing or invalid`);
    process.exit(1);
  }

  consola.info(`Watching for changes related to ${templateType} "${handle}" to run a new test...`);

  const filePath = path.resolve(process.cwd(), fsUtils.FOLDERS[templateType], handle, "tests", `${handle}_liquid_test.yml`);
  consola.warn(`Don't forget to terminate this process when you don't need it anymore! (Ctrl + C)`);

  if (!fs.existsSync(filePath)) {
    consola.warn("YAML file not found: ", filePath);
    return;
  }

  // Watch YAML
  chokidar.watch(filePath).on("change", async () => {
    // Run test
    await liquidTestRunner.runTestsWithOutput(firmId, templateType, handle, testName, false, renderInput, false, pattern);
  });

  // Watch liquid files
  const liquidFiles = fsUtils.listExistingRelatedLiquidFiles(firmId, handle, templateType);
  for (const filePath of liquidFiles) {
    chokidar.watch(filePath).on("change", async () => {
      // Run test
      await liquidTestRunner.runTestsWithOutput(firmId, templateType, handle, testName, false, renderInput, false, pattern);
    });
  }
}

/**
 * Watch for changes in any file `.liquid`. Identify if it's a `reconciliationText` or `sharedPart`. **Publish updates to Silverfin when file is saved**.
 * @param {Number} firmId
 */
function watchLiquidFiles(firmId) {
  consola.info("Watching for changes in all liquid files to publish their updates...");
  consola.warn(`Don't forget to terminate this process when you don't need it anymore! (Ctrl + C)`);
  const files = fsUtils.listExistingFiles("liquid");

  // The fs.watch function in Node.js can sometimes be unstable and trigger multiple events for a single change, especially on certain platforms like macOS.

  // To mitigate this, we use the chokidar package that aims to make this behavior more reliable.
  for (const filePath of files) {
    chokidar.watch(filePath).on("change", (path) => {
      const details = fsUtils.identifyTypeAndHandle(path);
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
