const os = require("os");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const AdmZip = require("adm-zip");
const { UrlHandler } = require("./utils/urlHandler");
const errorUtils = require("./utils/errorUtils");
const { spinner } = require("./cli/spinner");
const SF = require("./api/sfApi");
const fsUtils = require("./utils/fsUtils");
const { extractCompact, formatCompact } = require("./liquidSamplerCompact");
const { consola } = require("consola");

// Markers wrapping the compact diff on stdout so a CI workflow can extract just
// that section (e.g. to post it as a PR comment) regardless of surrounding logs.
const COMPACT_START = "<!-- SAMPLER_COMPACT_START -->";
const COMPACT_END = "<!-- SAMPLER_COMPACT_END -->";

/**
 * Neutralize any literal occurrence of our own markers inside arbitrary
 * (template-controlled) content. named_results values are rendered verbatim
 * into the diff body, so a value that happens to contain the exact marker
 * text could otherwise fool a naive marker-delimited extractor (the markers'
 * stated purpose) into truncating or misparsing the real section.
 * @param {string} text
 * @returns {string}
 */
function escapeMarkers(text) {
  const escape = (marker) => marker.replace("<!--", "<\\!--");
  return text.split(COMPACT_START).join(escape(COMPACT_START)).split(COMPACT_END).join(escape(COMPACT_END));
}

// The compact diff download is a best-effort convenience path (see
// #printCompactDiff) - it must fail fast rather than hang indefinitely on a
// stalled connection, since axios has no timeout by default.
const RESULTS_DOWNLOAD_TIMEOUT_MS = 120000; // 2 minutes

/**
 * @param {string} dir
 * @returns {boolean} true when nothing exists at `dir` or it is an empty directory
 */
function isAbsentOrEmptyDir(dir) {
  if (!fs.existsSync(dir)) return true;
  return fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length === 0;
}

/**
 * Write through a same-directory temp file and rename, so a failed write never
 * leaves a truncated file at `filePath` for a consumer to read.
 * @param {string} filePath
 * @param {string} contents
 */
function writeFileAtomic(filePath, contents) {
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, contents, { flag: "wx" });
    fs.renameSync(tmp, filePath);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

// The API accepts one name per Firm::SUPPORTED_LOCALES, but sending a locale
// the CLI never stores in config.json would always be a no-op.
const NAME_LOCALE_ATTRS = ["name_en", "name_nl", "name_fr", "name_de", "name_da", "name_se", "name_fi"];

// The sampler endpoint declares a fixed param set per template; Grape silently
// drops anything else, so post exactly what it accepts and no more. The backend
// assigns these verbatim to the partner template and reverts after the run.
const SAMPLER_ATTRS_BY_TYPE = {
  reconciliation_text: ["text", "text_parts", "auto_hide_formula", "reconciliation_type", "handle", ...NAME_LOCALE_ATTRS],
  account_detail_template: ["text", "text_parts", ...NAME_LOCALE_ATTRS],
  shared_part: ["text"],
};

/**
 * Project a locally-read template onto the attributes the sampler API accepts.
 * Unset keys are omitted rather than sent - the backend assigns whatever
 * arrives, so a stray undefined/null would blank the partner's value for the
 * run. A config carries the platform's nulls verbatim, so null means "never
 * set" here; an empty string is a deliberate clear and is sent.
 * @param {Object} templateContent - Object returned by TemplateClass.read()
 * @param {string} type - Sampler template type ("reconciliation_text" | "account_detail_template" | "shared_part")
 * @returns {Object} Allow-listed subset of templateContent
 */
function pickSamplerAttrs(templateContent, type) {
  const attrs = {};
  for (const key of SAMPLER_ATTRS_BY_TYPE[type]) {
    const value = templateContent[key];
    if (value !== undefined && value !== null) attrs[key] = value;
  }
  return attrs;
}

const { ReconciliationText } = require("./templates/reconciliationText");
const { AccountTemplate } = require("./templates/accountTemplate");
const { SharedPart } = require("./templates/sharedPart");

