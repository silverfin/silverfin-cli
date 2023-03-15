const SF = require("./api/sf_api");
const fsUtils = require("./fs_utils");
const fs = require("fs");
const { spinner } = require("./resources/spinner");
const chalk = require("chalk");
const pkg = require("./package.json");
const { config } = require("./api/auth");
const yaml = require("yaml");
const axios = require("axios");
const open = require("open");
const path = require("path");
const { exec, execSync } = require("child_process");
const isWsl = require("is-wsl");
const commandExistsSync = require("command-exists").sync;

const RECONCILIATION_FIELDS_TO_SYNC = [
  "id",
  "handle",
  "name_en",
  "name_fr",
  "name_nl",
  "auto_hide_formula",
  "text_configuration",
  "virtual_account_number",
  "reconciliation_type",
  "public",
  "allow_duplicate_reconciliations",
  "is_active",
  "externally_managed",
];
const RECONCILIATION_FIELDS_TO_PUSH = [
  "name_en",
  "name_fr",
  "name_nl",
  "auto_hide_formula",
  "text_configuration",
];

// Uncaught Errors. Open Issue in GitHub
function uncaughtErrors(error) {
  if (error.stack) {
    console.error("");
    console.error(
      `!!! Please open an issue including this log on ${pkg.bugs.url}`
    );
    console.error("");
    console.error(error.message);
    console.error(`silverfin: v${pkg.version}, node: ${process.version}`);
    console.error("");
    console.error(error.stack);
  }
  process.exit(1);
}

function errorHandler(error) {
  if (error.code == "ENOENT") {
    console.log(
      `The path ${error.path} was not found, please ensure you've imported all required files`
    );
    process.exit();
  } else {
    uncaughtErrors(error);
  }
}

function storeImportedReconciliation(reconciliationText) {
  const handle = reconciliationText.handle || reconciliationText.id;

  if (!reconciliationText.text) {
    console.log(
      `This template's liquid code was empty or hidden so it was not imported: ${handle}`
    );
    return;
  }
  const relativePath = `./reconciliation_texts/${handle}`;
  fsUtils.createFolder(`./reconciliation_texts`);
  fsUtils.createFolders(relativePath);

  // Template
  textPartsReducer = (acc, part) => {
    acc[part.name] = part.content;
    return acc;
  };
  const textParts = reconciliationText.text_parts.reduce(textPartsReducer, {});
  const mainPart = reconciliationText.text;
  fsUtils.createTemplateFiles(relativePath, mainPart, textParts);

  // Liquid Test YAML
  const testFilenameRoot = handle;
  let testContent;
  if (reconciliationText.tests) {
    testContent = reconciliationText.tests;
  } else {
    testContent = "# Add your Liquid Tests here";
  }
  fsUtils.createLiquidTestFiles(relativePath, testFilenameRoot, testContent);

  // Config Json File
  const attributes = RECONCILIATION_FIELDS_TO_SYNC.reduce((acc, attribute) => {
    acc[attribute] = reconciliationText[attribute];
    return acc;
  }, {});

  const configTextParts = Object.keys(textParts).reduce((acc, name) => {
    if (name) {
      acc[name] = `text_parts/${name}.liquid`;
    }
    return acc;
  }, {});

  const configContent = {
    ...attributes,
    text: "main.liquid",
    text_parts: configTextParts,
    test: `tests/${handle}_liquid_test.yml`,
  };
  fsUtils.writeConfig(relativePath, configContent);
}

async function importExistingReconciliationByHandle(firmId, handle) {
  const reconciliationText = await SF.findReconciliationText(firmId, handle);
  if (!reconciliationText) {
    throw `${handle} wasn't found`;
  }
  storeImportedReconciliation(reconciliationText);
}

async function importExistingReconciliationById(firmId, reconciliationId) {
  const reconciliationText = await SF.findReconciliationTextById(
    firmId,
    reconciliationId
  );
  if (!reconciliationText) {
    throw `${reconciliationId} wasn't found`;
  }
  storeImportedReconciliation(reconciliationText);
}

// Import all reconciliations
async function importExistingReconciliations(firmId, page = 1) {
  const response = await SF.fetchReconciliationTexts(firmId, page);
  const reconciliationsArray = response.data;
  if (reconciliationsArray.length == 0) {
    if (page == 1) {
      console.log("No reconciliations found");
    }
    return;
  }
  reconciliationsArray.forEach(async (reconciliation) => {
    storeImportedReconciliation(reconciliation);
  });
  importExistingReconciliations(firmId, page + 1);
}

