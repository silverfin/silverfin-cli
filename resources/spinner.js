const process = require("process");
const std = process.stdout;
const readline = require("readline");

class Spinner {
  constructor() {
    this.running = false;
  }

  spin(text = "Doing some work..") {
    this.running = true;
    // Remove the cursor so we can see the effect
    std.write("\x1B[?25l");
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
      readline.clearLine(std);
      std.write(`${line} ${text}`);

      // sets the (x, y) (0, 0) because that is the position we are operating
      readline.cursorTo(std, 0);
      index = index >= spinners.length ? 0 : index + 1;

      // Stop interval
      if (this.running === false) {
        clearInterval(interval);
      }
    }, 100);
  }

  clear() {
    readline.clearLine(process.stdout);
    readline.cursorTo(process.stdout, 0);
    std.write("\u001B[?25h");
  }

  stop() {
    this.running = false;
  }
}

const spinner = new Spinner();

module.exports = { spinner };
