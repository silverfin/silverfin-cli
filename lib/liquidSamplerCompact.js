const fs = require("fs");
const path = require("path");
const YAML = require("yaml");

/**
 * Extract a compact, LLM/review-friendly view of a Liquid Sampler result.
 *
 * A sampler `results.zip` is huge (the rendered HTML report alone is ~470K tokens
 * at scale, and the raw per-entry output is ~150 MB). The only signal a reviewer
 * usually needs first is the DATA diff: how each template's `named_results`
 * changed. That lives in `registers.json` for every sampled entry, before/after.
 *
 * This module reads an already-EXTRACTED results directory (the layout inside
 * results.zip) and returns just the `named_results` changes, grouped by template
 * and deduped by identical change, so the whole thing is ~900 tokens instead of
 * hundreds of thousands. It never touches the rendered HTML.
 *
 * Expected directory layout (inside results.zip):
 *   <dir>/sample_entry_ids.yml
 *   <dir>/output/account_entries/<id>/{before,after}/registers.json
 *   <dir>/output/reconciliation_entries/<id>/{before,after}/registers.json
 */

const ENTRY_KINDS = ["account_entries", "reconciliation_entries"];
// A key can be absent from an object entirely (a broken template stops emitting
// it). JSON has no `undefined`, so an absent key parses as `undefined`; we render
// that distinctly from an explicit JSON `null`.
const ABSENT = Symbol("absent");

/**
 * Render a named_results value for display. Distinguishes an absent key
 * (template no longer emits it) from an explicit null.
 * @param {*} value
 * @returns {string}
 */
function renderValue(value) {
  if (value === ABSENT) return "undefined";
  return JSON.stringify(value);
}

/**
 * Build a map of "kind/entry id" -> { label, url } from sample_entry_ids.yml.
 * `label` is the template handle (e.g. "vkt_1"). Returns an empty map if the
 * file is missing or unparseable - callers fall back to the raw entry id.
 * Keyed by kind as well as entry id because account_entries and
 * reconciliation_entries id spaces aren't guaranteed disjoint.
 * @param {string} resultsDir
 * @returns {Object<string, {label: string, url: string}>}
 */
function readEntryLabels(resultsDir) {
  const labelMap = {};
  const ymlPath = path.join(resultsDir, "sample_entry_ids.yml");
  if (!fs.existsSync(ymlPath)) return labelMap;

  let parsed;
  try {
    parsed = YAML.parse(fs.readFileSync(ymlPath, "utf8"));
  } catch {
    return labelMap;
  }
  if (!parsed || typeof parsed !== "object") return labelMap;

  for (const kind of ENTRY_KINDS) {
    for (const [entryId, meta] of Object.entries(parsed[kind] || {})) {
      labelMap[`${kind}/${entryId}`] = {
        label: (meta && meta.label) || entryId,
        url: (meta && meta.url) || null,
      };
    }
  }
  return labelMap;
}

/**
 * Read the named_results object from a registers.json file.
 * @param {string} filePath
 * @returns {Object|null} the named_results object, or null if unreadable
 */
function readNamedResults(filePath) {
  try {
    const registers = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const named = registers.named_results;
    return named && typeof named === "object" ? named : {};
  } catch {
    return null;
  }
}

/**
 * Diff two named_results objects, returning one entry per changed key.
 * @param {Object} before
 * @param {Object} after
 * @returns {Array<{key: string, before: string, after: string}>}
 */
function diffNamedResults(before, after) {
  const changes = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of [...keys].sort()) {
    const b = Object.hasOwn(before, key) ? before[key] : ABSENT;
    const a = Object.hasOwn(after, key) ? after[key] : ABSENT;
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      changes.push({ key, before: renderValue(b), after: renderValue(a) });
    }
  }
  return changes;
}

