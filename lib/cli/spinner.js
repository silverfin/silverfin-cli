const process = require("process");
const stdout = process.stdout;
const stdin = process.stdin;
const readline = require("readline");

class Spinner {
  constructor() {
    this.running = false;
  }

  spin(text = "Doing some work...") {
    if (this.running) return;

    this.running = true;
    // Remove the cursor so we can see the effect
    stdout.write("\x1B[?25l");
    const spinners = ["-", "\\", "|", "/"];

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
      stdout.write(`${line} ${text} (press 'CTRL+c' or 'q' to stop)`);

      // sets the (x, y) (0, 0) because that is the position we are operating
      readline.cursorTo(stdout, 0);
      index = index >= spinners.length ? 0 : index + 1;

      // Stop interval
      if (this.running === false) {
        clearInterval(interval);
        this.clear();
      }
    }, 100);
  }

  stop() {
    this.running = false;
  }

  clear() {
    readline.clearLine(process.stdout);
    readline.cursorTo(process.stdout, 0);
    stdout.write("\x1B[?25h");
    process.exit();
  }
}

const spinner = new Spinner();

// Allow premature forced exit of the spinner
stdin.setEncoding("utf8");
const ENTER = "\u000d";
const CTRL_C = "\u0003";

stdin.on("data", (key) => {
  if (key === "q" || key === CTRL_C) {
    spinner.stop();
    stdout.write("\x1B[?25h");
    process.exit();
  }
  if (key === ENTER) {
    readline.clearLine(process.stdout);
    readline.cursorTo(process.stdout, 0);
  }
});

stdin.setRawMode(true);

module.exports = { spinner };