function constructReconciliationText(handle) {
  const relativePath = `./reconciliation_texts/${handle}`;
  const config = fsUtils.readConfig(relativePath);

  const attributes = RECONCILIATION_FIELDS_TO_PUSH.reduce((acc, attribute) => {
    acc[attribute] = config[attribute];
    return acc;
  }, {});
  attributes.text = fs.readFileSync(`${relativePath}/main.liquid`, "utf-8");

  const textParts = Object.keys(config.text_parts).reduce((array, name) => {
    let path = `${relativePath}/${config.text_parts[name]}`;
    let content = fs.readFileSync(path, "utf-8");
    array.push({ name, content });
    return array;
  }, []);

  attributes.text_parts = textParts;

  const mainPartPath = `${relativePath}/${config.text}`;
  const mainPartContent = fs.readFileSync(mainPartPath, "utf-8");
  attributes.text = mainPartContent;

  return attributes;
}

async function persistReconciliationText(firmId, handle) {
  try {
    const relativePath = `./reconciliation_texts/${handle}`;
    const config = fsUtils.readConfig(relativePath);
    let reconciliationTextId;
    if (config && config.id) {
      reconciliationTextId = config.id;
      console.log("Loaded from config");
    } else {
      reconciliationTextId = {
        ...(await SF.findReconciliationText(firmId, handle)),
      }.id;
    }
    if (!reconciliationTextId) {
      throw "Reconciliation not found";
    }
    SF.updateReconciliationText(firmId, reconciliationTextId, {
      ...constructReconciliationText(handle),
      version_comment: "Update published using the API",
    });
  } catch (error) {
    errorHandler(error);
  }
}

async function importExistingSharedPartById(firmId, id) {
  const sharedPart = await SF.fetchSharedPartById(firmId, id);

  if (!sharedPart) {
    throw `Shared part ${id} wasn't found.`;
  }

  const relativePath = `./shared_parts/${sharedPart.data.name}`;

  fsUtils.createFolder(`./shared_parts`);
  fsUtils.createFolder(relativePath);

  fsUtils.createLiquidFile(
    relativePath,
    sharedPart.data.name,
    sharedPart.data.text
  );

  let config = {
    id: sharedPart.data.id,
    name: sharedPart.data.name,
    text: "main.liquid",
    used_in: sharedPart.data.used_in,
  };

  fsUtils.writeConfig(relativePath, config);
}

async function importExistingSharedPartByName(firmId, name) {
  const sharedPartByName = await SF.findSharedPart(firmId, name);
  if (!sharedPartByName) {
    throw `Shared part with name ${name} wasn't found.`;
  }
  importExistingSharedPartById(firmId, sharedPartByName.id);
}

async function importExistingSharedParts(firmId, page = 1) {
  const response = await SF.fetchSharedParts(firmId, page);
  const sharedParts = response.data;
  if (sharedParts.length == 0) {
    if (page == 1) {
      console.log(`No shared parts found`);
    }
    return;
  }
  sharedParts.forEach(async (sharedPart) => {
    await importExistingSharedPartById(firmId, sharedPart.id);
  });
  importExistingSharedParts(firmId, page + 1);
}

async function persistSharedPart(firmId, name) {
  try {
    const relativePath = `./shared_parts/${name}`;
    const config = fsUtils.readConfig(relativePath);
    const attributes = {};
    attributes.text = fs.readFileSync(
      `${relativePath}/${name}.liquid`,
      "utf-8"
    );
    SF.updateSharedPart(firmId, config.id, {
      ...attributes,
      version_comment: "Testing Cli",
    });
  } catch (error) {
    errorHandler(error);
  }
}

/* This will overwrite existing shared parts in reconcilation's config file */
/* Look in each shared part if it is used in the provided reconciliation */
function refreshSharedPartsUsed(handle) {
  try {
    const relativePath = `./reconciliation_texts/${handle}`;
    const configReconciliation = fsUtils.readConfig(relativePath);
    configReconciliation.shared_parts = [];
    fs.readdir(`./shared_parts`, (error, allSharedParts) => {
      if (error) throw error;
      for (sharedPartDir of allSharedParts) {
        let sharedPartPath = `./shared_parts/${sharedPartDir}`;
        let dir = fs.statSync(sharedPartPath, () => {});
        if (dir.isDirectory()) {
          let configSharedPart = fsUtils.readConfig(sharedPartPath);
          configSharedPart.used_in.find((template, index) => {
            if (template.id == configReconciliation.id) {
              configReconciliation.shared_parts.push({
                id: configSharedPart.id,
                name: sharedPartDir,
              });
              console.log(
                `Shared part ${sharedPartDir} used in reconciliation ${handle}:`
              );
              return true;
            }
          });
        }
      }
      fsUtils.writeConfig(relativePath, configReconciliation);
    });
  } catch (error) {
    errorHandler(error);
  }
}

