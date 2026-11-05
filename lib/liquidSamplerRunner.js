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
const { extractCompact, formatCompact, rendersDiffer, viewHtmlPath } = require("./liquidSamplerCompact");
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

// A larger file in results.zip is skipped rather than extracted, so a corrupt or crafted
// archive can't exhaust memory or disk. Real registers.json/view.html files are far smaller.
const MAX_EXTRACTED_ENTRY_BYTES = 64 * 1024 * 1024;

/**
 * Project a locally-read template onto the attributes the sampler API accepts
 * (its class's SAMPLER_ATTRS). The backend assigns these verbatim to the partner
 * template and reverts after the run.
 * Unset keys are omitted rather than sent - the backend assigns whatever
 * arrives, so a stray undefined/null would blank the partner's value for the
 * run. A config carries the platform's nulls verbatim, so null means "never
 * set" here; an empty string is a deliberate clear and is sent.
 * @param {Object} templateContent - Object returned by TemplateClass.read()
 * @param {Object} TemplateClass - ReconciliationText, AccountTemplate or SharedPart
 * @returns {Object} Allow-listed subset of templateContent
 */
function pickSamplerAttrs(templateContent, TemplateClass) {
  const attrs = {};
  for (const key of TemplateClass.SAMPLER_ATTRS) {
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
  // Zip paths the last #extractResults skipped as too large, to their crc:size, for extractCompact
  #oversizedEntries = new Map();
  // --from-zip with --add-diffs-folder/--extract-flagged-only extracts the same zip up to three times
  #warnedOversized = false;
  // Set once the extracted tree is known to be sampler output, so a refused zip isn't kept
  #extractedIsSamplerZip = false;

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
    // Guarded: --from-zip with --add-diffs-folder or --extract-flagged-only extracts the zip
    // more than once, and copying the same tree out again would only overwrite it.
    if (this.keepExtracted && !this.#keptExtracted && this.#extractedIsSamplerZip) {
      this.#keptExtracted = true;
      try {
        // Refused rather than merged into or cleared: merging leaves an earlier run's
        // files next to this one's, and clearing a caller-supplied path is too dangerous.
        if (!fsUtils.isAbsentOrEmptyDir(this.keepExtracted)) throw new Error("it already exists and is not an empty directory");
        fsUtils.copyDirectory(resultsDir, this.keepExtracted);
        consola.info(`Kept the extracted results in ${this.keepExtracted}`);
      } catch (error) {
        // The diff already printed, so carry on, but exit non-zero: a requested output is missing.
        consola.warn(`Could not keep the extracted results in ${this.keepExtracted}: ${error.message}`);
        process.exitCode = 1;
      }
    }
    fs.rmSync(resultsDir, { recursive: true, force: true });
  }

  /**
   * Collect the before/after `view.html` pairs for the entries the compact diff flagged,
   * dropping pairs whose two renders don't differ (per-entry object ids ignored, like the
   * visual-only tier). An entry can be flagged for a change the render doesn't show - a
   * named_results/results value, a dependencies/scope change - and a "diff" pair with
   * nothing to compare is just noise for the reviewer.
   * @param {string} resultsDir
   * @param {Object} data - extractCompact() output
   * @returns {{files: Array<{kind: string, entryId: string, phase: string, contents: Buffer}>, entries: Set<string>, identicalSkipped: number, skippedNote: string}}
   */
  #collectFlaggedViewPairs(resultsDir, data) {
    const files = [];
    const entries = new Set();
    let identicalSkipped = 0;
    let oversizedDropped = 0;

    for (const entryKey of data.diffEntryKeys) {
      const [kind, entryId] = entryKey.split("/");
      const phaseFiles = {};
      for (const phase of ["before", "after"]) {
        if (this.#oversizedEntries.has(`output/${kind}/${entryId}/${phase}/view.html`)) {
          oversizedDropped += 1;
          continue;
        }
        // Anything can sit at this path in a --from-zip archive; treat a non-file as absent.
        const contents = fsUtils.readFileIfPresent(viewHtmlPath(resultsDir, kind, entryId, phase));
        if (contents) phaseFiles[phase] = contents;
      }

      if (phaseFiles.before && phaseFiles.after && !rendersDiffer(phaseFiles.before, phaseFiles.after)) {
        identicalSkipped += 1;
        continue;
      }

      for (const [phase, contents] of Object.entries(phaseFiles)) {
        files.push({ kind, entryId, phase, contents });
        entries.add(entryKey);
      }
    }

    const identicalNote =
      identicalSkipped > 0 ? ` ${identicalSkipped} flagged ${identicalSkipped === 1 ? "entry" : "entries"} had identical before/after renders, ignoring per-entry object ids.` : "";
    const oversizedNote = oversizedDropped > 0 ? ` ${oversizedDropped} view.html file(s) were too large to extract and are not included.` : "";
    const skippedNote = identicalNote + oversizedNote;
    return { files, entries, identicalSkipped, skippedNote };
  }

  /**
   * Read a local results.zip, or exit 1 naming it.
   * @param {string} zipPath
   * @returns {Buffer|undefined} undefined only when process.exit is stubbed
   */
  #readLocalZip(zipPath) {
    try {
      return fs.readFileSync(zipPath);
    } catch (error) {
      consola.error(`Could not read zip at ${zipPath}: ${error.message}`);
      process.exit(1);
    }
  }

  /**
   * Refuse a zip that isn't sampler output at all (a wrong file or a truncated
   * download), which would otherwise read as a clean "no changes" result. A real run that
   * sampled nothing still has its sample_entry_ids.yml, and is reported as such.
   * @param {string} resultsDir - #extractResults() output
   */
  #assertSamplerZip(resultsDir) {
    this.#extractedIsSamplerZip = fs.existsSync(path.join(resultsDir, "sample_entry_ids.yml")) || fs.existsSync(path.join(resultsDir, "output"));
    if (!this.#extractedIsSamplerZip) {
      throw new Error("the zip has no sample_entry_ids.yml or output/ - is it a sampler results.zip?");
    }
  }

  /**
   * Remove an earlier run's --json file before this run starts, so a run that fails
   * before writing its own can't leave the old one to be read as this run's. A symlink
   * is kept and its target removed, so the new file is written through it again.
   */
  #discardEarlierJson() {
    if (!this.jsonOut) return;
    try {
      fsUtils.removeFileThroughSymlinks(this.jsonOut);
    } catch (error) {
      consola.warn(`Could not remove the earlier ${this.jsonOut}: ${error.message}`);
    }
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
    let usable;
    try {
      usable = fsUtils.isAbsentOrEmptyDir(outDir);
    } catch (error) {
      consola.error(`Cannot use ${outDir}: ${error.message}`);
      process.exit(1);
      return;
    }
    if (!usable) {
      consola.error(`${outDir} already exists and is not an empty directory - remove it or pick another path.`);
      process.exit(1);
      return;
    }
    const zipBuffer = this.#readLocalZip(zipPath);
    if (!zipBuffer) return;

    let resultsDir;
    // Exit only after `finally`: process.exit() would skip the temp-dir cleanup.
    let failed = false;
    try {
      resultsDir = this.#extractResults(zipBuffer);
      this.#assertSamplerZip(resultsDir);
      const data = extractCompact(resultsDir, { oversizedEntries: this.#oversizedEntries });

      if (data.diffEntryKeys.length === 0) {
        consola.info("No differing entries found - nothing to extract.");
        return;
      }

      const { files, entries, identicalSkipped, skippedNote } = this.#collectFlaggedViewPairs(resultsDir, data);

      if (files.length === 0) {
        if (identicalSkipped > 0) {
          consola.info(`No visual differences among the flagged entries - nothing to extract.${skippedNote}`);
        } else {
          consola.info(`No view.html files found for the differing entries - nothing to extract.${skippedNote}`);
        }
        return;
      }

      fsUtils.writeDirectoryAtomic(
        outDir,
        files.map(({ kind, entryId, phase, contents }) => ({ relPath: path.join(kind, entryId, phase, "view.html"), contents }))
      );

      consola.success(`Extracted ${files.length} view.html file(s) across ${entries.size} ${entries.size === 1 ? "entry" : "entries"} to ${outDir}.${skippedNote}`);
    } catch (error) {
      consola.error(`Could not extract the flagged entries: ${error.message}`);
      failed = true;
    } finally {
      if (resultsDir) {
        this.#cleanupResults(resultsDir);
      }
    }
    if (failed) process.exit(1);
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
    if (this.compact) this.#discardEarlierJson();
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
    if (this.compact) this.#discardEarlierJson();
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
        ...pickSamplerAttrs(templateContent, ReconciliationText),
      });
    }

    // Process account templates
    for (const name of accountTemplates) {
      const templateId = this.#resolveTemplateId("accountTemplate", name, "account template");
      const templateContent = await this.#readTemplateContent(AccountTemplate, name, "account template");

      templates.push({
        type: "account_detail_template",
        id: templateId,
        ...pickSamplerAttrs(templateContent, AccountTemplate),
      });
    }

    // Process shared parts
    for (const name of sharedParts) {
      const templateId = this.#resolveTemplateId("sharedPart", name, "shared part");
      const templateContent = await this.#readTemplateContent(SharedPart, name, "shared part");

      templates.push({
        type: "shared_part",
        id: templateId,
        ...pickSamplerAttrs(templateContent, SharedPart),
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
        // An output the caller asked for (--json, --keep-extracted) wasn't produced.
        if (this.compact && (this.jsonOut || this.keepExtracted)) process.exitCode = 1;
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
      // The diff is best-effort, but an output the caller asked for is now missing.
      if (this.jsonOut || this.keepExtracted) process.exitCode = 1;
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
    this.#discardEarlierJson();
    const buffer = this.#readLocalZip(zipPath);
    if (!buffer) return;
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
    const zipBuffer = this.#readLocalZip(zipPath);
    if (!zipBuffer) return;

    let resultsDir;
    // Exit only after `finally`: process.exit() would skip the temp-dir cleanup.
    let failed = false;
    try {
      resultsDir = this.#extractResults(zipBuffer);
      this.#assertSamplerZip(resultsDir);
      const data = extractCompact(resultsDir, { oversizedEntries: this.#oversizedEntries });

      // Replace, never merge: pairs from an earlier --add-diffs-folder run that are no
      // longer flagged would otherwise stay in the zip next to this run's.
      const zip = new AdmZip(zipBuffer);
      const earlierDiffs = zip.getEntries().filter((entry) => entry.entryName.startsWith("diffs/"));
      for (const entry of earlierDiffs) zip.deleteEntry(entry.entryName);
      const removedNote = earlierDiffs.length > 0 ? " Removed the earlier diffs/ folder." : "";
      const writeIfChanged = () => {
        if (earlierDiffs.length > 0) fsUtils.writeFileAtomic(zipPath, zip.toBuffer());
      };

      if (data.diffEntryKeys.length === 0) {
        writeIfChanged();
        consola.info(`No differing entries found - nothing to add to a diffs/ folder.${removedNote}`);
        return;
      }

      // Shared with --extract-flagged-only: both need the same "flagged AND the render
      // actually differs" set, and two copies of that rule would drift.
      const { files, entries: entriesWithFiles, identicalSkipped, skippedNote } = this.#collectFlaggedViewPairs(resultsDir, data);
      for (const { kind, entryId, phase, contents } of files) {
        zip.addFile(`diffs/${kind}/${entryId}/${phase}/view.html`, contents);
      }
      const filesAdded = files.length;

      // Never silent about what was left out: a reviewer who sees no diffs/
      // folder needs to know whether it's "nothing rendered differently" or
      // "the render was never captured".
      if (filesAdded === 0) {
        writeIfChanged();
        if (identicalSkipped > 0) {
          consola.info(
            `No visual differences among the flagged entries - nothing to add to a diffs/ folder.${skippedNote} The change is in the data/scope tiers only; see the compact diff.${removedNote}`
          );
        } else {
          consola.info(`No view.html files found for the differing entries - nothing to add to a diffs/ folder.${skippedNote}${removedNote}`);
        }
        return;
      }

      fsUtils.writeFileAtomic(zipPath, zip.toBuffer());
      consola.success(
        `Added diffs/ folder to ${zipPath}: ${filesAdded} view.html file(s) across ${entriesWithFiles.size} ${
          entriesWithFiles.size === 1 ? "entry" : "entries"
        }.${skippedNote}${removedNote}`
      );
    } catch (error) {
      consola.error(`Could not build diffs/ folder: ${error.message}`);
      failed = true;
    } finally {
      if (resultsDir) {
        this.#cleanupResults(resultsDir);
      }
    }
    if (failed) process.exit(1);
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
      this.#assertSamplerZip(resultsDir);
      const data = extractCompact(resultsDir, { oversizedEntries: this.#oversizedEntries });
      const body = escapeMarkers(formatCompact(data));
      // Plain stdout (not consola) so the markdown is captured verbatim in CI.
      console.log(`\n${COMPACT_START}\n${body}\n${COMPACT_END}`);
      if (this.jsonOut) {
        // Written after the diff has printed: the markdown is the contract, and a sidecar
        // that cannot be written must not cost the caller the diff itself.
        // An earlier run's file was already removed, and an atomic write leaves no partial one.
        try {
          fsUtils.writeFileAtomic(this.jsonOut, `${JSON.stringify(data, null, 2)}\n`);
          consola.info(`Wrote the compact diff data to ${this.jsonOut}`);
        } catch (error) {
          consola.warn(`Could not write the JSON sidecar to ${this.jsonOut}: ${error.message}`);
          process.exitCode = 1;
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
    this.#oversizedEntries = new Map();
    this.#extractedIsSamplerZip = false;
    try {
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const name = entry.entryName;
        // Only output/: an earlier --add-diffs-folder run's diffs/ pairs must not come along.
        const isNeeded = name === "sample_entry_ids.yml" || (name.startsWith("output/") && (name.endsWith("/registers.json") || name.endsWith("/view.html")));
        if (!isNeeded) continue;

        const dest = path.resolve(tempDir, name);
        // Reject entries whose name (e.g. "../../etc/passwd") resolves outside
        // tempDir - a zip-slip path traversal via a malicious/corrupted archive.
        if (dest !== tempDir && !dest.startsWith(tempDir + path.sep)) continue;

        // Checked before and after inflating: the declared size can't be trusted.
        if (entry.header.size > MAX_EXTRACTED_ENTRY_BYTES) {
          this.#oversizedEntries.set(name, `${entry.header.crc}:${entry.header.size}`);
          continue;
        }
        const data = entry.getData();
        if (data.length > MAX_EXTRACTED_ENTRY_BYTES) {
          this.#oversizedEntries.set(name, `${entry.header.crc}:${entry.header.size}`);
          continue;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, data);
      }
      const oversized = this.#oversizedEntries.size;
      if (oversized > 0 && !this.#warnedOversized) {
        this.#warnedOversized = true;
        consola.warn(`Skipped ${oversized} file(s) over ${MAX_EXTRACTED_ENTRY_BYTES / 1024 / 1024} MB in the zip; they are reported as too large, not compared.`);
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

module.exports = { LiquidSamplerRunner };
