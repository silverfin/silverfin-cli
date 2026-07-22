const fs = require("fs");
const path = require("path");
const YAML = require("yaml");

/**
 * Extract a compact, LLM/review-friendly view of a Liquid Sampler result.
 *
 * A sampler `results.zip` is huge (the rendered HTML report alone can be tens of
 * MB, and the raw per-entry output is ~150 MB at scale). This module builds
 * several small, targeted signals instead of a raw diff:
 *
 *  - `templates`      - the `named_results`/`results` DATA diff, deduped by
 *                       identical change and capped so one broken/verbose
 *                       template can't blow up the whole summary.
 *  - `collapsedEntries` - entries whose rendered output vanished entirely
 *                       between phases (a strong broken-template signal that
 *                       would otherwise show up as dozens of individual
 *                       "value -> undefined" lines).
 *  - `scopeTemplates` - `dependencies` / `rollforward_params` /
 *                       `required_keys_missing` changes: what the template
 *                       depends on, not what it renders.
 *  - `visualOnlyEntries` - entries where `view.html` changed but the DATA
 *                       (named_results/results) didn't - a rendering-only
 *                       regression the data diff can't see.
 *
 * Expected directory layout (inside results.zip):
 *   <dir>/sample_entry_ids.yml
 *   <dir>/output/account_entries/<id>/{before,after}/{registers.json,view.html}
 *   <dir>/output/reconciliation_entries/<id>/{before,after}/{registers.json,view.html}
 */

const ENTRY_KINDS = ["account_entries", "reconciliation_entries"];
// A key can be absent from an object entirely (a broken template stops emitting
// it). JSON has no `undefined`, so an absent key parses as `undefined`; we render
// that distinctly from an explicit JSON `null`.
const ABSENT = Symbol("absent");

// Individual before/after values longer than this are elided - long free-text
// fields (accounting-policy paragraphs, notes) are the single biggest driver of
// oversized summaries, and the full text rarely helps a reviewer decide
// "is this intended?" faster than a preview does.
const MAX_VALUE_CHARS = 100;
// Detail lines shown per template before collapsing the rest into "+N more".
const MAX_CHANGES_SHOWN = 8;
// Named-results/results keys that flip from a value to `undefined` in a single
// entry, at or above this count, are treated as "the render broke" rather than
// as that many independent findings.
const COLLAPSE_MIN_LOST_KEYS = 3;
// Items shown before eliding a set-diff (dependencies/rollforward params/etc.)
const MAX_SET_ITEMS_SHOWN = 3;
// Field-level notes shown per visual-only entry before eliding the rest.
const MAX_VISUAL_CHANGES_SHOWN = 6;

/**
 * Render a named_results value for display. Distinguishes an absent key
 * (template no longer emits it) from an explicit null, and elides long values.
 * @param {*} value
 * @returns {string}
 */
function renderValue(value) {
  if (value === ABSENT) return "undefined";
  const rendered = JSON.stringify(value);
  if (rendered.length > MAX_VALUE_CHARS) {
    return `${rendered.slice(0, MAX_VALUE_CHARS)}…(${rendered.length} chars)`;
  }
  return rendered;
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
 * Read and validate a registers.json file.
 * @param {string} filePath
 * @returns {Object|null} the parsed registers object, or null if unreadable
 */
function readRegisters(filePath) {
  try {
    const registers = JSON.parse(fs.readFileSync(filePath, "utf8"));
    // A valid registers.json is always an object. Anything else (a bare
    // string/number, an array, or a truncated-to-null file) means the file
    // is unreadable, not that its contents happen to be absent.
    if (!registers || typeof registers !== "object" || Array.isArray(registers)) return null;
    return registers;
  } catch {
    return null;
  }
}

/**
 * @param {Object} registers - a parsed registers.json
 * @returns {Object} the named_results object, defaulting to {} when absent
 */
function namedResultsOf(registers) {
  const named = registers.named_results;
  return named && typeof named === "object" ? named : {};
}

/**
 * Serialize a value such that two objects with the same keys/values but a
 * different property insertion order produce the same string. Array element
 * order still matters (a real reordering of a list is a real change).
 * @param {*} value
 * @returns {string}
 */
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
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
    if (stableStringify(b) !== stableStringify(a)) {
      changes.push({ key, before: renderValue(b), after: renderValue(a) });
    }
  }
  return changes;
}

