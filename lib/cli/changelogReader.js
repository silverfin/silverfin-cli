const axios = require("axios");
const { consola } = require("consola");

class ChangelogReader {
  static #CHANGELOG_URL = "https://raw.githubusercontent.com/silverfin/silverfin-cli/main/CHANGELOG.md";

  static async fetchChanges(userVersion, updateVersion) {
    try {
      const response = await axios.get(this.#CHANGELOG_URL);
      if (response.status !== 200) {
        if (response.status === 404) {
          consola.debug(`Changelog file not found (404). The CHANGELOG.md file may have been moved or deleted from the repository.`);
        } else {
          consola.debug(`Failed to fetch changelog from GitHub. Server returned status ${response.status}`);
        }
        return;
      }

      const changelog = response.data;
      return this.#parseChangesBetweenVersions(changelog, userVersion, updateVersion);
    } catch (error) {
      consola.debug(`Failed to fetch changelog from GitHub`);
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

      if (!foundUpdateVersion) {
        consola.warn(
          `Version ${updateVersion} not found in the changelog. This might indicate that the changelog hasn't been updated yet for this version, or the version format is incorrect (should be ## [version] (date)).`
        );
      }

      return relevantSections.join("\n\n");
    } catch (error) {
      return;
    }
  }
}

module.exports = { ChangelogReader };
