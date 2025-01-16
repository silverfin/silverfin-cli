const yaml = require("yaml");
const axios = require("axios");
const open = require("open");
const path = require("path");
const { exec, execSync } = require("child_process");
const isWsl = require("is-wsl");
const commandExistsSync = require("command-exists").sync;
const fs = require("fs");
const chalk = require("chalk");
const errorUtils = require("./utils/errorUtils");
const { spinner } = require("./cli/spinner");
const SF = require("./api/sfApi");
const fsUtils = require("./utils/fsUtils");
const runTestUtils = require("./utils/runTestUtils");
const { consola } = require("consola");

const { ReconciliationText } = require("./templates/reconciliationText");
const { AccountTemplate } = require("./templates/accountTemplate");

function findTestRows(testContent) {
  const options = { maxAliasCount: 10000 };
  const testYAML = yaml.parse(testContent, options);

  const testNames = Object.keys(testYAML);
  const testRows = testContent.split("\n");
  const indexes = {};
  testNames.forEach((testName) => {
    let index = testRows.findIndex((element) => element.includes(testName));
    indexes[testName] = index;
  });
  return indexes;
}

function buildTestParams(
  firmId,
  templateType = "reconciliationText",
  handle,
  testName = "",
  renderMode
) {
  let relativePath = `./reconciliation_texts/${handle}`;

  if (templateType === "accountTemplate") {
    relativePath = `./account_templates/${handle}`;
  }

  const configPresent = fsUtils.configExists(templateType, handle);

  if (!configPresent) {
    consola.error(`Config file for "${handle}" not found`);

    return;
  }

  const config = fsUtils.readConfig(templateType, handle);
  const testPath = `${relativePath}/${config.test}`;

  if (!fs.existsSync(testPath)) {
    consola.error(`Test file for "${handle}" not found`);

    return;
  }

  const testContent = fs.readFileSync(testPath, "utf-8").trim();

  // Empty YAML check
  if (testContent.split("\n").length <= 1) {
    consola.info(`${handle}: there are no tests stored in the YAML file`);
    return false;
  }

  let templateContent;

  if (templateType === "accountTemplate") {
    templateContent = AccountTemplate.read(handle);
  } else {
    templateContent = ReconciliationText.read(handle);
    templateContent.handle = handle;
    templateContent.reconciliation_type = config.reconciliation_type;
  }

  const sharedParts = fsUtils.listSharedPartsUsedInTemplate(
    firmId,
    templateType,
    handle
  );
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
    mode: renderMode,
  };

  // Include only one test
  if (testName) {
    const indexes = findTestRows(testContent);
    if (!Object.keys(indexes).includes(testName)) {
      consola.error(`Test ${testName} not found in YAML`);
      process.exit(1);
    }
    testParams.test_line = indexes[testName] + 1;
  }
  return testParams;
}

async function fetchResult(firmId, testRunId, templateType) {
  let testRun = { status: "started" };
  let pollingDelay = 1000;
  const waitingLimit = 500000;

  spinner.spin("Running tests..");
  let waitingTime = 0;
  while (testRun.status === "started") {
    await new Promise((resolve) => {
      setTimeout(resolve, pollingDelay);
    });
    const response = await SF.readTestRun(firmId, testRunId, templateType);
    testRun = response.data;
    waitingTime += pollingDelay;
    pollingDelay *= 1.05;
    if (waitingTime >= waitingLimit) {
      spinner.stop();
      consola.error("Timeout. Try to run your test again");
      break;
    }
  }
  spinner.stop();
  return testRun;
}