/**
 * Whether a `results` array is a plain 0/1 flag vector (the common shape for
 * reconciliation-check indicators) rather than raw numeric values.
 * @param {Array} arr
 * @returns {boolean}
 */
function isFlagArray(arr) {
  return Array.isArray(arr) && arr.length > 0 && arr.every((v) => v === "0.0" || v === "1.0" || v === "0" || v === "1");
}

/**
 * Format a `results` register value for display. Flag-shaped arrays (every
 * element 0/1) render as a triggered-count, since that's the reviewable
 * signal (e.g. "how many unreconciled indicators fired"); anything else
 * (raw numeric values from other template kinds) falls back to the plain
 * rendered value.
 * @param {*} value
 * @returns {string}
 */
function formatResultsValue(value) {
  if (value == null) return "undefined";
  if (isFlagArray(value)) {
    const triggered = value.filter((v) => v === "1.0" || v === "1").length;
    return `${triggered}/${value.length} triggered`;
  }
  return renderValue(value);
}

/**
 * Diff the `results` register (Liquid's unnamed results array) between
 * phases. Unlike named_results this is a single un-keyed value per entry, so
 * it's either unchanged or it's one change - never one per array element.
 * @param {*} before
 * @param {*} after
 * @returns {{before: string, after: string}|null}
 */
function diffResultsRegister(before, after) {
  const b = before == null ? null : before;
  const a = after == null ? null : after;
  if (JSON.stringify(b) === JSON.stringify(a)) return null;
  return { before: formatResultsValue(before), after: formatResultsValue(after) };
}

/**
 * Set-diff two arrays of strings.
 * @param {Array<string>} beforeArr
 * @param {Array<string>} afterArr
 * @returns {{added: Array<string>, removed: Array<string>}|null} null if identical
 */
function diffStringSet(beforeArr, afterArr) {
  const before = new Set(beforeArr || []);
  const after = new Set(afterArr || []);
  const added = [...after].filter((x) => !before.has(x)).sort();
  const removed = [...before].filter((x) => !after.has(x)).sort();
  if (added.length === 0 && removed.length === 0) return null;
  return { added, removed };
}

/**
 * @param {Array<string>} items
 * @returns {string} up to MAX_SET_ITEMS_SHOWN items, then "+N more"
 */
function previewList(items, max = MAX_SET_ITEMS_SHOWN) {
  if (items.length <= max) return items.join(", ");
  return `${items.slice(0, max).join(", ")} +${items.length - max} more`;
}

/**
 * @param {number} n
 * @param {string} unit - singular form, e.g. "handle"
 * @returns {string}
 */
function pluralize(n, unit) {
  return `${unit}${n === 1 ? "" : "s"}`;
}

/**
 * Render an added/removed set-diff as a compact one-line summary, e.g.
 * "−1 ledger (10028311), +2 handles (overview_notes, office_info)".
 * @param {Array<string>} added
 * @param {Array<string>} removed
 * @param {string} unit
 * @returns {string}
 */
function formatSetSummary(added, removed, unit) {
  const parts = [];
  if (removed.length) parts.push(`−${removed.length} ${pluralize(removed.length, unit)} (${previewList(removed)})`);
  if (added.length) parts.push(`+${added.length} ${pluralize(added.length, unit)} (${previewList(added)})`);
  return parts.join(", ");
}

/**
 * @param {Object} deps - a `dependencies` register value
 * @returns {Object<string, Array<string>>} handle names keyed by ledger id
 */
function dependencyHandlesPerLedger(deps) {
  return (deps && deps.reconciliations && deps.reconciliations.handles_per_ledger) || {};
}

/**
 * @param {Object} deps - a `dependencies` register value
 * @returns {Array<string>} every ledger id the template touches, from either
 *   the flat `ledgers` list or the handles-per-ledger map
 */
function dependencyLedgers(deps) {
  if (!deps) return [];
  const handlesPerLedger = dependencyHandlesPerLedger(deps);
  return [...new Set([...(deps.ledgers || []).map(String), ...Object.keys(handlesPerLedger)])];
}

/**
 * @param {Object} deps - a `dependencies` register value
 * @returns {Array<string>} every distinct handle name depended on, across all ledgers
 */
