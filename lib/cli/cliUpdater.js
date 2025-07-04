const axios = require("axios");
const chalk = require("chalk");
const { promisify } = require("util");
const exec = promisify(require("child_process").exec);
const { consola } = require("consola");
const pkg = require("../../package.json");
const { ChangelogReader } = require("./changelogReader");
class CliUpdater {
  static #UPDATE_COMMAND = `sudo npm install -g ${pkg.repository.url}`;
  static #VERSION_COMMAND = `silverfin --version`;
  static #PACKAGE_URL = "https://raw.githubusercontent.com/silverfin/silverfin-cli/main/package.json";

  static async checkVersions() {
    const latestVersion = await this.#getLatestVersion();
    const currentVersion = pkg.version;

    if (!latestVersion || !currentVersion) {
      return;
    }

    if (this.#compareVersions(latestVersion, currentVersion)) {
      consola.log(`--------------`);
      consola.log("There is a new version available of this CLI (" + chalk.red(`${currentVersion}`) + " ->  " + chalk.green(`${latestVersion}`) + ")");
      consola.log("\nRun " + chalk.italic.bold(`silverfin update`) + " to get the latest version");
      consola.log(`--------------`);
    }
  }

  static async performUpdate() {
    consola.info(`Updating npm package from GitHub repository...`);

    try {
      consola.log(`Running command: ${chalk.italic(this.#UPDATE_COMMAND)}`);

      const currentVersion = pkg.version;
      const latestVersion = await this.#getLatestVersion();

      const updateOutput = await exec(this.#UPDATE_COMMAND);
      const updatedPkgVersion = await exec(this.#VERSION_COMMAND);

      consola.log(`--------------`);
      consola.log(updateOutput.stdout);
      consola.log(`--------------`);
      consola.success(chalk.bold(`Silverfin CLI succesfully updated to version ${updatedPkgVersion.stdout}`));

      const recentChanges = await ChangelogReader.fetchChanges(currentVersion, latestVersion);
      if (recentChanges) {
        consola.log(chalk.underline(`Changes since last update:\n`));
        consola.log(`${recentChanges}\n`);
      }
      return updateOutput;
    } catch (error) {
      consola.log(`--------------`);
      consola.error(`${chalk.red("ERROR.")} Update of Silverfin CLI failed`);
      consola.log(`You can try running the following command: ${chalk.bold(`npm install -g ${pkg.repository.url}`)}`);
      consola.log(`If that still fails, try updating NPM first.`);
    }
  }

  static async #getLatestVersion() {
    try {
      const response = await axios.get(this.#PACKAGE_URL);
      if (response.status !== 200) {
        return;
      }
      if (response.data.version) {
        return response.data.version;
      }
    } catch (err) {
      consola.debug(`Failed to get the latest version from GitHub`);
      return;
    }
  }

  static #compareVersions(latestVersion, currentVersion) {
    const latestVersionParts = latestVersion.split(".").map(Number);
    const currentVersionParts = currentVersion.split(".").map(Number);

    for (let i = 0; i < latestVersionParts.length; ++i) {
      if (latestVersionParts[i] !== currentVersionParts[i]) {
        return latestVersionParts[i] > currentVersionParts[i];
      }
    }
  }
}

module.exports = { CliUpdater };