function listErrors(items, type) {
  const itemsKeys = Object.keys(items);
  consola.log(
    chalk.red(
      `${itemsKeys.length} ${type} expectation${
        itemsKeys.length > 1 ? "s" : ""
      } failed`
    )
  );
  itemsKeys.forEach((itemName) => {
    let itemDetails = items[itemName];
    consola.log(`At line number ${itemDetails.line_number}`);
    let gotDataType = typeof itemDetails.got;
    let expectedDataType = typeof itemDetails.expected;
    let displayedGot = itemDetails.got;
    let displayedExpected = itemDetails.expected;

    // If the type is an object, check if it's an array or an object
    if (gotDataType === "object") {
      if (Array.isArray(itemDetails.got)) {
        gotDataType = "array";
      } else if (!itemDetails.got) {
        gotDataType = "null";
      } else {
        gotDataType = "object";

        // If the received got is an object, split it into lines
        displayedGot = "\n";

        for (const key in itemDetails.got) {
          displayedGot += `${key}: ${itemDetails.got[key]}\n`;
        }

        displayedExpected = JSON.stringify(itemDetails.expected, null, 2);
      }
    }

    if (itemDetails.got === "nothing") {
      gotDataType = "blank";
    }

    if (itemDetails.expected === "nothing") {
      expectedDataType = "blank";
    } else if (!itemDetails.expected) {
      expectedDataType = "null";
    }

    consola.log(
      `For ${type} ${chalk.blue.bold(itemName)} got ${chalk.blue.bold(
        displayedGot
      )} (${chalk.italic(gotDataType)}) but expected ${chalk.blue.bold(
        displayedExpected
      )} (${chalk.italic(expectedDataType)})`
    );
  });
  consola.log("");
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
  // If the reconciled is null and the results + rollforwards are empty objects, no errors are present
  for (let section of testSections) {
    if (SECTIONS.includes(section)) {
      const sectionElement = testsFeedback[testName][section];

      if (section === "reconciled" && sectionElement !== null) {
        errorsPresent = true;
        break;
      } else if (
        (section === "results" || section === "rollforwards") &&
        Object.keys(sectionElement).length > 0
      ) {
        errorsPresent = true;
        break;
      }
    }
  }
  return errorsPresent;
}