function dependencyHandles(deps) {
  if (!deps) return [];
  return [...new Set(Object.values(dependencyHandlesPerLedger(deps)).flat())];
}

/**
 * Diff a template's `dependencies` register (which ledgers/handles/account
 * ranges/company attributes it reads) - its SCOPE, not its rendered data.
 * Returned as one line per category (rather than one joined string) since a
 * template can touch all four at once and a semicolon-packed single line
 * gets unreadable fast.
 * @param {Object} before
 * @param {Object} after
 * @returns {Array<string>|null} one summary line per changed category, or null if unchanged
 */
function diffDependencies(before, after) {
  const parts = [];

  const ledgerDiff = diffStringSet(dependencyLedgers(before), dependencyLedgers(after));
  if (ledgerDiff) parts.push(formatSetSummary(ledgerDiff.added, ledgerDiff.removed, "ledger"));

  const handleDiff = diffStringSet(dependencyHandles(before), dependencyHandles(after));
  if (handleDiff) parts.push(formatSetSummary(handleDiff.added, handleDiff.removed, "handle"));

  const rangeDiff = diffStringSet((before && before.account_ranges) || [], (after && after.account_ranges) || []);
  if (rangeDiff) parts.push(formatSetSummary(rangeDiff.added, rangeDiff.removed, "account range"));

  const beforeAttr = !!(before && before.company && before.company.attributes);
  const afterAttr = !!(after && after.company && after.company.attributes);
  if (beforeAttr !== afterAttr) parts.push(`company.attributes: ${beforeAttr} → ${afterAttr}`);

  return parts.length ? parts : null;
}

/**
 * Diff a template's `rollforward_params` register by declared param name
 * (the `value` is usually null/a placeholder, so the name is the signal).
 * @param {Array<Object>} before
 * @param {Array<Object>} after
 * @returns {string|null}
 */
function diffRollforwardParams(before, after) {
  const names = (list) => (Array.isArray(list) ? list : []).map((p) => p && p.name).filter(Boolean);
  const diff = diffStringSet(names(before), names(after));
  if (!diff) return null;
  return formatSetSummary(diff.added, diff.removed, "param");
}

/**
 * Diff a template's `required_keys_missing` register.
 * @param {Array<string>} before
 * @param {Array<string>} after
 * @returns {string|null}
 */
function diffRequiredKeysMissing(before, after) {
  const diff = diffStringSet(before, after);
  if (!diff) return null;
  return formatSetSummary(diff.added, diff.removed, "key");
}

/**
 * Diff the "scope" registers (what the template depends on / requires), as
 * distinct from the "data" registers (what it renders). Kept as its own tier
 * so a dependency change never gets mistaken for a data regression.
 * @param {Object} before - a parsed registers.json
 * @param {Object} after - a parsed registers.json
 * @returns {Array<{key: string, summary?: string, subLines?: Array<string>}>}
 */
function diffScope(before, after) {
  const changes = [];
  const dependencies = diffDependencies(before.dependencies, after.dependencies);
  if (dependencies) changes.push({ key: "dependencies", subLines: dependencies });

  const rollforwardParams = diffRollforwardParams(before.rollforward_params, after.rollforward_params);
  if (rollforwardParams) changes.push({ key: "rollforward_params", summary: rollforwardParams });

  const requiredKeysMissing = diffRequiredKeysMissing(before.required_keys_missing, after.required_keys_missing);
  if (requiredKeysMissing) changes.push({ key: "required_keys_missing", summary: requiredKeysMissing });

  return changes;
}

/**
 * @param {string} resultsDir
 * @param {string} kind
 * @param {string} entryId
 * @param {"before"|"after"} phase
 * @returns {string} path to that entry's view.html for the given phase
 */
function viewHtmlPath(resultsDir, kind, entryId, phase) {
  return path.join(resultsDir, "output", kind, entryId, phase, "view.html");
}

const HTML_ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/**
 * Minimal entity decoding - just the handful that show up in rendered form markup.
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  return text.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, (m) => HTML_ENTITIES[m]);
}

/**
 * @param {string} attrs - a tag's raw attribute string
 * @param {string} name
 * @returns {string|null} the attribute's value, or null if absent
 */
function getAttr(attrs, name) {
  const match = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? match[1] : null;
}