async function addSharedPartToReconciliation(
  firmId,
  sharedPartHandle,
  reconciliationHandle
) {
  try {
    const relativePathReconciliation = `./reconciliation_texts/${reconciliationHandle}`;
    const configReconciliation = fsUtils.readConfig(relativePathReconciliation);
    configReconciliation.shared_parts = configReconciliation.shared_parts || [];

    const relativePathSharedPart = `./shared_parts/${sharedPartHandle}`;
    const configSharedPart = fsUtils.readConfig(relativePathSharedPart);

    const response = await SF.addSharedPart(
      firmId,
      configSharedPart.id,
      configReconciliation.id
    );

    if (response.status === 201) {
      console.log(
        `Shared part "${sharedPartHandle}" added to "${reconciliationHandle}" reconciliation text.`
      );
    }

    const sharedPartIndex = configReconciliation.shared_parts.findIndex(
      (sharedPart) => sharedPart.id === configSharedPart.id
    );

    if (sharedPartIndex === -1) {
      configReconciliation.shared_parts.push({
        id: configSharedPart.id,
        name: sharedPartHandle,
      });
      fsUtils.writeConfig(relativePathReconciliation, configReconciliation);
    }
    const reconciliationIndex = configSharedPart.used_in.findIndex(
      (reconciliationText) => reconciliationText.id === configReconciliation.id
    );

    if (reconciliationIndex === -1) {
      configSharedPart.used_in.push({
        id: configReconciliation.id,
        type: "reconciliation",
      });
      fsUtils.writeConfig(relativePathSharedPart, configSharedPart);
    }
  } catch (error) {
    errorHandler(error);
  }
}

async function removeSharedPartFromReconciliation(
  firmId,
  sharedPartHandle,
  reconciliationHandle
) {
  try {
    const relativePathReconciliation = `./reconciliation_texts/${reconciliationHandle}`;
    const configReconciliation = fsUtils.readConfig(relativePathReconciliation);
    configReconciliation.shared_parts = configReconciliation.shared_parts || [];

    const relativePathSharedPart = `./shared_parts/${sharedPartHandle}`;
    const configSharedPart = fsUtils.readConfig(relativePathSharedPart);

    const response = await SF.removeSharedPart(
      firmId,
      configSharedPart.id,
      configReconciliation.id
    );
    if (response.status === 200) {
      console.log(
        `Shared part "${sharedPartHandle}" removed from "${reconciliationHandle}" reconciliation text.`
      );
    }

    const sharedPartIndex = configReconciliation.shared_parts.findIndex(
      (sharedPart) => sharedPart.id === configSharedPart.id
    );
    if (sharedPartIndex !== -1) {
      configReconciliation.shared_parts.splice(sharedPartIndex, 1);
      fsUtils.writeConfig(relativePathReconciliation, configReconciliation);
    }

    const reconciliationIndex = configSharedPart.used_in.findIndex(
      (reconciliationText) => reconciliationText.id === configReconciliation.id
    );
    if (reconciliationIndex !== -1) {
      configSharedPart.used_in.splice(reconciliationIndex, 1);
      fsUtils.writeConfig(relativePathSharedPart, configSharedPart);
    }
  } catch (error) {
    errorHandler(error);
  }
}

function findTestRows(testContent) {
  const testYAML = yaml.parse(testContent);
  const testNames = Object.keys(testYAML);
  const testRows = testContent.split("\n");
  const indexes = {};
  testNames.forEach((testName) => {
    let index = testRows.findIndex((element) => element.includes(testName));
    indexes[testName] = index;
  });
  return indexes;
}

function buildTestParams(handle, testName = "", html_render = false) {
  const relativePath = `./reconciliation_texts/${handle}`;
  const config = fsUtils.readConfig(relativePath);
  const testPath = `${relativePath}/${config.test}`;
  const testContent = fs.readFileSync(testPath, "utf-8");

  // Empty YAML check
  if (testContent.split("\n").length <= 1) {
    console.log(`${handle}: there are no tests stored in the YAML file`);
    process.exit(1);
  }

  const templateContent = constructReconciliationText(handle);
  templateContent.handle = handle;
  templateContent.html_render = html_render ? true : false;
  templateContent.reconciliation_type = config.reconciliation_type;
  const sharedParts = fsUtils.getSharedParts(handle);
  if (sharedParts.length !== 0) {
    templateContent.text_shared_parts = [];
    for (let sharedPart of sharedParts) {
      let sharedPartContent = fs.readFileSync(
        `shared_parts/${sharedPart}/${sharedPart}.liquid`,
        "utf-8"
      );
      templateContent.text_shared_parts.push({
        name: sharedPart,
        content: sharedPartContent,
      });
    }
  }
  const testParams = {
    template: templateContent,
    tests: testContent,
  };
  // Include only one test
  if (testName) {
    const indexes = findTestRows(testContent);
    if (!Object.keys(indexes).includes(testName)) {
      console.log(`Test ${testName} not found in YAML`);
      process.exit(1);
    }
    testParams.test_line = indexes[testName] + 1;
  }
  return testParams;
}

