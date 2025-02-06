const axios = require("axios");
const pkg = require("../../package.json");
const chalk = require("chalk");
const { promisify } = require("util");
const exec = promisify(require("child_process").exec);
const { consola } = require("consola");

const PACKAGE_URL = "https://raw.githubusercontent.com/silverfin/silverfin-cli/main/package.json";

async function getLatestVersion() {
  response = await axios.get(PACKAGE_URL);
  if (response.status !== 200) {
    return;
  }
  if (response.data.version) {
    return response.data.version;
  }
}

function compareVersions(latestVersion, currentVersion) {
  const latestVersionParts = latestVersion.split(".").map(Number);
  const currentVersionParts = currentVersion.split(".").map(Number);

  for (let i = 0; i < latestVersionParts.length; ++i) {
    // Compare parts of the version numbers and return the result if they are different
    if (latestVersionParts[i] !== currentVersionParts[i]) {
      return latestVersionParts[i] > currentVersionParts[i] ? true : false;
    }
  }
}

async function checkVersions() {
  const latestVersion = await getLatestVersion();
  const currentVersion = pkg.version;
  if (!latestVersion || !currentVersion) {
    return;
  }
  if (compareVersions(latestVersion, currentVersion)) {
    consola.log(`--------------`);
    consola.log("There is a new version available of this CLI (" + chalk.red(`${currentVersion}`) + " ->  " + chalk.green(`${latestVersion}`) + ")");
    consola.log("Run " + chalk.italic.bold(`silverfin update`) + " to get the latest version");
    consola.log(`--------------`);
  }
}

async function performUpdate() {
  consola.info(`Updating npm package from GitHub repository...`);

  try {
    // Exec output contains both stderr and stdout outputs
    const updateCommand = `sudo npm install -g ${pkg.repository.url}`;
    consola.log(`Running command: ${chalk.italic(updateCommand)}`);
    const updateOutput = await exec(updateCommand);
    const updatedPkgVersion = await exec("silverfin --version");

    consola.log(`--------------`);
    consola.log(updateOutput.stdout);
    consola.log(`--------------`);
    consola.success(chalk.bold(`Silverfin CLI succesfully updated to version ${updatedPkgVersion.stdout}`));

    return updateOutput;
  } catch (error) {
    consola.log(`--------------`);
    consola.error(`${chalk.red("ERROR.")} Update of Silverfin CLI failed`);
    consola.log(`You can try running the following command: ${chalk.bold(`npm install -g ${pkg.repository.url}`)}`);
    consola.log(`If that still fails, try updating NPM first.`);
  }
}

module.exports = { checkVersions, performUpdate };