/**
 * Extract every form field in a rendered view.html that's anchored by
 * `data-name` (Silverfin's stable per-field identifier), keyed by that name.
 * Fields without a `data-name` (static markup, wrapper divs) aren't
 * individually addressable, so they fall outside this map entirely - a
 * change confined to those falls back to the generic note in
 * describeVisualChange.
 * @param {string} html
 * @returns {Map<string, {tag: string, value: string|null, placeholder: string|null}>}
 */
function extractNamedFields(html) {
  const fields = new Map();

  for (const m of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) {
    const name = getAttr(m[1], "data-name");
    if (!name) continue;
    fields.set(name, { tag: "textarea", value: decodeEntities(m[2].trim()), placeholder: getAttr(m[1], "placeholder") });
  }
  for (const m of html.matchAll(/<input\b([^>]*?)\/?>/g)) {
    const name = getAttr(m[1], "data-name");
    if (!name) continue;
    fields.set(name, { tag: "input", value: getAttr(m[1], "value"), placeholder: getAttr(m[1], "placeholder") });
  }
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const name = getAttr(m[1], "data-name");
    if (!name) continue;
    const selected = m[2].match(/<option\b[^>]*\bselected\b[^>]*>([^<]*)</);
    fields.set(name, { tag: "select", value: selected ? decodeEntities(selected[1].trim()) : null, placeholder: null });
  }
  return fields;
}

/**
 * Describe what visually changed between two view.html renders, at the
 * granularity of individual named form fields - added/removed fields, and
 * value/placeholder changes on fields present in both. Falls back to a
 * generic note when the diff isn't explained by any anchored field (e.g. a
 * layout/wrapper change with no `data-name` of its own).
 * @param {string} beforeHtml
 * @param {string} afterHtml
 * @returns {Array<string>}
 */
function describeVisualChange(beforeHtml, afterHtml) {
  const before = extractNamedFields(beforeHtml);
  const after = extractNamedFields(afterHtml);
  const notes = [];

  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const b = before.get(name);
    const a = after.get(name);
    if (b && !a) {
      notes.push(`field \`${name}\` removed`);
      continue;
    }
    if (!b && a) {
      notes.push(`field \`${name}\` added`);
      continue;
    }
    if (b.value !== a.value) {
      notes.push(`field \`${name}\` value: ${renderValue(b.value)} → ${renderValue(a.value)}`);
    }
    if ((b.placeholder || "") !== (a.placeholder || "")) {
      notes.push(`field \`${name}\` placeholder: ${renderValue(b.placeholder || "")} → ${renderValue(a.placeholder || "")}`);
    }
  }

  if (notes.length === 0) {
    notes.push("layout/markup changed with no anchored field explaining it - compare the two view.html files directly");
  }
  return notes;
}

/**
 * Compare an entry's rendered view.html between phases and describe what
 * changed. Returns null when either file is missing (view.html wasn't
 * extracted, or this run predates it) or when they're identical, so callers
 * can skip the tier entirely rather than false-flagging.
 * @param {string} resultsDir
 * @param {string} kind
 * @param {string} entryId
 * @returns {{changes: Array<string>}|null}
 */
function describeViewHtmlDiff(resultsDir, kind, entryId) {
  const beforePath = viewHtmlPath(resultsDir, kind, entryId, "before");
  const afterPath = viewHtmlPath(resultsDir, kind, entryId, "after");
  if (!fs.existsSync(beforePath) || !fs.existsSync(afterPath)) return null;
  const beforeHtml = fs.readFileSync(beforePath, "utf8");
  const afterHtml = fs.readFileSync(afterPath, "utf8");
  if (beforeHtml === afterHtml) return null;
  return { changes: describeVisualChange(beforeHtml, afterHtml) };
}

/**
 * Add a set of changes to a per-template bucket, deduping identical changes
 * across entries (with a count) and tracking one example entry to link back
 * to for a reviewer.
 * @param {Map} byTemplate
 * @param {string} kind
 * @param {string} label
 * @param {string} entryKey - "kind/entryId"
 * @param {Array<{key: string, before?: string, after?: string, summary?: string, subLines?: Array<string>}>} changes
 * @param {string|null} url
 */
