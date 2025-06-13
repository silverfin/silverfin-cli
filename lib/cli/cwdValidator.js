const { consola } = require("consola");
const path = require("path");
const fs = require("fs");
const fsUtils = require("../utils/fsUtils");

class CwdValidator {
  static run() {
    const currentDirectory = process.cwd();
    const warningMessage = `Please, double check that you are executing "silverfin" CLI in the correct directory. Your current directory is "${currentDirectory}".`;
    const gitDirPresent = fs.existsSync(path.join(currentDirectory, `.git`));

    if (gitDirPresent) {
      return;
    }

    let folderIdentified = false;
    const folders = Object.values(fsUtils.FOLDERS);
    for (const folder of folders) {
      const re = new RegExp(folder);

      if (re.test(currentDirectory)) {
        folderIdentified = true;
        consola.warn(`${warningMessage} You are running "silverfin" from the "${folder}" directory, this could have unexpected consequences.`);
      }
    }

    if (!folderIdentified) {
      consola.warn(warningMessage);
    }
  }
}

module.exports = { CwdValidator };