/**
 * Class to run liquid samplers for partner templates
 */
class LiquidSamplerRunner {
  #keptExtracted = false;

  /**
   * @param {string|number} partnerId - The partner environment id
   * @param {Object} [options]
   * @param {boolean} [options.openReport] - Whether to download and open the report locally.
   *   Defaults to false in CI (process.env.CI), true otherwise. The report URL is always logged.
   * @param {boolean} [options.compact] - Whether to download the result, extract the
   *   `named_results` diff, and print a compact review-friendly summary to stdout.
   *   Works regardless of CI (unlike openReport). Defaults to false.
   * @param {string} [options.keepExtracted] - Directory to leave the extracted results in
   *   instead of deleting them. The compact diff cites file paths inside a temp tree that
   *   is removed as soon as it has been printed, so without this nothing it names can be
   *   opened afterwards without re-unzipping.
   * @param {string} [options.jsonOut] - File to write the compact diff's underlying data to
   *   as JSON. The markdown is rendered from this same object, so a consumer can read it
   *   directly instead of parsing headings back out of the rendered comment.
   */
  constructor(partnerId, options = {}) {
    this.partnerId = partnerId;
    this.openReport = options.openReport ?? !process.env.CI;
    this.compact = options.compact ?? false;
    this.keepExtracted = options.keepExtracted;
    this.jsonOut = options.jsonOut;
  }