function processTestRunResponse(testRun, previewOnly) {
  // Possible status: started, completed, test_error, internal_error
  switch (testRun.status) {
    case "internal_error":
      consola.error(
        "Internal error. Try to run the test again or contact support if the issue persists."
      );
      break;
    case "test_error":
      consola.error("Ran into an error an couldn't complete test run");
      consola.log(chalk.red(testRun.error_message));
      break;
    case "completed":
      const errorsPresent = checkAllTestsErrorsPresent(testRun.tests);
      if (errorsPresent === false) {
        if (previewOnly) {
          consola.success(
            chalk.green("SUCCESSFULLY RENDERED HTML (SKIPPED TESTS)")
          );
        } else {
          consola.success(chalk.green("ALL TESTS HAVE PASSED"));
        }
      } else {
        consola.log("");
        consola.log(
          chalk.red(
            `${Object.keys(testRun.tests).length} TEST${
              Object.keys(testRun.tests).length > 1 ? "S" : ""
            } FAILED`
          )
        );

        const tests = Object.keys(testRun.tests).sort();
        tests.forEach((testName) => {
          let testErrorsPresent = checkTestErrorsPresent(
            testName,
            testRun.tests
          );
          // No errors in this test
          if (!testErrorsPresent) {
            return;
          }
          consola.log(
            "---------------------------------------------------------------"
          );
          consola.log(chalk.bold(testName));

          let testElements = testRun.tests[testName];

          // Display success messages of test
          if (testElements.reconciled === null) {
            consola.success(chalk.green("Reconciliation expectation passed"));
          }

          if (Object.keys(testElements.results).length === 0) {
            consola.success(chalk.green("All result expectations passed"));
          }

          if (Object.keys(testElements.rollforwards).length === 0) {
            consola.success(chalk.green("All rollforward expectations passed"));
          }

          // Display error messages of test

          // Reconciled
          if (testElements.reconciled !== null) {
            consola.log(chalk.red("Reconciliation expectation failed"));
            consola.log(
              `At line number ${testElements.reconciled.line_number}`
            );
            consola.log(
              `got ${chalk.blue.bold(
                testElements.reconciled.got
              )} but expected ${chalk.blue.bold(
                testElements.reconciled.expected
              )}`
            );
            consola.log("");
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
function resolveHTMLPath(fileName) {
  const homedir = require("os").homedir();
  const folderPath = path.resolve(homedir, ".silverfin/html_exports");
  const filePath = path.resolve(folderPath, `${fileName}.html`);
  fsUtils.createFolder(folderPath);
  return filePath;
}

// Retrieve HTML, store it and open it in the default browser if needed
async function getHTML(url, testName, openBrowser = false, htmlMode) {
  const filePath = resolveHTMLPath(`${testName}_${htmlMode}`);
  const htmlResponse = await axios.get(url);
  if (htmlResponse.status === 200) {
    fs.writeFileSync(filePath, htmlResponse.data);
    if (openBrowser) {
      if (isWsl) {
        if (commandExistsSync("wsl-open")) {
          exec(`wsl-open ${filePath}`);
        } else {
          consola.info(
            "In order to automatically open HTML files on WSL, we need to install the wsl-open script."
          );
          consola.log(
            "You might be prompted for your password in order for us to install 'sudo npm install -g wsl-open'"
          );
          execSync("sudo npm install -g wsl-open");
          consola.log("Installed wsl-open script");
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

async function getHTMLrenders(renderMode, testName, testRun, openBrowser) {
  const htmlModes = {
    all: ["html_input", "html_preview"],
    input: ["html_input"],
    preview: ["html_preview"],
  };
  const htmlModesToRender = htmlModes[renderMode];
  for (let htmlMode of htmlModesToRender) {
    await getHTML(
      testRun.tests[testName][htmlMode],
      testName,
      openBrowser,
      htmlMode
    );
  }
}

async function handleHTMLfiles(testName = "", testRun, renderMode) {
  deleteExistingHTMLs();
  if (testName) {
    // Only one test
    getHTMLrenders(renderMode, testName, testRun, true);
  } else {
    // All tests
    const testNames = Object.keys(testRun.tests);
    testNames.forEach(async (testName) => {
      getHTMLrenders(renderMode, testName, testRun, true);
    });
  }
}

// Used by VSCode Extension
async function runTests(
  firmId,
  templateType = "reconciliationText",
  handle,
  testName = "",
  previewOnly = false,
  renderMode = "none"
) {
  try {
    const testParams = buildTestParams(
      firmId,
      templateType,
      handle,
      testName,
      renderMode
    );

    if (!testParams) return;

    let testRun = null;
    let previewRun = null;

    if (renderMode !== "none") {
      const previewRunResponse = await SF.createPreviewRun(
        firmId,
        testParams,
        templateType
      );
      const previewRunId = previewRunResponse.data;
      previewRun = await fetchResult(firmId, previewRunId, templateType);
    }

    if (!previewOnly) {
      const testRunResponse = await SF.createTestRun(
        firmId,
        testParams,
        templateType
      );

      const testRunId = testRunResponse.data;
      testRun = await fetchResult(firmId, testRunId, templateType);
    }

    return { testRun, previewRun };
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function runTestsWithOutput(
  firmId,
  templateType = "reconciliationText",
  handle,
  testName = "",
  previewOnly = false,
  htmlInput = false,
  htmlPreview = false
) {
  try {
    const renderMode = runTestUtils.checkRenderMode(htmlInput, htmlPreview);
    const testsRun = await runTests(
      firmId,
      templateType,
      handle,
      testName,
      previewOnly,
      renderMode
    );
    if (!testsRun) return;

    processTestRunResponse(
      testsRun?.testRun || testsRun?.previewRun,
      previewOnly
    );

    if (
      testsRun.previewRun &&
      testsRun.previewRun.status !== "test_error" &&
      renderMode !== "none"
    ) {
      handleHTMLfiles(testName, testsRun.previewRun, renderMode);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

// RETURN (AND LOG) ONLY PASSED OR FAILED
// CAN BE USED BY GITHUB ACTIONS
async function runTestsStatusOnly(
  firmId,
  templateType = "reconciliationText",
  handle,
  testName = ""
) {
  let status = "FAILED";
  const testResult = await runTests(
    firmId,
    templateType,
    handle,
    testName,
    false,
    "none"
  );

  if (!testResult) {
    status = "PASSED";
    consola.success(status);
    return status;
  }

  const testRun = testResult?.testRun;

  if (testRun && testRun?.status === "completed") {
    const errorsPresent = checkAllTestsErrorsPresent(testRun.tests);
    if (errorsPresent === false) {
      status = "PASSED";
      consola.success(status);
      return status;
    }
  }
  consola.error(status);
  return status;
}

module.exports = {
  runTests,
  runTestsWithOutput,
  runTestsStatusOnly,
  getHTML,
  resolveHTMLPath,
  checkAllTestsErrorsPresent,
};
