const axios = require("axios");
const pkg = require("../../package.json");
const chalk = require("chalk");
const { exec } = require("child_process");

const PACKAGE_URL =
  "https://raw.githubusercontent.com/silverfin/sf-toolkit/main/package.json";

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
  exec(`sudo npm install -g ${pkg.repository.url}`, (error, stdout, stderr) => {
    if (error) {
      console.log(`Error: ${error.message}`);
      return;
    }
    if (stderr) {
      console.log(`Error: ${stderr}`);
      return;
    }
    console.log(chalk.bold(`Silverfin CLI updated`));
  });
}

module.exports = { checkVersions, performUpdate };