function addChangesToTemplate(byTemplate, kind, label, entryKey, changes, url) {
  const templateKey = JSON.stringify([kind, label]);
  if (!byTemplate.has(templateKey)) {
    byTemplate.set(templateKey, {
      label,
      entryIds: new Set(),
      changeCounts: new Map(),
      exampleUrl: url,
      exampleEntryKey: entryKey,
    });
  }
  const bucket = byTemplate.get(templateKey);
  bucket.entryIds.add(entryKey);
  for (const change of changes) {
    const dedupKey = changeDedupKey(change);
    const existing = bucket.changeCounts.get(dedupKey);
    if (existing) {
      existing.count += 1;
    } else {
      bucket.changeCounts.set(dedupKey, { ...change, count: 1 });
    }
  }
}

/**
 * A stable string key identifying a change's shape, for cross-entry dedup.
 * @param {{key: string, before?: string, after?: string, summary?: string, subLines?: Array<string>}} change
 * @returns {string}
 */
function changeDedupKey(change) {
  if (change.subLines !== undefined) return `${change.key}\x00${change.subLines.join("\x01")}`;
  if (change.summary !== undefined) return `${change.key}\x00${change.summary}`;
  return `${change.key}\x00${change.before}\x00${change.after}`;
}

/**
 * Convert a byTemplate bucket map into a sorted, plain-object array.
 * @param {Map} byTemplate
 * @returns {Array<{label: string, entriesChanged: number, exampleUrl: string|null, exampleEntryKey: string, changes: Array}>}
 */
function toTemplatesArray(byTemplate) {
  const templates = [...byTemplate.entries()]
    .map(([, bucket]) => ({
      label: bucket.label,
      entriesChanged: bucket.entryIds.size,
      exampleUrl: bucket.exampleUrl,
      exampleEntryKey: bucket.exampleEntryKey,
      // Most-repeated change first, then alphabetically by key for stability.
      changes: [...bucket.changeCounts.values()].sort((x, y) => y.count - x.count || x.key.localeCompare(y.key)),
    }))
    .sort((x, y) => y.entriesChanged - x.entriesChanged || x.label.localeCompare(y.label));

  return templates;
}

/**
 * Walk an extracted results directory and build every compact-diff tier.
 * @param {string} resultsDir - Path to the extracted results directory
 * @returns {{
 *   summary: {templatesChanged: number, entriesChanged: number, entriesSampled: number, entriesSkipped: number, collapsedCount: number, visualOnlyCount: number},
 *   templates: Array,
 *   scopeTemplates: Array,
 *   collapsedTemplates: Array,
 *   visualOnlyEntries: Array<{kind: string, entryId: string, label: string, url: string|null, changes: Array<string>}>
 * }}
 */
