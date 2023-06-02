const yaml = require("yaml");
const axios = require("axios");
const open = require("open");
const path = require("path");
const { exec, execSync } = require("child_process");
const isWsl = require("is-wsl");
const commandExistsSync = require("command-exists").sync;
const fs = require("fs");
const chalk = require("chalk");
const templateUtils = require("./utils/templateUtils");
const errorUtils = require("./utils/errorUtils");
const { spinner } = require("./cli/spinner");
const SF = require("./api/sfApi");
const fsUtils = require("./utils/fsUtils");

function findTestRows(testContent) {
  const testYAML = yaml.parse(testContent, (options = { maxAliasCount: -1 }));
  const testNames = Object.keys(testYAML);
  const testRows = testContent.split("\n");
  const indexes = {};
  testNames.forEach((testName) => {
    let index = testRows.findIndex((element) => element.includes(testName));
    indexes[testName] = index;
  });
  return indexes;
}

function buildTestParams(firmId, handle, testName = "", html_render = false) {
  const relativePath = `./reconciliation_texts/${handle}`;
  const config = fsUtils.readConfig(relativePath);
  const testPath = `${relativePath}/${config.test}`;
  const testContent = fs.readFileSync(testPath, "utf-8");

  // Empty YAML check
  if (testContent.split("\n").length <= 1) {
    console.log(`${handle}: there are no tests stored in the YAML file`);
    process.exit(1);
  }

  const templateContent = templateUtils.constructReconciliationText(handle);
  templateContent.handle = handle;
  templateContent.html_render = html_render ? true : false;
  templateContent.reconciliation_type = config.reconciliation_type;
  const sharedParts = fsUtils.getSharedParts(firmId, handle);
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
  let pollingDelay = 1000;
  const waitingLimit = 500000;

  spinner.spin("Running tests..");
  let waitingTime = 0;
  while (testRun.status === "started") {
    await new Promise((resolve) => {
      setTimeout(resolve, pollingDelay);
    });
    const response = await SF.fetchTestRun(firmId, testRunId);
    testRun = response.data;
    waitingTime += pollingDelay;
    pollingDelay *= 1.05;
    if (waitingTime >= waitingLimit) {
      spinner.stop();
      console.log("Timeout. Try to run your test again");
      break;
    }
  }
  spinner.stop();
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
    const testParams = buildTestParams(firmId, handle, testName, html_render);
    const testRunResponse = await SF.createTestRun(firmId, testParams);
    const testRunId = testRunResponse.data;
    const testRun = await fetchResult(firmId, testRunId);
    return testRun;
  } catch (error) {
    errorUtils.errorHandler(error);
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
    errorUtils.errorHandler(error);
  }
}

module.exports = {
  runTests,
  runTestsWithOutput,
  getHTML,
  resolveHTMLPath,
  checkAllTestsErrorsPresent,
};
