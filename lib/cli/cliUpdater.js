const axios = require("axios");
const chalk = require("chalk");
const { promisify } = require("util");
const exec = promisify(require("child_process").exec);
const { consola } = require("consola");

const pkg = require("../../package.json");
const PACKAGE_URL = "https://raw.githubusercontent.com/silverfin/silverfin-cli/main/package.json";
const CHANGELOG_URL = "https://raw.githubusercontent.com/silverfin/silverfin-cli/main/CHANGELOG.md";

class CliUpdater {
  static #UPDATE_COMMAND = `sudo npm install -g ${pkg.repository.url}`;
  static #VERSION_COMMAND = `silverfin --version`;

  static async checkVersions() {
    const latestVersion = await this.#getLatestVersion();
    const currentVersion = pkg.version;

    if (!latestVersion || !currentVersion) {
      return;
    }

    if (this.#compareVersions(latestVersion, currentVersion)) {
      const recentChanges = await this.#getRecentChanges();
      consola.log(`--------------`);
      consola.log("There is a new version available of this CLI (" + chalk.red(`${currentVersion}`) + " ->  " + chalk.green(`${latestVersion}`) + ")");
      if (recentChanges) {
        consola.log("\nRecent changes:");
        consola.log(recentChanges);
      }
      consola.log("\nRun " + chalk.italic.bold(`silverfin update`) + " to get the latest version");
      consola.log(`--------------`);
    }
  }

  static async performUpdate() {
    consola.info(`Updating npm package from GitHub repository...`);

    try {
      consola.log(`Running command: ${chalk.italic(this.#UPDATE_COMMAND)}`);

      const updateOutput = await exec(this.#UPDATE_COMMAND);
      const updatedPkgVersion = await exec(this.#VERSION_COMMAND);

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

  static async #getLatestVersion() {
    try {
      const response = await axios.get(PACKAGE_URL);
      if (response.status !== 200) {
        return;
      }
      if (response.data.version) {
        return response.data.version;
      }
    } catch (err) {
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

  static async #getRecentChanges() {
    try {
      const response = await axios.get(CHANGELOG_URL);
      if (response.status !== 200) {
        return null;
      }

      const changelog = response.data;

      // Split the changelog into version sections, which are separated by a line with "## ["
      const versionSections = changelog.split(/## \[/);

      // Get the last 3 version sections
      const recentVersions = versionSections.slice(1, 4);

      // Format the changes for the output
      let changes = "";
      for (const version of recentVersions) {
        const versionNumber = version.split(")")[0];
        changes += chalk.bold(`\n[${versionNumber})\n`);

        // Get the content of the version section
        const changeContent = version.split(")")[1];
        if (changeContent) {
          changes += changeContent.trim() + "\n";
        }
      }

      return changes;
    } catch (err) {
      return null;
    }
  }
}

module.exports = { CliUpdater };