function extractCompact(resultsDir) {
  const labelMap = readEntryLabels(resultsDir);
  const outputDir = path.join(resultsDir, "output");

  const byTemplate = new Map();
  const scopeByTemplate = new Map();
  const collapsedByTemplate = new Map();
  const visualOnlyEntries = [];
  let entriesSampled = 0;
  let entriesSkipped = 0;

  for (const kind of ENTRY_KINDS) {
    const kindDir = path.join(outputDir, kind);
    if (!fs.existsSync(kindDir)) continue;

    for (const entryId of fs.readdirSync(kindDir)) {
      const entryDir = path.join(kindDir, entryId);
      if (!fs.statSync(entryDir).isDirectory()) continue;

      const beforeRegisters = readRegisters(path.join(entryDir, "before", "registers.json"));
      const afterRegisters = readRegisters(path.join(entryDir, "after", "registers.json"));
      if (beforeRegisters === null || afterRegisters === null) {
        // registers.json missing/malformed - this entry was never actually
        // compared, so it shouldn't count toward "sampled".
        entriesSkipped += 1;
        continue;
      }
      entriesSampled += 1;

      const entryKey = `${kind}/${entryId}`;
      const label = (labelMap[entryKey] && labelMap[entryKey].label) || entryId;
      const url = (labelMap[entryKey] && labelMap[entryKey].url) || null;

      const beforeNamed = namedResultsOf(beforeRegisters);
      const afterNamed = namedResultsOf(afterRegisters);
      const namedChanges = diffNamedResults(beforeNamed, afterNamed);

      const resultsChange = diffResultsRegister(beforeRegisters.results, afterRegisters.results);
      const dataChanges = resultsChange ? [...namedChanges, { key: "results", ...resultsChange }] : namedChanges;

      // A template that broke mid-render loses many named_results/results
      // keys at once - that's ONE finding ("output vanished"), not N.
      const vanishedCount = dataChanges.filter((c) => c.after === "undefined").length;
      const hadContentBefore = Object.keys(beforeNamed).length > 0 || beforeRegisters.results != null;
      const isCollapse = hadContentBefore && vanishedCount === dataChanges.length && vanishedCount >= COLLAPSE_MIN_LOST_KEYS;

      if (isCollapse) {
        // Grouped and deduped the same way as data/scope changes, so a
        // template that broke across dozens of sampled companies collapses
        // into one section entry instead of one line per entry.
        addChangesToTemplate(collapsedByTemplate, kind, label, entryKey, [{ key: "output vanished", summary: `${vanishedCount} value(s) lost` }], url);
      } else if (dataChanges.length > 0) {
        addChangesToTemplate(byTemplate, kind, label, entryKey, dataChanges, url);
      }

      const scopeChanges = diffScope(beforeRegisters, afterRegisters);
      if (scopeChanges.length > 0) {
        addChangesToTemplate(scopeByTemplate, kind, label, entryKey, scopeChanges, url);
      }

      // The visual-only tier only adds information when the data tier found
      // nothing to explain a view.html change - otherwise it's just a noisier
      // restatement of a finding already surfaced above.
      if (!isCollapse && dataChanges.length === 0) {
        const visualDiff = describeViewHtmlDiff(resultsDir, kind, entryId);
        if (visualDiff) {
          visualOnlyEntries.push({ kind, entryId, label, url, changes: visualDiff.changes });
        }
      }
    }
  }

  const templates = toTemplatesArray(byTemplate);
  const scopeTemplates = toTemplatesArray(scopeByTemplate);
  const collapsedTemplates = toTemplatesArray(collapsedByTemplate);
  const entriesChanged = templates.reduce((sum, t) => sum + t.entriesChanged, 0);
  const collapsedCount = collapsedTemplates.reduce((sum, t) => sum + t.entriesChanged, 0);

  return {
    summary: {
      templatesChanged: templates.length,
      entriesChanged,
      entriesSampled,
      entriesSkipped,
      collapsedCount,
      visualOnlyCount: visualOnlyEntries.length,
    },
    templates,
    scopeTemplates,
    collapsedTemplates,
    visualOnlyEntries,
  };
}

/**
 * A markdown link to an example entry: the live app URL when known, else a
 * relative path into the results directory so a reviewer with the zip open
 * locally still has somewhere to look.
 * @param {string|null} url
 * @param {string} entryKey - "kind/entryId"
 * @returns {string}
 */
function exampleRef(url, entryKey) {
  return url ? `([example](${url}))` : `(\`output/${entryKey}/\`)`;
}

/**
 * @param {number} n
 * @param {string} word - singular form, e.g. "entry"
 * @returns {string} "entry" or "entries"/"words" as appropriate
 */
function pluralizeWord(n, word) {
  if (n === 1) return word;
  return word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`;
}

/**
 * Render a capped list of `{key, before, after}`, `{key, summary}`, or
 * `{key, subLines}` change lines, disclosing how many were elided rather
 * than silently dropping them. `subLines` (e.g. a `dependencies` change with
 * one line per category: ledgers/handles/account ranges) renders as a nested
 * list under the change's key instead of one semicolon-packed line.
 * @param {Array<Object>} changes
 * @returns {Array<string>}
 */
function formatChangeLines(changes) {
  const lines = [];
  for (const change of changes.slice(0, MAX_CHANGES_SHOWN)) {
    const times = change.count > 1 ? `[${change.count}×] ` : "";
    if (change.subLines !== undefined) {
      lines.push(`- ${times}\`${change.key}\`:`);
      for (const sub of change.subLines) lines.push(`  - ${sub}`);
      continue;
    }
    const body = change.summary !== undefined ? change.summary : `\`${change.before}\` → \`${change.after}\``;
    lines.push(`- ${times}\`${change.key}\`: ${body}`);
  }
  if (changes.length > MAX_CHANGES_SHOWN) {
    lines.push(`- … +${changes.length - MAX_CHANGES_SHOWN} more change${changes.length - MAX_CHANGES_SHOWN === 1 ? "" : "s"}`);
  }
  return lines;
}

