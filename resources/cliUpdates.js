const axios = require("axios");
const pkg = require("../package.json");
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
    console.log(`There is a new version available of this CLI`);
    console.log(
      `Current version: ${currentVersion}. Latest version: ${latestVersion}`
    );
    console.log(
      `You can update to the latest version by running "silverfin update"`
    );
    console.log(`--------------`);
  }
}

module.exports = { checkVersions };
