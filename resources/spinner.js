const readline = require("readline");
const process = require("process");
const std = process.stdout;

const spin = (text = "Doing some work..") => {
  // Remove the cursor so we can see the effect
  std.write("\x1B[?25l");
  const spinners = ["-", "\\", "|", "/"];

  // current index of the spinners array
  let index = 0;

  setInterval(() => {
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
  }, 100);
};

const clear = () => {
  readline.clearLine(process.stdout);
  readline.cursorTo(process.stdout, 0);
};

module.exports = { spin, clear };