async function fetchResult(firmId, testRunId) {
  let testRun = { status: "started" };
  const pollingDelay = 2000;
  const waitingLimit = 20000;

  spinner.spin("Running tests..");
  let waitingTime = 0;
  while (testRun.status === "started") {
    await new Promise((resolve) => {
      setTimeout(resolve, pollingDelay);
    });
    const response = await SF.fetchTestRun(firmId, testRunId);
    testRun = response.data;
    waitingTime += pollingDelay;
    if (waitingTime >= waitingLimit) {
      spinner.clear();
      console.log("Timeout. Try to run your test again");
      break;
    }
  }
  spinner.clear();
  return testRun;
}

function listErrors(items, type) {
  const itemsKeys = Object.keys(items);
  console.log(
    chalk.red(
      `${itemsKeys.length} ${type} expectation${
        itemsKeys.length > 1 ? "s" : ""
      } failed`
    )
  );
  itemsKeys.forEach((itemName) => {
    let itemDetails = items[itemName];
    console.log(`At line number ${itemDetails.line_number}`);
    console.log(
      `For ${type} ${chalk.blue.bold(itemName)} got ${chalk.blue.bold(
        itemDetails.got
      )} (${chalk.italic(
        typeof itemDetails.got
      )}) but expected ${chalk.blue.bold(itemDetails.expected)} (${chalk.italic(
        typeof itemDetails.expected
      )})`
    );
  });
  console.log("");
}

// Find at least one error in the all tests
function checkAllTestsErrorsPresent(testsFeedback) {
  let errorsPresent = false;
  const testNames = Object.keys(testsFeedback);
  for (let testName of testNames) {
    if (errorsPresent) {
      break;
    }
    errorsPresent = checkTestErrorsPresent(testName, testsFeedback);
  }
  return errorsPresent;
}

function checkTestErrorsPresent(testName, testsFeedback) {
  let errorsPresent = false;
  const SECTIONS = ["reconciled", "results", "rollforwards"];
  let testSections = Object.keys(testsFeedback[testName]);
  // Look for reconciled, results or rollforwards
  // We could have only html for successful tests
  for (let section of testSections) {
    if (SECTIONS.includes(section)) {
      errorsPresent = true;
      break;
    }
  }
  return errorsPresent;
}

function processTestRunResponse(testRun) {
  // Possible status: started, completed, test_error, internal_error
  switch (testRun.status) {
    case "internal_error":
      console.log(
        "Internal error. Try to run the test again or contact support if the issue persists."
      );
      break;
    case "test_error":
      console.log("Ran into an error an couldn't complete test run");
      console.log(chalk.red(testRun.error_message));
      break;
    case "completed":
      const errorsPresent = checkAllTestsErrorsPresent(testRun.tests);
      if (errorsPresent === false) {
        console.log(chalk.green("ALL TESTS HAVE PASSED"));
      } else {
        console.log("");

        console.log(
          chalk.red(
            `${Object.keys(testRun.tests).length} TEST${
              Object.keys(testRun.tests).length > 1 ? "S" : ""
            } FAILED`
          )
        );

        const tests = Object.keys(testRun.tests);
        tests.forEach((testName) => {
          let testErrorsPresent = checkTestErrorsPresent(
            testName,
            testRun.tests
          );
          // No errors in this test
          if (!testErrorsPresent) {
            return;
          }
          console.log(
            "---------------------------------------------------------------"
          );
          console.log(chalk.bold(testName));

          let testElements = testRun.tests[testName];

          // Display success messages of test
          if (testElements.reconciled === null) {
            console.log(chalk.green("Reconciliation expectation passed"));
          }

          if (Object.keys(testElements.results).length === 0) {
            console.log(chalk.green("All result expectations passed"));
          }

          if (Object.keys(testElements.rollforwards).length === 0) {
            console.log(chalk.green("All rollforward expectations passed"));
          }

          // Display error messages of test

          // Reconciled
          if (testElements.reconciled !== null) {
            console.log(chalk.red("Reconciliation expectation failed"));
            console.log(
              `At line number ${testElements.reconciled.line_number}`
            );
            console.log(
              `got ${chalk.blue.bold(
                testElements.reconciled.got
              )} but expected ${chalk.blue.bold(
                testElements.reconciled.expected
              )}`
            );
            console.log("");
          }

          // Results
          if (Object.keys(testElements.results).length > 0) {
            listErrors(testElements.results, "result");
          }

          // Rollforwards
          if (Object.keys(testElements.rollforwards).length > 0) {
            listErrors(testElements.rollforwards, "rollforward");
          }
        });
        break;
      }
  }
}

