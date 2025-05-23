const { consola } = require("consola");
const path = require("path");
const fs = require("fs");
const fsUtils = require("../utils/fsUtils");

class CwdValidator {
  static run() {
    const warningMessage = `Please, double check that you are executing "silverfin" CLI in the correct directory.`;
    const currentDirectory = process.cwd();
    const gitDirPresent = fs.existsSync(path.join(currentDirectory, `.git`));

    if (gitDirPresent) {
      return;
    }

    let folderIdentified = false;
    const folders = Object.values(fsUtils.FOLDERS);
    for (let folder of folders) {
      const re = new RegExp(folder);

      if (re.test(currentDirectory)) {
        folderIdentified = true;
        consola.warn(`You are running the "silverfin" CLI from the "${folder}" directory. This could have unexpected consequences. ${warningMessage}`);
      }
    }

    if (!folderIdentified) {
      consola.warn(warningMessage);
    }
  }
}

module.exports = { CwdValidator };
