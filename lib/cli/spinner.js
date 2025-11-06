const process = require("process");
const stdout = process.stdout;
const readline = require("readline");

class Spinner {
  constructor() {
    this.running = false;
  }

  static #addCursor() {
    stdout.write("\x1B[?25h");
  }

  static #removeCursor() {
    stdout.write("\x1B[?25l");
  }

  spin(text = "Doing some work...") {
    if (this.running) return;

    // Don't show spinner in non-interactive environments (CI, pipes, etc.)
    if (!stdout.isTTY || process.env.CI) {
      return;
    }

    this.running = true;
    // Remove the cursor so we can see the effect
    Spinner.#removeCursor();

    const spinners = ["◴", "◷", "◶", "◵"];
    const intervalTime = 120;

    // Allow premature forced exit of the spinner
    process.on("SIGINT", function () {
      this.running = false;
      readline.clearLine(process.stdout);
      readline.cursorTo(process.stdout, 0);
      Spinner.#addCursor();
      process.exit();
    });

    // current index of the spinners array
    let index = 0;

    const interval = setInterval(() => {
      // select a line type
      let line = spinners[index];
      if (line == undefined) {
        index = 0;
        line = spinners[index];
      }

      // writes the line to the type to the terminal
      readline.clearLine(stdout);
      stdout.write(`${line} ${text} (press 'CTRL+c' to stop)`);

      // sets the (x, y) (0, 0) because that is the position we are operating
      readline.cursorTo(stdout, 0);
      index = index >= spinners.length ? 0 : index + 1;

      // Stop interval
      if (this.running === false) {
        clearInterval(interval);
        this.clear();
      }
    }, intervalTime);
  }

  stop() {
    this.running = false;
    // Only clear line if we're in a terminal and not in CI
    if (stdout.isTTY && !process.env.CI) {
      readline.clearLine(process.stdout, 0);
    }
  }

  clear() {
    // Only clear if we're in a terminal and not in CI
    if (stdout.isTTY && !process.env.CI) {
      Spinner.#addCursor();
      readline.cursorTo(process.stdout, 0);
      readline.clearLine(process.stdout, 0);
    }
  }
}

const spinner = new Spinner();

module.exports = { spinner };
