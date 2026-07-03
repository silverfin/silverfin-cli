const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { consola } = require("consola");

/**
 * Static data-scope analysis is delegated to silverfin-ls (the maintained
 * tree-sitter language server), so we don't duplicate STL parsing here.
 *
 * `silverfin-ls data-scope <main.liquid>` prints the template's data scope as JSON.
 *
 * Resolution order (auto-detect): SILVERFIN_LS_CMD if set, else `silverfin-ls` on
 * PATH, else `npx --no-install silverfin-ls`. Every call uses a timeout so an old
 * silverfin-ls (which would ignore `data-scope` and start its LSP server) can't hang.
 */

const TIMEOUT_MS = 30000;
const MAX_BUFFER = 64 * 1024 * 1024;

function resolveMainPath(handle) {
  return path.resolve(process.cwd(), "reconciliation_texts", handle, "main.liquid");
}

// Ordered list of candidate invocations, each as [bin, ...prefixArgs].
function candidateCommands() {
  const env = (process.env.SILVERFIN_LS_CMD || "").trim();
  if (env) return [env.split(/\s+/)];
  return [["silverfin-ls"], ["npx", "--no-install", "silverfin-ls"]];
}

function installHelp() {
  return [
    "silverfin-ls provides the static data-scope analysis for `manifest`, `describe-inputs --resolve/--compute` and `set-default`.",
    "Install it and make sure it supports `data-scope`:",
    "  npm install -g silverfin-ls        # or: npx silverfin-ls",
    "Then verify with:  silverfin doctor",
    "Or point at a specific build:  SILVERFIN_LS_CMD=\"node /path/to/silverfin-ls/out/index.js\" silverfin manifest -h <handle>",
  ].join("\n");
}

// Run `data-scope <arg>` against a candidate; returns { ok, stdout } or throws.
function runDataScope(cmd, arg) {
  const [bin, ...prefix] = cmd;
  return execFileSync(bin, [...prefix, "data-scope", arg], {
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    timeout: TIMEOUT_MS,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/**
 * @param {String} handle reconciliation handle (its main.liquid is read from cwd)
 * @returns {Object|null} the data scope, or null (with a precise error) if unavailable
 */
function getDataScope(handle) {
  const main = resolveMainPath(handle);
  const tried = [];
  for (const cmd of candidateCommands()) {
    try {
      return JSON.parse(runDataScope(cmd, main));
    } catch (error) {
      tried.push(cmd.join(" "));
      if (error.code === "ENOENT") continue; // binary not found — try the next candidate
      // It ran but failed (non-zero, timeout, or bad JSON): don't keep guessing.
      const why = error.signal === "SIGTERM" || error.killed ? "timed out (an outdated silverfin-ls without `data-scope` will hang)" : String(error.message).split("\n")[0];
      consola.error(`silverfin-ls failed via "${cmd.join(" ")}": ${why}\n\n${installHelp()}`);
      return null;
    }
  }
  consola.error(`Could not find a working silverfin-ls (tried: ${tried.join(", ")}).\n\n${installHelp()}`);
  return null;
}

/**
 * Probe silverfin-ls end-to-end against a throwaway template, for `silverfin doctor`.
 * @returns {Object} { ok, command?, sample?, error? }
 */
function checkSilverfinLs() {
  let tmp;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sfls-"));
    const dir = path.join(tmp, "reconciliation_texts", "probe");
    fs.mkdirSync(dir, { recursive: true });
    const main = path.join(dir, "main.liquid");
    fs.writeFileSync(main, "{{ period.reconciliations.foo.results.bar }}\n");
    const tried = [];
    for (const cmd of candidateCommands()) {
      try {
        const scope = JSON.parse(runDataScope(cmd, main));
        return { ok: true, command: cmd.join(" "), sample: { handle: scope.handle, crossTemplate: Object.keys(scope.crossTemplate || {}).length } };
      } catch (error) {
        tried.push(cmd.join(" "));
        if (error.code === "ENOENT") continue;
        const why = error.signal === "SIGTERM" || error.killed ? "timed out (outdated silverfin-ls without `data-scope`)" : String(error.message).split("\n")[0];
        return { ok: false, command: cmd.join(" "), error: why };
      }
    }
    return { ok: false, error: `silverfin-ls not found (tried: ${tried.join(", ")})` };
  } finally {
    if (tmp) {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

module.exports = { getDataScope, resolveMainPath, checkSilverfinLs, installHelp };