  /**
   * Remove the extracted results tree, or preserve it at `keepExtracted` if the caller
   * asked for that. Preserving copies rather than renames: the tree lives in the OS temp
   * dir, which is routinely a different filesystem, where rename fails with EXDEV.
   * @param {string} resultsDir
   */
  #cleanupResults(resultsDir) {
    // Guarded: `--compact --extract-flagged-only` runs two commands that each extract the
    // zip, and copying the same tree out twice would just overwrite it and say so twice.
    if (this.keepExtracted && !this.#keptExtracted) {
      this.#keptExtracted = true;
      try {
        // Refused rather than merged into or cleared: merging leaves an earlier run's
        // files next to this one's, and clearing a caller-supplied path is too dangerous.
        if (!isAbsentOrEmptyDir(this.keepExtracted)) throw new Error("it already exists and is not an empty directory");
        fs.mkdirSync(path.dirname(path.resolve(this.keepExtracted)), { recursive: true });
        fs.cpSync(resultsDir, this.keepExtracted, { recursive: true });
        consola.info(`Kept the extracted results in ${this.keepExtracted}`);
      } catch (error) {
        // Never fail the run over this - the diff itself already printed.
        consola.warn(`Could not keep the extracted results in ${this.keepExtracted}: ${error.message}`);
      }
    }
    fs.rmSync(resultsDir, { recursive: true, force: true });
  }

  /**
   * Collect the before/after `view.html` pairs for the entries the compact diff flagged,
   * dropping pairs whose two renders are byte-identical. An entry can be flagged for a
   * change the render doesn't show - a named_results/results value, a dependencies/scope
   * change - and a "diff" pair with nothing to compare is just noise for the reviewer.
   * @param {string} resultsDir
   * @param {Object} data - extractCompact() output
   * @returns {{files: Array<{kind: string, entryId: string, phase: string, contents: Buffer}>, entries: Set<string>, identicalSkipped: number}}
   */
  #collectFlaggedViewPairs(resultsDir, data) {
    const files = [];
    const entries = new Set();
    let identicalSkipped = 0;

    for (const entryKey of data.diffEntryKeys) {
      const [kind, entryId] = entryKey.split("/");
      const phaseFiles = {};
      for (const phase of ["before", "after"]) {
        const viewHtmlPath = path.join(resultsDir, "output", kind, entryId, phase, "view.html");
        if (fs.existsSync(viewHtmlPath)) phaseFiles[phase] = fs.readFileSync(viewHtmlPath);
      }

      if (phaseFiles.before && phaseFiles.after && phaseFiles.before.equals(phaseFiles.after)) {
        identicalSkipped += 1;
        continue;
      }

      for (const [phase, contents] of Object.entries(phaseFiles)) {
        files.push({ kind, entryId, phase, contents });
        entries.add(entryKey);
      }
    }

    return { files, entries, identicalSkipped };
  }

  /**
   * Write just the flagged entries' before/after renders to a directory, instead of
   * embedding them in the zip the way `--add-diffs-folder` does. A full results.zip runs
   * to ~150 MB for a handful of interesting pairs, so a consumer that only wants those
   * otherwise has to download and selectively unzip the whole archive itself.
   * Pure local re-analysis - no network call, no partner/sampler API involved.
   * @param {string} zipPath - Path to a local results.zip
   * @param {string} outDir - Directory to write `<kind>/<entryId>/<phase>/view.html` into
   */
  extractFlaggedOnly(zipPath, outDir) {
    // Same reasoning as --keep-extracted: an earlier run's files would read as this one's.
    if (!isAbsentOrEmptyDir(outDir)) {
      consola.error(`${outDir} already exists and is not an empty directory - remove it or pick another path.`);
      process.exit(1);
      return;
    }
    let zipBuffer;
    try {
      zipBuffer = fs.readFileSync(zipPath);
    } catch (error) {
      consola.error(`Could not read zip at ${zipPath}: ${error.message}`);
      process.exit(1);
    }

    let resultsDir;
    try {
      resultsDir = this.#extractResults(zipBuffer);
      const data = extractCompact(resultsDir);

      if (data.diffEntryKeys.length === 0) {
        consola.info("No differing entries found - nothing to extract.");
        return;
      }

      const { files, entries, identicalSkipped } = this.#collectFlaggedViewPairs(resultsDir, data);
      const skippedNote = identicalSkipped > 0 ? ` ${identicalSkipped} flagged ${identicalSkipped === 1 ? "entry" : "entries"} had identical before/after renders.` : "";

      if (files.length === 0) {
        consola.info(`No visual differences among the flagged entries - nothing to extract.${skippedNote}`);
        return;
      }

      for (const { kind, entryId, phase, contents } of files) {
        const dest = path.join(outDir, kind, entryId, phase, "view.html");
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, contents);
      }

      consola.success(`Extracted ${files.length} view.html file(s) across ${entries.size} ${entries.size === 1 ? "entry" : "entries"} to ${outDir}.${skippedNote}`);
    } catch (error) {
      consola.error(`Could not extract the flagged entries: ${error.message}`);
      process.exit(1);
    } finally {
      if (resultsDir) {
        this.#cleanupResults(resultsDir);
      }
    }
  }

  /**
   * Run liquid sampler for partner templates
   * @param {Object} templateHandles - Object containing arrays of template identifiers
   * @param {Array<string>} templateHandles.reconciliationTexts - Array of reconciliation text handles
   * @param {Array<string>} templateHandles.accountTemplates - Array of account template names
   * @param {Array<string>} templateHandles.sharedParts - Array of shared part names
   * @param {Array<number>} firmIds - Array of firm IDs to use in the sampler
   * @returns {Promise<void>}
   */
  async run(templateHandles = {}, firmIds = []) {
    try {
      // Build payload
      const samplerParams = await this.#buildSamplerParams(templateHandles, firmIds);

      consola.info(`Starting sampler run with ${samplerParams.templates.length} template(s)...`);

      // Start sampler run
      const samplerResponse = await SF.createSamplerRun(this.partnerId, samplerParams);

      if (!samplerResponse?.data?.id) {
        consola.error("Failed to start sampler run - no ID returned");
        if (samplerResponse?.data) {
          consola.error(`Response data: ${JSON.stringify(samplerResponse.data)}`);
        }
        process.exit(1);
      }

      const samplerId = samplerResponse.data.id;

      consola.info(`Sampler run started with ID: ${samplerId}`);

      // Poll for completion
      const samplerRun = await this.#fetchAndWaitSamplerResult(samplerId);

      // Process results
      await this.#handleSamplerResponse(samplerRun);
    } catch (error) {
      errorUtils.errorHandler(error);
    }
  }

  /**
   * Fetch the status of an existing sampler run
   * @param {string} samplerId - The sampler run ID
   * @returns {Promise<void>}
   */
  async checkStatus(samplerId) {
    try {
      consola.info(`Fetching status for sampler run ID: ${samplerId}`);

      const response = await SF.readSamplerRun(this.partnerId, samplerId);

      if (!response?.data?.status) {
        consola.error("Failed to fetch sampler run status. Is staging running?");
        process.exit(1);
      }

      await this.#handleSamplerResponse(response.data);
    } catch (error) {
      errorUtils.errorHandler(error);
    }
  }

  /**
   * Build sampler parameters from local template files
   * @param {Object} templateHandles - Object containing arrays of template identifiers
   * @param {Array<string>} templateHandles.reconciliationTexts - Array of reconciliation text handles
   * @param {Array<string>} templateHandles.accountTemplates - Array of account template names
   * @param {Array<string>} templateHandles.sharedParts - Array of shared part names
   * @param {Array<number>} firmIds - Array of firm IDs to use in the sampler
   * @returns {Object} Sampler payload with templates array
   */
  async #buildSamplerParams(templateHandles = {}, firmIds = []) {
    const templates = [];
    const { reconciliationTexts = [], accountTemplates = [], sharedParts = [] } = templateHandles;

    // Process reconciliation texts
    for (const handle of reconciliationTexts) {
      const templateId = this.#resolveTemplateId("reconciliationText", handle, "reconciliation text");
      const templateContent = await this.#readTemplateContent(ReconciliationText, handle, "reconciliation text");

      templates.push({
        type: "reconciliation_text",
        id: templateId,
        ...pickSamplerAttrs(templateContent, "reconciliation_text"),
      });
    }

    // Process account templates
    for (const name of accountTemplates) {
      const templateId = this.#resolveTemplateId("accountTemplate", name, "account template");
      const templateContent = await this.#readTemplateContent(AccountTemplate, name, "account template");

      templates.push({
        type: "account_detail_template",
        id: templateId,
        ...pickSamplerAttrs(templateContent, "account_detail_template"),
      });
    }

    // Process shared parts
    for (const name of sharedParts) {
      const templateId = this.#resolveTemplateId("sharedPart", name, "shared part");
      const templateContent = await this.#readTemplateContent(SharedPart, name, "shared part");

      templates.push({
        type: "shared_part",
        id: templateId,
        ...pickSamplerAttrs(templateContent, "shared_part"),
      });
    }

    return { templates, firm_ids: firmIds };
  }

  /**
   * Resolve a template's partner-specific ID from its local config.
   * Exits the process with a helpful message if the config is missing or has
   * no partner_id entry for the current partner.
   * @param {string} templateType - Config type ("reconciliationText" | "accountTemplate" | "sharedPart")
   * @param {string} handle - Template handle/name
   * @param {string} label - Human-readable label used in error messages
   * @returns {string} The partner template ID
   */
  #resolveTemplateId(templateType, handle, label) {
    if (!fsUtils.configExists(templateType, handle)) {
      consola.error(`Config file for ${label} "${handle}" not found`);
      process.exit(1);
    }

    const config = fsUtils.readConfig(templateType, handle);

    if (!config.partner_id || !config.partner_id[this.partnerId]) {
      consola.error(`${label} '${handle}' has no partner_id entry for partner ${this.partnerId}. Import it to this partner first.`);
      process.exit(1);
    }

    return String(config.partner_id[this.partnerId]);
  }

  /**
   * Read a template's local content, exiting with a clear message if it
   * can't be read (e.g. an invalid handle makes `read` return false).
   * Awaiting is safe for both the synchronous (ReconciliationText,
   * AccountTemplate) and asynchronous (SharedPart) read implementations.
   * @param {Object} TemplateClass - Template class exposing a static `read`
   * @param {string} handle - Template handle/name
   * @param {string} label - Human-readable label used in error messages
   * @returns {Promise<Object>} The template content ({ text, text_parts? })
   */
  async #readTemplateContent(TemplateClass, handle, label) {
    const templateContent = await TemplateClass.read(handle);

    if (!templateContent) {
      consola.error(`Could not read ${label} "${handle}"`);
      process.exit(1);
    }

    return templateContent;
  }

  /**
   * Poll for sampler run completion
   * @param {string} samplerId - The sampler run ID
   * @returns {Promise<Object>} The completed sampler run
   */
  async #fetchAndWaitSamplerResult(samplerId) {
    let samplerRun = { status: "pending" };
    const pollingDelay = 15000; // 15 seconds
    const waitingLimit = 7200000; // 2 hours
    const heartbeatInterval = 60000; // log a status line at most once a minute

    // The animated spinner relies on cursor/line control that only works on
    // an interactive terminal - it silently no-ops otherwise (see
    // lib/cli/spinner.js). Key off the same stdout.isTTY check here (rather
    // than process.env.CI) so a non-interactive invocation (piped output,
    // cron, nohup - not just CI) always gets a status line instead of
    // falling through both the spinner and a one-off log.
    const useSpinner = process.stdout.isTTY;
    if (useSpinner) {
      spinner.spin("Running sampler...");
    } else {
      consola.info("Running sampler... (polling for completion)");
    }
    let waitingTime = 0;

    try {
      while (samplerRun.status === "pending" || samplerRun.status === "running") {
        // Pause the loop before polling again (setTimeout wrapped in a Promise so it can be awaited)
        await new Promise((resolve) => setTimeout(resolve, pollingDelay));

        // Poll for the sampler run status
        const response = await SF.readSamplerRun(this.partnerId, samplerId);
        samplerRun = response?.data;

        if (!samplerRun?.status) {
          // process.exit() bypasses the finally block, so stop the spinner explicitly here.
          spinner.stop();
          consola.error("Failed to fetch sampler run status. Is staging running?");
          process.exit(1);
        }

        waitingTime += pollingDelay;

        // Without the spinner, a long run would otherwise go completely
        // silent for up to waitingLimit - some CI runners' inactivity
        // timeouts could interpret that as a hung job.
        if (!useSpinner && waitingTime % heartbeatInterval === 0) {
          consola.info(`Still running sampler... (${Math.round(waitingTime / 1000)}s elapsed)`);
        }

        if (waitingTime >= waitingLimit) {
          // process.exit() bypasses the finally block, so stop the spinner explicitly here.
          spinner.stop();
          consola.error("Timeout. Try to fetch the status by using the --id flag, if not run your sampler again");
          process.exit(1);
        }
      }

      return samplerRun;
    } finally {
      spinner.stop();
    }
  }

  /**
   * Process and display sampler run results
   * @param {Object} response - The sampler run response
   */
  async #handleSamplerResponse(response) {
    switch (response.status) {
      case "failed":
        consola.error(`Sampler run failed: ${response.error_message || "Unknown error"}`);
        process.exit(1);
        break; // eslint-disable-line no-unreachable

      case "completed":
        consola.success("Sampler run completed successfully");

        if (response && response.result_url) {
          // Always surface the hosted report URL so it can be captured in CI
          // (e.g. echoed into $GITHUB_STEP_SUMMARY) without downloading anything.
          consola.success(`Sampler report: ${response.result_url}`);
          if (this.openReport) {
            await new UrlHandler(response.result_url).openFile();
          }
          if (this.compact) {
            await this.#printCompactDiff(response.result_url);
          }
        } else {
          consola.error("Sampler completed but no result URL was returned");
          process.exit(1);
        }
        break;

      case "pending":        
      case "running":
        consola.info(`Sampler run is still in progress. Current status: "${response.status}". Please check again later.`);
        break;

      default:
        consola.error(`Unexpected sampler status: ${response.status}`);
        process.exit(1);
    }
  }

  /**
   * Download the result zip and print the compact diff. A failure here never
   * fails the run - the run itself already succeeded and the report URL was
   * logged; the compact diff is a best-effort convenience.
   * @param {string} resultUrl - Presigned URL to the results.zip
   */
  async #printCompactDiff(resultUrl) {
    try {
      const response = await axios.get(resultUrl, {
        responseType: "arraybuffer",
        timeout: RESULTS_DOWNLOAD_TIMEOUT_MS,
      });
      await this.#printCompactFromBuffer(Buffer.from(response.data));
    } catch (error) {
      consola.warn(`Could not build compact diff (report is still available at the URL above): ${error.message}`);
    }
  }

  /**
   * Build the compact diff from an already-downloaded local results.zip - no
   * network call, no partner/sampler API involved. Used by `--from-zip` to
   * re-analyze a zip a reviewer already has on disk without re-triggering the
   * backend run (which otherwise means another ~30-60 min wait per re-check).
   * Unlike the live-run path, a failure here IS the whole point of the
   * command, so it's a hard error rather than a warning.
   * @param {string} zipPath - Path to a local results.zip
   * @returns {Promise<void>}
   */
  async printCompactDiffFromZip(zipPath) {
    let buffer;
    try {
      buffer = fs.readFileSync(zipPath);
    } catch (error) {
      consola.error(`Could not read zip at ${zipPath}: ${error.message}`);
      process.exit(1);
    }
    try {
      await this.#printCompactFromBuffer(buffer);
    } catch (error) {
      consola.error(`Could not build compact diff: ${error.message}`);
      process.exit(1);
    }
  }

  /**
   * Add a `diffs/<kind>/<entryId>/{before,after}/view.html` folder to an
   * existing results.zip, containing the before/after rendered view - as
   * context, not for re-diffing - only for entries the compact diff actually
   * flagged (data/scope/vanished-output/visual-only tiers). Lets a reviewer
   * open just the changed pairs instead of digging through every sampled
   * entry in the (often ~150 MB) full archive.
   * Mutates the zip at `zipPath` in place. Like `--from-zip`, this is pure
   * local re-analysis - no network call, no partner/sampler API involved.
   * @param {string} zipPath - Path to a local results.zip
   */
  addDiffsFolderToZip(zipPath) {
    let zipBuffer;
    try {
      zipBuffer = fs.readFileSync(zipPath);
    } catch (error) {
      consola.error(`Could not read zip at ${zipPath}: ${error.message}`);
      process.exit(1);
    }

    let resultsDir;
    let tmpZipPath;
    try {
      resultsDir = this.#extractResults(zipBuffer);
      const data = extractCompact(resultsDir);

      if (data.diffEntryKeys.length === 0) {
        consola.info("No differing entries found - nothing to add to a diffs/ folder.");
        return;
      }

      const zip = new AdmZip(zipBuffer);
      // Shared with --extract-flagged-only: both need the same "flagged AND the render
      // actually differs" set, and two copies of that rule would drift.
      const { files, entries: entriesWithFiles, identicalSkipped } = this.#collectFlaggedViewPairs(resultsDir, data);
      for (const { kind, entryId, phase, contents } of files) {
        zip.addFile(`diffs/${kind}/${entryId}/${phase}/view.html`, contents);
      }
      const filesAdded = files.length;

      // Never silent about what was left out: a reviewer who sees no diffs/
      // folder needs to know whether it's "nothing rendered differently" or
      // "the render was never captured".
      const skippedNote = identicalSkipped > 0 ? ` ${identicalSkipped} flagged ${identicalSkipped === 1 ? "entry" : "entries"} had identical before/after renders.` : "";

      if (filesAdded === 0) {
        if (identicalSkipped > 0) {
          consola.info(
            `No visual differences among the flagged entries - nothing to add to a diffs/ folder.${skippedNote} The change is in the data/scope tiers only; see the compact diff.`
          );
        } else {
          consola.info("No view.html files found for the differing entries - nothing to add to a diffs/ folder.");
        }
        return;
      }

      tmpZipPath = path.join(path.dirname(zipPath), `.${path.basename(zipPath)}.${process.pid}.tmp`);
      zip.writeZip(tmpZipPath);
      fs.renameSync(tmpZipPath, zipPath);
      tmpZipPath = undefined;
      consola.success(
        `Added diffs/ folder to ${zipPath}: ${filesAdded} view.html file(s) across ${entriesWithFiles.size} ${
          entriesWithFiles.size === 1 ? "entry" : "entries"
        }.${skippedNote}`
      );
    } catch (error) {
      consola.error(`Could not build diffs/ folder: ${error.message}`);
      process.exit(1);
    } finally {
      if (resultsDir) {
        this.#cleanupResults(resultsDir);
      }
      if (tmpZipPath) {
        fs.rmSync(tmpZipPath, { force: true });
      }
    }
  }

  /**
   * Shared extract-diff-print-cleanup path for both the live download and
   * the local-zip entry point. Lets errors propagate - callers decide whether
   * a failure here is a soft warning or a hard exit.
   * @param {Buffer} zipBuffer
   */
  async #printCompactFromBuffer(zipBuffer) {
    let resultsDir;
    try {
      resultsDir = this.#extractResults(zipBuffer);
      const data = extractCompact(resultsDir);
      const body = escapeMarkers(formatCompact(data));
      // Plain stdout (not consola) so the markdown is captured verbatim in CI.
      console.log(`\n${COMPACT_START}\n${body}\n${COMPACT_END}`);
      if (this.jsonOut) {
        // Written after the diff has printed: the markdown is the contract, and a sidecar
        // that cannot be written must not cost the caller the diff itself.
        try {
          fs.mkdirSync(path.dirname(path.resolve(this.jsonOut)), { recursive: true });
          writeFileAtomic(this.jsonOut, `${JSON.stringify(data, null, 2)}\n`);
          consola.info(`Wrote the compact diff data to ${this.jsonOut}`);
        } catch (error) {
          // An earlier run's file left in place would read as this run's.
          fs.rmSync(this.jsonOut, { force: true });
          consola.warn(`Could not write the JSON sidecar to ${this.jsonOut}: ${error.message}`);
        }
      }
    } finally {
      if (resultsDir) {
        this.#cleanupResults(resultsDir);
      }
    }
  }

  /**
   * Selectively extract only the files the compact diff needs
   * (sample_entry_ids.yml + every registers.json + every view.html) from a
   * results.zip buffer. The full archive can run to ~150 MB (rendered_text.md
   * + source_text.liquid dominate); extracting selectively keeps disk/IO minimal.
   * @param {Buffer} zipBuffer
   * @returns {string} Path to a temp directory holding the extracted files
   */
  #extractResults(zipBuffer) {
    const zip = new AdmZip(zipBuffer);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "silverfin-sampler-"));
    try {
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const name = entry.entryName;
        const isNeeded = name === "sample_entry_ids.yml" || name.endsWith("/registers.json") || name.endsWith("/view.html");
        if (!isNeeded) continue;

        const dest = path.resolve(tempDir, name);
        // Reject entries whose name (e.g. "../../etc/passwd") resolves outside
        // tempDir - a zip-slip path traversal via a malicious/corrupted archive.
        if (dest !== tempDir && !dest.startsWith(tempDir + path.sep)) continue;

        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, entry.getData());
      }
      return tempDir;
    } catch (error) {
      // The caller's finally block only cleans up via the return value, which
      // a mid-loop failure never produces - clean up locally before rethrowing.
      fs.rmSync(tempDir, { recursive: true, force: true });
      throw error;
    }
  }
}

module.exports = { LiquidSamplerRunner, isAbsentOrEmptyDir };