/**
 * Walk an extracted results directory and build the compact named_results diff.
 * @param {string} resultsDir - Path to the extracted results directory
 * @returns {{
 *   summary: {templatesChanged: number, entriesChanged: number, entriesSampled: number},
 *   templates: Array<{label: string, entriesChanged: number, changes: Array<{key: string, before: string, after: string, count: number}>}>
 * }}
 */
function extractCompact(resultsDir) {
  const labelMap = readEntryLabels(resultsDir);
  const outputDir = path.join(resultsDir, "output");

  // label -> { entryIds: Set, changeCounts: Map<"key\0before\0after", {key,before,after,count}> }
  const byTemplate = new Map();
  let entriesSampled = 0;

  for (const kind of ENTRY_KINDS) {
    const kindDir = path.join(outputDir, kind);
    if (!fs.existsSync(kindDir)) continue;

    for (const entryId of fs.readdirSync(kindDir)) {
      const entryDir = path.join(kindDir, entryId);
      if (!fs.statSync(entryDir).isDirectory()) continue;
      entriesSampled += 1;

      const before = readNamedResults(path.join(entryDir, "before", "registers.json"));
      const after = readNamedResults(path.join(entryDir, "after", "registers.json"));
      if (before === null || after === null) continue;

      const changes = diffNamedResults(before, after);
      if (changes.length === 0) continue;

      const entryKey = `${kind}/${entryId}`;
      const label = (labelMap[entryKey] && labelMap[entryKey].label) || entryId;
      if (!byTemplate.has(label)) {
        byTemplate.set(label, { entryIds: new Set(), changeCounts: new Map() });
      }
      const bucket = byTemplate.get(label);
      bucket.entryIds.add(entryKey);
      for (const change of changes) {
        const dedupKey = `${change.key}\x00${change.before}\x00${change.after}`;
        const existing = bucket.changeCounts.get(dedupKey);
        if (existing) {
          existing.count += 1;
        } else {
          bucket.changeCounts.set(dedupKey, { ...change, count: 1 });
        }
      }
    }
  }

  const templates = [...byTemplate.entries()]
    .map(([label, bucket]) => ({
      label,
      entriesChanged: bucket.entryIds.size,
      // Most-repeated change first, then alphabetically by key for stability.
      changes: [...bucket.changeCounts.values()].sort(
        (x, y) => y.count - x.count || x.key.localeCompare(y.key),
      ),
    }))
    .sort((x, y) => y.entriesChanged - x.entriesChanged || x.label.localeCompare(y.label));

  const entriesChanged = templates.reduce((sum, t) => sum + t.entriesChanged, 0);

  return {
    summary: {
      templatesChanged: templates.length,
      entriesChanged,
      entriesSampled,
    },
    templates,
  };
}

/**
 * Format the compact diff as Markdown, suitable for stdout or a PR comment.
 * @param {ReturnType<typeof extractCompact>} data
 * @returns {string}
 */
function formatCompact(data) {
  const { summary, templates } = data;
  const lines = [];
  lines.push("## 🧪 Sampler compact diff (named_results)");
  lines.push("");

  if (templates.length === 0) {
    lines.push(`No \`named_results\` changes across ${summary.entriesSampled} sampled entr${summary.entriesSampled === 1 ? "y" : "ies"}.`);
    return lines.join("\n");
  }

  lines.push(
    `**${summary.templatesChanged}** template(s) changed across **${summary.entriesChanged}** ` +
      `entr${summary.entriesChanged === 1 ? "y" : "ies"} (${summary.entriesSampled} sampled).`,
  );

  for (const template of templates) {
    lines.push("");
    lines.push(`### ${template.label} — ${template.entriesChanged} entr${template.entriesChanged === 1 ? "y" : "ies"} changed`);
    for (const change of template.changes) {
      const times = change.count > 1 ? `[${change.count}×] ` : "";
      lines.push(`- ${times}\`${change.key}\`: \`${change.before}\` → \`${change.after}\``);
    }
  }

  return lines.join("\n");
}

module.exports = { extractCompact, formatCompact, diffNamedResults, readEntryLabels };
