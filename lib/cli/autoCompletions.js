const fs = require("fs");
const path = require("path");
const { consola } = require("consola");
const homedir = require("os").homedir();

// Create the necesary files to enable tab auto-completion for your CLI tool
class AutoCompletions {
  static #SF_FOLDER_PATH = path.resolve(homedir, ".silverfin/");
  static #SCRIPT_ORIGIN_PATH = path.resolve(__dirname, "../../resources/autoCompletion/autocomplete");
  static #SCRIPT_DESTINATION_PATH = path.resolve(this.#SF_FOLDER_PATH, "autocomplete");

  static set() {
    this.#copyFile();
    this.#addToShellConfig();
  }

  static #copyFile() {
    try {
      if (!fs.existsSync(this.#SF_FOLDER_PATH)) {
        fs.mkdirSync(this.#SF_FOLDER_PATH, { recursive: true });
      }

      if (fs.existsSync(this.#SCRIPT_DESTINATION_PATH)) {
        fs.unlinkSync(this.#SCRIPT_DESTINATION_PATH);
      }

      fs.copyFileSync(this.#SCRIPT_ORIGIN_PATH, this.#SCRIPT_DESTINATION_PATH);
    } catch (error) {
      consola.error("Error copying the auto-completion script:", error);
    }
  }

  static #addToShellConfig() {
    consola.info(`To enable auto-completions, add the following line to your shell config (e.g. ~/.zshrc or ~/.bashrc):`);
    consola.info(`source ${this.#SCRIPT_DESTINATION_PATH}`);
  }
}

module.exports = { AutoCompletions };
