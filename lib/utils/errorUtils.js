// Uncaught Errors. Open Issue in GitHub
function uncaughtErrors(error) {
  if (error.stack) {
    console.error("");
    console.error(
      `!!! Please open an issue including this log on ${pkg.bugs.url}`
    );
    console.error("");
    console.error(error.message);
    console.error(`silverfin: v${pkg.version}, node: ${process.version}`);
    console.error("");
    console.error(error.stack);
  }
  process.exit(1);
}

function errorHandler(error) {
  if (error.code == "ENOENT") {
    console.log(
      `The path ${error.path} was not found, please ensure you've imported all required files`
    );
    process.exit();
  } else {
    uncaughtErrors(error);
  }
}

module.exports = {
  uncaughtErrors,
  errorHandler,
};
