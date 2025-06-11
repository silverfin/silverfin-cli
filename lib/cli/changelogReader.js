const axios = require("axios");
const path = require("path");
const fs = require("fs");
const { promisify } = require("util");
const readFile = promisify(fs.readFile);

class ChangelogReader {
  static #CHANGELOG_URL = path.join(__dirname, "../../CHANGELOG.md");

  static async fetchChanges(userVersion, updateVersion) {
    try {
      const changelog = await readFile(this.#CHANGELOG_URL, "utf8");
      return this.#parseChangesBetweenVersions(changelog, userVersion, updateVersion);
    } catch (error) {
      return;
    }
  }

  static #parseChangesBetweenVersions(changelog, userVersion, updateVersion) {
    // Split the changelog into version sections, which are separated by a line with "## ["
    const versionSectionsComplete = changelog.split("## [");
    // Filter out the header of the changelog file
    const versionSections = versionSectionsComplete.slice(1);

    const relevantSections = [];
    let foundUpdateVersion = false;

    try {
      for (const section of versionSections) {
        const versionNumber = section.split("]")[0];
        const versionContent = "[" + section.trim();

        if (versionNumber === updateVersion) {
          foundUpdateVersion = true;
          relevantSections.push(versionContent);
        } else if (foundUpdateVersion && versionNumber === userVersion) {
          break;
        } else if (foundUpdateVersion) {
          relevantSections.push(versionContent);
        }
      }
      return relevantSections.join("\n\n");
    } catch (error) {
      return;
    }
  }
}

module.exports = { ChangelogReader };