// Path to store HTML exports
function resolveHTMLPath(testName) {
  const homedir = require("os").homedir();
  const folderPath = path.resolve(homedir, ".silverfin/html_exports");
  const filePath = path.resolve(folderPath, `${testName}.html`);
  fsUtils.createFolder(folderPath);
  return filePath;
}

// Retrieve HTML, store it and open it in the default browser if needed
async function getHTML(url, testName, openBrowser = false) {
  const filePath = resolveHTMLPath(testName);
  const htmlResponse = await axios.get(url);
  if (htmlResponse.status === 200) {
    fs.writeFileSync(filePath, htmlResponse.data);
    if (openBrowser) {
      if (isWsl) {
        if (commandExistsSync("wsl-open")) {
          exec(`wsl-open ${filePath}`);
        } else {
          console.log(
            "In order to automatically open HTML files on WSL, we need to install the wsl-open script."
          );
          console.log(
            "You might be prompted for your password in order for us to install 'sudo npm install -g wsl-open'"
          );
          execSync("sudo npm install -g wsl-open");
          console.log("Installed wsl-open script");
          exec(`wsl-open ${filePath}`);
        }
      } else {
        await open(filePath);
      }
    }
  }
}

async function deleteExistingHTMLs() {
  try {
    const homedir = require("os").homedir();
    const folderPath = path.resolve(homedir, ".silverfin/html_exports");
    if (!fs.existsSync(folderPath)) {
      return;
    }
    const files = fs.readdirSync(folderPath);
    files.forEach((fileName) => {
      const filePath = path.resolve(folderPath, fileName);
      fs.unlinkSync(filePath);
    });
  } catch (err) {}
}

async function handleHTMLfiles(testName = "", testRun) {
  deleteExistingHTMLs();
  if (testName) {
    // Only one test
    await getHTML(testRun.tests[testName].html, testName, true);
  } else {
    // All tests
    const testNames = Object.keys(testRun.tests);
    testNames.forEach(async (testName) => {
      await getHTML(testRun.tests[testName].html, testName, true);
    });
  }
}

// Used by VSCode Extension
async function runTests(firmId, handle, testName = "", html_render = false) {
  try {
    const testParams = buildTestParams(handle, testName, html_render);
    const testRunResponse = await SF.createTestRun(firmId, testParams);
    const testRunId = testRunResponse.data;
    const testRun = await fetchResult(firmId, testRunId);
    return testRun;
  } catch (error) {
    errorHandler(error);
  }
}

async function runTestsWithOutput(
  firmId,
  handle,
  testName = "",
  html_render = false
) {
  try {
    const testRun = await runTests(firmId, handle, testName, html_render);
    if (!testRun) {
      return;
    }
    processTestRunResponse(testRun);
    if (html_render) {
      handleHTMLfiles(testName, testRun);
    }
  } catch (error) {
    errorHandler(error);
  }
}

function authorize(firmId = undefined) {
  SF.authorizeApp(firmId);
}

function setDefaultFirmID(firmId) {
  config.setFirmId(firmId);
  console.log(`Set firm id to: ${firmId}`);
}

function getDefaultFirmID() {
  const firmId = config.getFirmId();
  return firmId;
}

function listStoredIds() {
  return config.storedIds();
}

module.exports = {
  importExistingReconciliationByHandle,
  importExistingReconciliationById,
  importExistingReconciliations,
  persistReconciliationText,
  importExistingSharedPartByName,
  importExistingSharedParts,
  persistSharedPart,
  refreshSharedPartsUsed,
  addSharedPartToReconciliation,
  removeSharedPartFromReconciliation,
  runTests,
  runTestsWithOutput,
  getHTML,
  resolveHTMLPath,
  checkAllTestsErrorsPresent,
  authorize,
  uncaughtErrors,
  setDefaultFirmID,
  getDefaultFirmID,
  listStoredIds,
};
