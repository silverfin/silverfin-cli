const axios = require("axios");
const pkg = require("../../package.json");
const chalk = require("chalk");
const { promisify } = require("util");
const exec = promisify(require("child_process").exec);

const PACKAGE_URL =
  "https://raw.githubusercontent.com/silverfin/silverfin-cli/main/package.json";

async function getLatestVersion() {
  response = await axios.get(PACKAGE_URL);
  if (response.status !== 200) {
    return;
  }
  if (response.data.version) {
    return response.data.version;
  }
}

async function checkVersions() {
  const latestVersion = await getLatestVersion();
  const currentVersion = pkg.version;
  if (!latestVersion || !currentVersion) {
    return;
  }
  if (latestVersion > currentVersion) {
    console.log(`--------------`);
    console.log(
      "There is a new version available of this CLI (" +
        chalk.red(`${currentVersion}`) +
        " ->  " +
        chalk.green(`${latestVersion}`) +
        ")"
    );
    console.log(
      "Run " +
        chalk.italic.bold(`silverfin update`) +
        " to get the latest version"
    );
    console.log(`--------------`);
  }
}

async function performUpdate() {
  console.log(`Updating npm package from GitHub repository...`);

  try {
    // Exec output contains both stderr and stdout outputs
    const updateCommand = `npm install -g ${pkg.repository.url}`;
    console.log(`Running command: ${chalk.italic(updateCommand)}`);
    const updateOutput = await exec(updateCommand);
    const updatedPkgVersion = await exec("silverfin --version");

    console.log(`--------------`);
    console.log(updateOutput.stdout);
    console.log(`--------------`);
    console.log(
      chalk.bold(
        `Silverfin CLI succesfully updated to version ${updatedPkgVersion.stdout}`
      )
    );

    return updateOutput;
  } catch (error) {
    console.log(`--------------`);
    console.error(`${chalk.red("ERROR.")} Update of Silverfin CLI failed`);
    console.log(
      `You can try running the following command: ${chalk.bold(
        `sudo npm install -g ${pkg.repository.url}`
      )}`
    );
    console.log(`If that still fails, try updating NPM first.`);
  }
}

module.exports = { checkVersions, performUpdate };
