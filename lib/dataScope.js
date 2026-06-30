const { execFileSync } = require("child_process");
const path = require("path");
const { consola } = require("consola");

/**
 * Static data-scope analysis is delegated to silverfin-ls (the maintained
 * tree-sitter language server), so we don't duplicate STL parsing here.
 *
 * `silverfin-ls data-scope <main.liquid>` prints the template's data scope as
 * JSON: ownCustoms, crossTemplate {results, customs}, periodDrop,
 * priorPeriodDepth, companyDrop, accounts, resultEchoes, involvedFiles.
 *
 * The binary is `silverfin-ls` by default; set SILVERFIN_LS_CMD to point at a
 * local/dev build (e.g. "/path/to/node /path/to/silverfin-ls/out/index.js").
 */

function resolveMainPath(handle) {
  return path.resolve(process.cwd(), "reconciliation_texts", handle, "main.liquid");
}

function lsCommand() {
  // SILVERFIN_LS_CMD may be a single binary or "node /path/out/index.js".
  const raw = (process.env.SILVERFIN_LS_CMD || "silverfin-ls").trim();
  const parts = raw.split(/\s+/);
  return { bin: parts[0], prefixArgs: parts.slice(1) };
}

/**
 * @param {String} handle reconciliation handle (its main.liquid is read from cwd)
 * @returns {Object|null} the data scope, or null if silverfin-ls is unavailable
 */
function getDataScope(handle) {
  const main = resolveMainPath(handle);
  const { bin, prefixArgs } = lsCommand();
  try {
    const stdout = execFileSync(bin, [...prefixArgs, "data-scope", main], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(stdout);
  } catch (error) {
    consola.error(
      `Could not get the data scope from silverfin-ls. Ensure silverfin-ls is installed and supports "data-scope" ` +
        `(set SILVERFIN_LS_CMD to point at a local build). ${String(error.message).split("\n")[0]}`
    );
    return null;
  }
}

module.exports = { getDataScope, resolveMainPath };
