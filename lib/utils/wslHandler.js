const { execFile, execSync } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const { consola } = require("consola");
const prompt = require("prompt-sync")({ sigint: true });

const execFileAsync = promisify(execFile);

class WSLHandler {
  /**
   * Detects if running in Windows Subsystem for Linux (WSL)
   * @returns {boolean} true if running in WSL, false otherwise
   */
  static isWSL() {
    try {
      const version = fs.readFileSync("/proc/version", "utf8").toLowerCase();
      return version.includes("microsoft") || version.includes("wsl");
    } catch {
      return false;
    }
  }

  static async open(filePath) {
    this.#setupWslOpen();

    try {
      await execFileAsync("wsl-open", [filePath]);
    } catch (error) {
      consola.error(`Failed to open file in WSL: ${filePath}`, error);
    }
  }

  static #wslOpenInPath() {
    try {
      execSync(`which wsl-open`, { stdio: "ignore" });
      return true;
    } catch {
      consola.log(`Command 'wsl-open' not found in PATH.`);
      return false;
    }
  }

  static #setupWslOpen() {
    if (this.#wslOpenInPath()) {
      return;
    }

    consola.info("In order to automatically open files on WSL, we need to install the wsl-open script.");
    consola.log("You might be prompted for your password in order for us to install 'sudo npm install -g wsl-open'");

    const response = prompt("Do you want to proceed? (y/N): ");
    if (response?.toLowerCase() !== "y") {
      consola.warn("Skipping wsl-open installation. Files will not open automatically in WSL.");
      return;
    }

    execSync("sudo npm install -g wsl-open");
    consola.log("Installed wsl-open script");
  }
}

module.exports = { WSLHandler };