/**
 * Format the full compact diff as Markdown, suitable for stdout or a PR
 * comment. Sections only appear when they have content, and every finding
 * points at a concrete file or URL to follow up on.
 * @param {ReturnType<typeof extractCompact>} data
 * @returns {string}
 */
function formatCompact(data) {
  const summary = data.summary || {};
  const templates = data.templates || [];
  const scopeTemplates = data.scopeTemplates || [];
  const collapsedTemplates = data.collapsedTemplates || [];
  const visualOnlyEntries = data.visualOnlyEntries || [];
  const lines = [];

  lines.push("## 🧪 Sampler compact diff");
  lines.push("");

  const nothingChanged = templates.length === 0 && scopeTemplates.length === 0 && collapsedTemplates.length === 0 && visualOnlyEntries.length === 0;
  const skippedNote = summary.entriesSkipped > 0 ? `, ${summary.entriesSkipped} skipped (unreadable registers.json)` : "";

  if (nothingChanged) {
    lines.push(`No changes detected across ${summary.entriesSampled} sampled ${pluralizeWord(summary.entriesSampled, "entry")}${skippedNote}.`);
    return lines.join("\n");
  }

  const headline = [`**${summary.templatesChanged}** template(s) changed across **${summary.entriesChanged}** ${pluralizeWord(summary.entriesChanged, "entry")}`];
  headline.push(`(${summary.entriesSampled} sampled${skippedNote})`);
  lines.push(headline.join(" "));

  if (collapsedTemplates.length > 0) {
    lines.push("");
    lines.push(`### ⚠️ Output vanished (${summary.collapsedCount} ${pluralizeWord(summary.collapsedCount, "entry")} across ${collapsedTemplates.length} template(s))`);
    lines.push("Rendered output that existed before is completely gone after - check for a broken include/tag, not a data change.");
    for (const template of collapsedTemplates) {
      lines.push("");
      const ref = exampleRef(template.exampleUrl, template.exampleEntryKey);
      lines.push(`**${template.label}** — ${template.entriesChanged} ${pluralizeWord(template.entriesChanged, "entry")} collapsed ${ref}`);
      lines.push(...formatChangeLines(template.changes));
    }
  }

  for (const template of templates) {
    lines.push("");
    const ref = exampleRef(template.exampleUrl, template.exampleEntryKey);
    lines.push(`### ${template.label} — ${template.entriesChanged} ${pluralizeWord(template.entriesChanged, "entry")} changed ${ref}`);
    lines.push(...formatChangeLines(template.changes));
  }

  if (scopeTemplates.length > 0) {
    lines.push("");
    lines.push("### 🔧 Scope/dependency changes");
    lines.push("What each template depends on/requires changed - not its rendered data.");
    for (const template of scopeTemplates) {
      lines.push("");
      const ref = exampleRef(template.exampleUrl, template.exampleEntryKey);
      lines.push(`**${template.label}** — ${template.entriesChanged} ${pluralizeWord(template.entriesChanged, "entry")} ${ref}`);
      lines.push(...formatChangeLines(template.changes));
    }
  }

  if (visualOnlyEntries.length > 0) {
    lines.push("");
    lines.push(`### 👁️ Visual-only changes (${visualOnlyEntries.length} ${pluralizeWord(visualOnlyEntries.length, "entry")}, data unchanged)`);
    lines.push("`view.html` differs even though named_results/results didn't - a markup/layout change the data diff can't see.");
    for (const entry of visualOnlyEntries) {
      lines.push("");
      const entryKey = `${entry.kind}/${entry.entryId}`;
      const ref = entry.url ? `[open in app](${entry.url}) · ` : "";
      lines.push(`**${entry.label}** — ${ref}\`output/${entryKey}/{before,after}/view.html\``);
      for (const note of entry.changes.slice(0, MAX_VISUAL_CHANGES_SHOWN)) {
        lines.push(`- ${note}`);
      }
      if (entry.changes.length > MAX_VISUAL_CHANGES_SHOWN) {
        const hidden = entry.changes.length - MAX_VISUAL_CHANGES_SHOWN;
        lines.push(`- … +${hidden} more change${hidden === 1 ? "" : "s"}`);
      }
    }
  }

  return lines.join("\n");
}

module.exports = {
  extractCompact,
  formatCompact,
  diffNamedResults,
  diffResultsRegister,
  diffScope,
  describeVisualChange,
  readEntryLabels,
};
