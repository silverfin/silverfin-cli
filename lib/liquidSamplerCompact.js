const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const YAML = require("yaml");
const { parse: parseHtml } = require("node-html-parser");

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
 *                       regression the data diff can't see. Described by
 *                       parsing the markup (named fields, element counts,
 *                       table geometry), and grouped on output so one
 *                       template-wide change reads as one finding.
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
// Field-level notes shown per visual-only finding before eliding the rest.
const MAX_VISUAL_CHANGES_SHOWN = 6;
// Distinct visual-only findings shown before eliding the rest. Once this tier
// describes structure instead of falling back to a generic note, its output
// grows with the number of templates touched, so it needs the same
// cap-and-disclose treatment as the data tiers.
const MAX_VISUAL_GROUPS_SHOWN = 10;
// Entries named per visual-only finding before eliding the rest.
const MAX_VISUAL_ENTRIES_LISTED = 5;
// Tag deltas named in one structural note. Its own constant rather than
// MAX_SET_ITEMS_SHOWN, which is scoped to register set-diffs - a restructured
// fragment usually moves more than three kinds of tag.
const MAX_TAG_DELTAS_SHOWN = 6;
// Rendered views above this are described rather than parsed: the structural
// pass costs more than linearly in nesting depth, and it runs for both phases
// of every entry whose data didn't change.
const MAX_VIEW_HTML_BYTES = 2 * 1024 * 1024;
// Unclosed non-void tags above this are described rather than parsed: the
// parser is super-linear in them (4,000 unclosed `<div>`s take ~14 s), and a
// loop missing its closing tag produces exactly that far below the size cap.
const MAX_UNCLOSED_TAGS = 1000;
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
// Closed implicitly by node-html-parser, so leaving them open costs nothing. Measured,
// not taken from the HTML spec: an unclosed `<tr>`, `<option>` or `<tbody>` is as slow
// as an unclosed `<div>`.
const IMPLICITLY_CLOSED_TAGS = new Set(["li", "p", "td", "th", "dt", "dd"]);
const VIEW_HTML_UNPARSED = "`view.html` changed, but";

// Rendered-body budget for one PR comment. GitHub rejects an issue-comment body
// over 65,536 characters outright - you get NO comment at all rather than a
// truncated one - and the workflow prepends a header before this diff. The caps
// above are therefore a fallback for that ceiling, not a fixed editorial limit:
// a normal run should show every finding it found, and only a genuinely
// oversized one loses detail.
const COMMENT_BUDGET_CHARS = 60000;

// Cap tiers, loosest first. formatCompact renders at the first tier whose output
// fits the budget, so detail is dropped only when it actually has to be. The
// last tier is the previous fixed behaviour and is also the floor: if even that
// overflows, its output is returned rather than degrading further, because below
// this the diff stops being useful at all. These cap what formatCompact prints;
// the item lists inside one note are built during extraction and keep their
// fixed caps (MAX_SET_ITEMS_SHOWN, MAX_TAG_DELTAS_SHOWN).
const CAP_TIERS = [
  { changes: Infinity, visualChanges: Infinity, visualGroups: Infinity, visualEntries: Infinity },
  { changes: 60, visualChanges: 50, visualGroups: 40, visualEntries: 30 },
  { changes: 25, visualChanges: 20, visualGroups: 20, visualEntries: 12 },
  {
    changes: MAX_CHANGES_SHOWN,
    visualChanges: MAX_VISUAL_CHANGES_SHOWN,
    visualGroups: MAX_VISUAL_GROUPS_SHOWN,
    visualEntries: MAX_VISUAL_ENTRIES_LISTED,
  },
];

// The tier in force for the current render. Module-level rather than threaded
// through every helper: several of these helpers are exported and unit-tested
// directly, and defaulting to the tightest tier keeps their standalone
// behaviour identical to before this change.
let activeCaps = CAP_TIERS[CAP_TIERS.length - 1];

/**
 * Render a named_results value for display. Distinguishes an absent key
 * (template no longer emits it) from an explicit null, and elides long values.
 *
 * A truncated value's suffix includes both the full length and a short
 * content hash, not just the length - two distinct long values that happen
 * to share the same first `MAX_VALUE_CHARS` characters AND the same total
 * length would otherwise render identically. That matters beyond display:
 * this rendered string doubles as the cross-entry dedup key in
 * `changeDedupKey`, so an identical-looking truncation would silently
 * collapse two different values into one deduped change with an inflated
 * count - exactly what this module's truncation is meant to avoid eliding
 * silently.
 * @param {*} value
 * @returns {string}
 */
function renderValue(value) {
  if (value === ABSENT) return "undefined";
  const rendered = JSON.stringify(value);
  if (rendered.length > MAX_VALUE_CHARS) {
    const hash = crypto.createHash("sha1").update(rendered).digest("hex").slice(0, 8);
    return `${rendered.slice(0, MAX_VALUE_CHARS)}…(${rendered.length} chars, #${hash})`;
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
 * Normalize a flag-array element to "1" or "0" for index-by-index comparison.
 * @param {string} v
 * @returns {string}
 */
function normalizeFlag(v) {
  return v === "1.0" || v === "1" ? "1" : "0";
}

/**
 * Format a `results` register value for display. Flag-shaped arrays (every
 * element 0/1) render as a triggered-count, since that's the reviewable
 * signal (e.g. "how many unreconciled indicators fired"); anything else
 * (raw numeric values from other template kinds) falls back to the plain
 * rendered value. An absent register (`undefined`, the key was never there)
 * and an explicit JSON `null` are rendered distinctly, since the latter can
 * be a legitimate value and shouldn't be indistinguishable from - and
 * miscounted alongside - a genuinely vanished register (see the "output
 * vanished" collapse heuristic in extractCompact).
 *
 * `suffix` (from describeFlagFlipSuffix) is appended verbatim - callers pass
 * it only on the `after` side, so a same-triggered-count reorder still
 * renders "N/M triggered" -> "N/M triggered (...)" instead of the identical
 * string on both sides (which would read as a no-op despite the direction
 * being named in the text).
 * @param {*} value
 * @param {string} [suffix]
 * @returns {string}
 */
function formatResultsValue(value, suffix = "") {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (isFlagArray(value)) {
    const triggered = value.filter((v) => normalizeFlag(v) === "1").length;
    return `${triggered}/${value.length} triggered${suffix}`;
  }
  return renderValue(value);
}

/**
 * Describe a same-triggered-count flag-array reorder by which indices
 * turned on vs off, e.g. "(0 off, 1 on)" - not just which indices differ.
 * Naming direction (not just position) matters: two entries with opposite
 * reorders (["1.0","0.0"]->["0.0","1.0"] vs ["0.0","1.0"]->["1.0","0.0"])
 * touch the same index set, so a position-only suffix renders identically
 * for both and they'd still collapse into one deduped change via
 * changeDedupKey (which hashes this rendered string). Naming the direction
 * of each flip makes the two cases render - and dedup - distinctly.
 *
 * The detail list is capped like `renderValue`'s truncation, with a content
 * hash (not just a count) covering the elided flips - a plain "+N more"
 * would let two different long vectors that agree on the first few flipped
 * indices collapse into the same dedup key again.
 * @param {Array<string>} before
 * @param {Array<string>} after
 * @returns {string} e.g. " (0 off, 1 on)", or "" if not a same-count reorder
 */
function describeFlagFlipSuffix(before, after) {
  if (!isFlagArray(before) || !isFlagArray(after) || before.length !== after.length) return "";
  const beforeTriggered = before.filter((v) => normalizeFlag(v) === "1").length;
  const afterTriggered = after.filter((v) => normalizeFlag(v) === "1").length;
  if (beforeTriggered !== afterTriggered) return "";

  const flips = [];
  for (let i = 0; i < before.length; i += 1) {
    const b = normalizeFlag(before[i]);
    const a = normalizeFlag(after[i]);
    if (b !== a) flips.push(`${i} ${a === "1" ? "on" : "off"}`);
  }
  if (flips.length === 0) return "";

  return ` (${previewSet(flips)})`;
}

/**
 * Diff the `results` register (Liquid's unnamed results array) between
 * phases. Unlike named_results this is a single un-keyed value per entry, so
 * it's either unchanged or it's one change - never one per array element.
 * An absent register and an explicit `null` are treated as equivalent for
 * the "did anything change" check (both mean "no results"), but the raw
 * before/after values (not a null-normalized copy) are passed to
 * formatResultsValue so a genuine change still displays "null" vs
 * "undefined" distinctly rather than collapsing both to "undefined".
 * @param {*} before
 * @param {*} after
 * @returns {{before: string, after: string}|null}
 */
function diffResultsRegister(before, after) {
  const b = before == null ? null : before;
  const a = after == null ? null : after;
  if (JSON.stringify(b) === JSON.stringify(a)) return null;
  const suffix = describeFlagFlipSuffix(before, after);
  return { before: formatResultsValue(before), after: formatResultsValue(after, suffix) };
}

/**
 * Set-diff two arrays of strings. Non-array inputs (a malformed register
 * value - a stray string/number/object instead of an array) are treated as
 * empty rather than thrown on, so one bad entry can't abort the whole diff.
 * @param {Array<string>} beforeArr
 * @param {Array<string>} afterArr
 * @returns {{added: Array<string>, removed: Array<string>}|null} null if identical
 */
function diffStringSet(beforeArr, afterArr) {
  const before = new Set(Array.isArray(beforeArr) ? beforeArr : []);
  const after = new Set(Array.isArray(afterArr) ? afterArr : []);
  const added = [...after].filter((x) => !before.has(x)).sort();
  const removed = [...before].filter((x) => !after.has(x)).sort();
  if (added.length === 0 && removed.length === 0) return null;
  return { added, removed };
}

/**
 * @param {Array<string>} items
 * @param {number} max
 * @returns {string} up to `max` items, then "+N more"
 */
function previewList(items, max) {
  if (items.length <= max) return items.join(", ");
  return `${items.slice(0, max).join(", ")} +${items.length - max} more`;
}

/**
 * previewList for a finding's own item list. A truncated preview carries a
 * hash of the full list, so two findings that differ only past the cut don't
 * read as identical - or group as one.
 * @param {Array<string>} items
 * @param {number} [max]
 * @returns {string}
 */
function previewSet(items, max = MAX_SET_ITEMS_SHOWN) {
  if (items.length <= max) return items.join(", ");
  const hash = crypto.createHash("sha1").update(items.join("\n")).digest("hex").slice(0, 8);
  return `${previewList(items, max)}, #${hash}`;
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
  if (removed.length) parts.push(`−${removed.length} ${pluralize(removed.length, unit)} (${previewSet(removed)})`);
  if (added.length) parts.push(`+${added.length} ${pluralize(added.length, unit)} (${previewSet(added)})`);
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
 * @param {*} value
 * @returns {Array} value if it's an array, else [] - a malformed register
 *   value (a stray string/number/object instead of an array) shouldn't throw
 *   and abort the whole sampler run's diff, just be treated as empty.
 */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * @param {Object} deps - a `dependencies` register value
 * @returns {Array<string>} every ledger id the template touches, from either
 *   the flat `ledgers` list or the handles-per-ledger map
 */
function dependencyLedgers(deps) {
  if (!deps) return [];
  const handlesPerLedger = dependencyHandlesPerLedger(deps);
  return [...new Set([...asArray(deps.ledgers).map(String), ...Object.keys(handlesPerLedger)])];
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

  const rangeDiff = diffStringSet(asArray(before && before.account_ranges), asArray(after && after.account_ranges));
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

// Per-entry object ids. They differ between every sampled entry (and can be
// reallocated between two renders of the same entry), so leaving them in makes
// one shared finding look like N distinct ones - and makes a pure id
// reallocation look like a layout change. Quoting is matched loosely because a
// render isn't obliged to use double quotes.
const ENTRY_ID_ATTRS = /(\s(?:data-object-id|data-object-ledger-id))=(?:"[^"]*"|'[^']*'|[^\s>]+)/g;

/**
 * @param {string} html
 * @returns {string} the same markup with per-entry object id values blanked.
 *   Blanked rather than removed, so a template that stops emitting the
 *   attribute entirely still reads as a change.
 */
function normalizeEntryIds(html) {
  return html.replace(ENTRY_ID_ATTRS, '$1=""');
}

const FIELD_TAGS = new Set(["textarea", "input", "select"]);
// Input types that share one `data-name` across a group of elements.
const GROUPED_INPUT_TYPES = new Set(["radio", "checkbox"]);

/**
 * Collapse the non-breaking spaces a render emits as `&nbsp;` to plain spaces.
 * Without this, swapping `&nbsp;` for a literal space renders as
 * `"a b" → "a b"` - two strings a reader can't tell apart.
 * @param {string} text
 * @returns {string}
 */
function normalizeSpaces(text) {
  return text.replace(/\u00a0/g, " ").trim();
}

/**
 * @param {Object} field - an extractNamedFields record
 * @returns {boolean} whether it's an accumulated radio/checkbox group
 */
function isInputGroup(field) {
  return !!field && field.tag === "input" && Array.isArray(field.options);
}

/**
 * Extract every form field in a rendered view.html that's anchored by
 * `data-name` (Silverfin's stable per-field identifier), keyed by that name.
 * Fields without a `data-name` (static markup, wrapper divs) aren't
 * individually addressable, so they fall outside this map entirely - a change
 * confined to those is left to the structural tier in describeVisualChange.
 *
 * Both `<select>`s and radio groups carry a list of available options as well
 * as a selected one. Capturing only the selection hides a whole class of
 * regression (a template that silently loses its option list still reports
 * the same - often null - selection), so `options` is captured alongside.
 * Radio groups share one `data-name` across several `<input>`s, hence the
 * accumulate-then-pick-the-checked-one handling.
 * @param {Object} root - a parsed view.html
 * @returns {Map<string, {tag: string, value: string|null, placeholder: string|null, options: Array<string>|null}>}
 */
function extractNamedFields(root) {
  const fields = new Map();
  for (const el of root.querySelectorAll("[data-name]")) {
    const name = el.getAttribute("data-name");
    const tag = (el.rawTagName || "").toLowerCase();
    if (!name || !FIELD_TAGS.has(tag)) continue;

    if (tag === "textarea") {
      fields.set(name, { tag, value: normalizeSpaces(el.textContent), placeholder: el.getAttribute("placeholder") ?? null, options: null });
      continue;
    }
    if (tag === "select") {
      const options = el.querySelectorAll("option");
      const selected = options.find((option) => option.hasAttribute("selected"));
      fields.set(name, {
        tag,
        value: selected ? normalizeSpaces(selected.textContent) : null,
        placeholder: null,
        options: options.map((option) => normalizeSpaces(option.textContent)),
      });
      continue;
    }

    const rawValue = el.getAttribute("value");
    const value = rawValue == null ? null : normalizeSpaces(rawValue);
    if (GROUPED_INPUT_TYPES.has((el.getAttribute("type") || "").toLowerCase())) {
      // Only accumulate into a previous member of the same group: a textarea or
      // select sharing the data-name carries a different (or no) option list.
      const previous = fields.get(name);
      const group = isInputGroup(previous) ? previous : { tag, value: null, placeholder: null, options: [] };
      group.options.push(value ?? "");
      if (el.hasAttribute("checked")) group.value = value;
      fields.set(name, group);
      continue;
    }
    // A hidden companion input sharing the group's `data-name` is a standard
    // form pattern - letting it win would discard the option list.
    if (isInputGroup(fields.get(name))) continue;
    fields.set(name, { tag, value, placeholder: el.getAttribute("placeholder") ?? null, options: null });
  }
  return fields;
}

/**
 * Describe a change to a field's available options (a `<select>`'s
 * `<option>`s, or a radio group's members).
 * @param {string} name
 * @param {Array<string>|null} before
 * @param {Array<string>|null} after
 * @returns {string|null}
 */
function describeOptionChange(name, before, after) {
  if (!Array.isArray(before) || !Array.isArray(after)) return null;
  const diff = diffStringSet(before, after);
  if (!diff && before.length === after.length) return null;
  // Labels come straight out of the render, so they go in a code span like
  // every other untrusted string this module interpolates into Markdown.
  const parts = [];
  if (diff && diff.removed.length) parts.push(`lost: ${previewSet(diff.removed.map(codeSpan))}`);
  if (diff && diff.added.length) parts.push(`added: ${previewSet(diff.added.map(codeSpan))}`);
  const detail = parts.length ? ` (${parts.join("; ")})` : "";
  return `field ${codeSpan(name)} options: ${before.length} → ${after.length}${detail}`;
}

/**
 * Diff two `extractNamedFields` maps: added/removed fields, and
 * value/placeholder/option-set changes on fields present in both.
 * @param {Map} before
 * @param {Map} after
 * @returns {Array<string>}
 */
function describeFieldChanges(before, after) {
  const notes = [];
  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const b = before.get(name);
    const a = after.get(name);
    if (b && !a) {
      notes.push(`field ${codeSpan(name)} removed`);
      continue;
    }
    if (!b && a) {
      notes.push(`field ${codeSpan(name)} added`);
      continue;
    }
    if (b.tag !== a.tag) {
      notes.push(`field ${codeSpan(name)} element: ${codeSpan(`<${b.tag}>`)} → ${codeSpan(`<${a.tag}>`)}`);
    }
    if (b.value !== a.value) {
      notes.push(`field ${codeSpan(name)} value: ${codeSpan(renderValue(b.value))} → ${codeSpan(renderValue(a.value))}`);
    }
    if ((b.placeholder || "") !== (a.placeholder || "")) {
      notes.push(`field ${codeSpan(name)} placeholder: ${codeSpan(renderValue(b.placeholder || ""))} → ${codeSpan(renderValue(a.placeholder || ""))}`);
    }
    const optionChange = describeOptionChange(name, b.options, a.options);
    if (optionChange) notes.push(optionChange);
  }
  return notes;
}

/**
 * @param {Object} cell - a parsed `<td>`/`<th>`
 * @returns {number} the cell's column span, defaulting to 1 for an absent or
 *   nonsensical `colspan` (a broken template can emit either)
 */
function columnSpan(cell) {
  const span = parseInt(cell.getAttribute("colspan") || "1", 10);
  return Number.isFinite(span) && span > 0 ? span : 1;
}

/**
 * Parse a rendered view.html once into every signal the visual tier diffs:
 * its named fields, per-tag element counts, the document-order tag sequence,
 * per-table row geometry, and the visible text. Nested tables are counted
 * into their ancestor's geometry as well as their own - deliberately, since
 * the signal wanted here is "did this table's shape change", not an exact
 * table model.
 * @param {string} html
 * @returns {{fields: Map, counts: Map<string, number>, sequence: string, tables: Array<Array<number>>, text: string}}
 */
const NON_VISIBLE_TAGS = new Set(["script", "style"]);

/**
 * The document's visible text, with each text node kept separate. Walked
 * rather than taken from `structuredText`, which both includes `<style>` /
 * `<script>` bodies (a CSS edit would read as a content change) and runs
 * adjacent inline elements together into one word.
 * @param {Object} root - a parsed view.html
 * @returns {string}
 */
function visibleText(root) {
  const parts = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (NON_VISIBLE_TAGS.has((child.rawTagName || "").toLowerCase())) continue;
      if (child.nodeType === 3) parts.push(child.text);
      else walk(child);
    }
  };
  walk(root);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function parseStructure(html) {
  const root = parseHtml(html);
  const counts = new Map();
  const sequence = [];
  for (const el of root.querySelectorAll("*")) {
    const tag = (el.rawTagName || "").toLowerCase();
    if (!tag) continue;
    counts.set(tag, (counts.get(tag) || 0) + 1);
    sequence.push(tag);
  }
  const tables = root
    .querySelectorAll("table")
    .map((table) => table.querySelectorAll("tr").map((row) => row.querySelectorAll("td,th").reduce((total, cell) => total + columnSpan(cell), 0)));
  return {
    fields: extractNamedFields(root),
    counts,
    sequence: sequence.join(">"),
    tables,
    text: visibleText(root),
  };
}

/**
 * Which tags gained or lost elements, or - failing that - whether the same
 * elements got re-nested. This is the tier a restructured or malformed
 * fragment lands in when no `data-name` anchors a field-level note.
 * @param {ReturnType<typeof parseStructure>} before
 * @param {ReturnType<typeof parseStructure>} after
 * @returns {Array<string>}
 */
function elementNotes(before, after) {
  const deltas = [];
  for (const tag of new Set([...before.counts.keys(), ...after.counts.keys()])) {
    const b = before.counts.get(tag) || 0;
    const a = after.counts.get(tag) || 0;
    if (b !== a) deltas.push({ tag, b, a, size: Math.abs(a - b) });
  }
  if (deltas.length) {
    deltas.sort((x, y) => y.size - x.size || x.tag.localeCompare(y.tag));
    return [`structure: ${previewSet(deltas.map((d) => `${codeSpan(`<${d.tag}>`)} ${d.b} → ${d.a}`), MAX_TAG_DELTAS_SHOWN)}`];
  }
  if (before.sequence !== after.sequence) return ["element order/nesting changed (tag counts unchanged)"];
  return [];
}

/**
 * Which tables changed row count or row width (a bad colspan, a dropped cell).
 * Reported on its own axis rather than as part of elementNotes: table shape is
 * never explained by a form-field note, so it's worth saying even when the
 * field tier already found something.
 * @param {ReturnType<typeof parseStructure>} before
 * @param {ReturnType<typeof parseStructure>} after
 * @returns {Array<string>}
 */
function tableNotes(before, after, reportCount = false) {
  // Tables are paired by position, which only means anything when the same
  // tables are on both sides - one added or removed in the middle would make
  // every later pair a comparison of two different tables. Say so and compare
  // no further; `reportCount` is for the field-note path, where elementNotes
  // is skipped and nothing else would mention it.
  if (before.tables.length !== after.tables.length) {
    return reportCount ? [`tables: ${before.tables.length} → ${after.tables.length}`] : [];
  }
  const notes = [];
  for (let i = 0; i < before.tables.length; i += 1) {
    const b = before.tables[i];
    const a = after.tables[i];
    if (b.length !== a.length) {
      notes.push(`table ${i + 1}: ${b.length} ${pluralizeWord(b.length, "row")} → ${a.length} ${pluralizeWord(a.length, "row")}`);
    }
    const widths = [];
    for (let row = 0; row < Math.min(b.length, a.length); row += 1) {
      if (b[row] !== a[row]) widths.push(`row ${row + 1} (${b[row]} → ${a[row]})`);
    }
    if (widths.length) notes.push(`table ${i + 1} column span: ${previewSet(widths)}`);
  }
  return notes;
}

/**
 * @param {ReturnType<typeof parseStructure>} before
 * @param {ReturnType<typeof parseStructure>} after
 * @returns {string|null} a note naming the words that appeared/disappeared
 */
function describeTextChange(before, after) {
  if (before.text === after.text) return null;
  const words = (text) => text.split(" ").filter(Boolean);
  const b = words(before.text);
  const a = words(after.text);
  const diff = diffStringSet(b, a);
  // Words come straight out of the render - code-spanned like every other
  // untrusted string this module puts in Markdown.
  if (diff) return `static text: ${formatSetSummary(diff.added.map(codeSpan), diff.removed.map(codeSpan), "word")}`;
  // Same word set: either reordered, or the same words repeated differently.
  const sorted = (list) => [...list].sort().join(" ");
  if (sorted(b) === sorted(a)) return "static text reordered (same words)";
  return `static text: same words, different repeats (${b.length} → ${a.length} words)`;
}

/**
 * Describe what visually changed between two view.html renders, most specific
 * signal first: named form fields, then parsed HTML structure, then static
 * text. Only a diff that survives all three is attribute-only (a class/style
 * tweak) - which is itself a useful thing to be told.
 *
 * Element counts and static text are reported only when no anchored field
 * explains the diff, since otherwise they're a noisier restatement of a
 * finding already made. Table shape is the exception: nothing in the field
 * tier can account for it.
 * @param {string} beforeHtml
 * @param {string} afterHtml
 * @returns {Array<string>}
 */
function describeVisualChange(beforeHtml, afterHtml) {
  const before = parseStructure(normalizeEntryIds(beforeHtml));
  const after = parseStructure(normalizeEntryIds(afterHtml));

  const fieldNotes = describeFieldChanges(before.fields, after.fields);
  if (fieldNotes.length) return [...fieldNotes, ...tableNotes(before, after, true)];

  const notes = [...elementNotes(before, after), ...tableNotes(before, after)];
  if (notes.length) return notes;

  const textNote = describeTextChange(before, after);
  if (textNote) return [textNote];

  return ["attribute/styling-only change - element structure and visible text are identical"];
}

/**
 * Compare an entry's rendered view.html between phases and describe what
 * changed. Returns null when either file is missing (view.html wasn't
 * extracted, or this run predates it) or when they're equivalent, so callers
 * can skip the tier entirely rather than false-flagging.
 * @param {string} resultsDir
 * @param {string} kind
 * @param {string} entryId
 * @returns {{changes: Array<string>}|null}
 */
/**
 * @param {string} filePath
 * @returns {string} a content hash, read in chunks so a file too large to
 *   parse is also never held in memory whole
 */
function fileDigest(filePath) {
  const hash = crypto.createHash("sha1");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const fd = fs.openSync(filePath, "r");
  try {
    let read = fs.readSync(fd, buffer, 0, buffer.length, null);
    while (read > 0) {
      hash.update(buffer.subarray(0, read));
      read = fs.readSync(fd, buffer, 0, buffer.length, null);
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/**
 * @param {string} html
 * @returns {number} unclosed tags, counted per tag name so a stray closing
 *   tag of one kind can't cancel an unclosed one of another. A linear
 *   pre-check: `[^<>]` keeps a `<tag` with no `>` from rescanning the rest,
 *   and the lookahead stops a long tag name backtracking into it.
 */
function unclosedTagCount(html) {
  const open = new Map();
  for (const [, closing, name, selfClosing] of html.matchAll(/<(\/?)([a-zA-Z][\w:-]*)(?![\w:-])[^<>]*?(\/?)>/g)) {
    const tag = name.toLowerCase();
    if (selfClosing || VOID_TAGS.has(tag) || IMPLICITLY_CLOSED_TAGS.has(tag)) continue;
    // Clamped as it goes: a closer with nothing open can't cancel a later opener.
    open.set(tag, Math.max(0, (open.get(tag) || 0) + (closing ? -1 : 1)));
  }
  let total = 0;
  for (const count of open.values()) total += count;
  return total;
}

function describeViewHtmlDiff(resultsDir, kind, entryId) {
  const beforePath = viewHtmlPath(resultsDir, kind, entryId, "before");
  const afterPath = viewHtmlPath(resultsDir, kind, entryId, "after");
  if (!fs.existsSync(beforePath) || !fs.existsSync(afterPath)) return null;

  let beforeHtml;
  let afterHtml;
  try {
    const beforeSize = fs.statSync(beforePath).size;
    const afterSize = fs.statSync(afterPath).size;
    if (beforeSize > MAX_VIEW_HTML_BYTES || afterSize > MAX_VIEW_HTML_BYTES) {
      // Only the parse is too expensive - comparing is not, and an identical
      // pair is never a finding however large it is. Digested rather than
      // read into two strings, and without the id normalization applied
      // below, which can't be done a chunk at a time.
      if (beforeSize === afterSize && fileDigest(beforePath) === fileDigest(afterPath)) return null;
      return { changes: [`${VIEW_HTML_UNPARSED} it is larger than ${MAX_VIEW_HTML_BYTES / (1024 * 1024)} MB`] };
    }
    beforeHtml = normalizeEntryIds(fs.readFileSync(beforePath, "utf8"));
    afterHtml = normalizeEntryIds(fs.readFileSync(afterPath, "utf8"));
  } catch {
    // A --from-zip archive can put anything at this path.
    return null;
  }
  if (beforeHtml === afterHtml) return null;
  if (unclosedTagCount(beforeHtml) > MAX_UNCLOSED_TAGS || unclosedTagCount(afterHtml) > MAX_UNCLOSED_TAGS) {
    return { changes: [`${VIEW_HTML_UNPARSED} it has too many unclosed tags to parse`] };
  }

  try {
    return { changes: describeVisualChange(beforeHtml, afterHtml) };
  } catch {
    // Pathologically nested markup can exhaust the parser's stack - exactly
    // the broken-render case this tier exists for, so it must degrade to a
    // note rather than take every other tier's findings down with it.
    return { changes: [`${VIEW_HTML_UNPARSED} it could not be parsed`] };
  }
}

/**
 * Collapse visual-only entries reporting the identical finding into one
 * group. A single template change lands on every sampled entry of that
 * template, so without this the same block is repeated verbatim once per
 * entry and the reader has to spot by eye that they're all one finding.
 * @param {Array<{kind: string, entryId: string, label: string, url: string|null, changes: Array<string>}>} entries
 * @returns {Array<{label: string, changes: Array<string>, entries: Array<Object>}>}
 */
function groupVisualOnlyEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = `${entry.kind}\x00${entry.label}\x00${entry.changes.join("\x01")}`;
    if (!groups.has(key)) groups.set(key, { label: entry.label, changes: entry.changes, entries: [] });
    groups.get(key).entries.push(entry);
  }
  return [...groups.values()].sort((x, y) => y.entries.length - x.entries.length || x.label.localeCompare(y.label));
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
 *   visualOnlyEntries: Array<{kind: string, entryId: string, label: string, url: string|null, changes: Array<string>}>,
 *   diffEntryKeys: Array<string> - every "kind/entryId" mentioned in any tier above (data,
 *     scope, collapsed/vanished-output, visual-only), sorted. The set of entries a reviewer
 *     would actually want before/after pairs for, as opposed to the (usually much larger)
 *     set of entries sampled but rendered identically.
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

  const diffEntryKeys = new Set();
  for (const bucket of byTemplate.values()) {
    for (const entryKey of bucket.entryIds) diffEntryKeys.add(entryKey);
  }
  for (const bucket of scopeByTemplate.values()) {
    for (const entryKey of bucket.entryIds) diffEntryKeys.add(entryKey);
  }
  for (const bucket of collapsedByTemplate.values()) {
    for (const entryKey of bucket.entryIds) diffEntryKeys.add(entryKey);
  }
  for (const entry of visualOnlyEntries) {
    diffEntryKeys.add(`${entry.kind}/${entry.entryId}`);
  }

  // Grouped here, not at format time, so every consumer of extractCompact()
  // sees the same shape the Markdown does - as the other tiers already do.
  const visualOnlyGroups = groupVisualOnlyEntries(visualOnlyEntries);

  return {
    summary: {
      templatesChanged: templates.length,
      entriesChanged,
      entriesSampled,
      entriesSkipped,
      collapsedCount,
      visualOnlyCount: visualOnlyEntries.length,
      visualOnlyFindings: visualOnlyGroups.length,
    },
    templates,
    scopeTemplates,
    collapsedTemplates,
    visualOnlyEntries,
    visualOnlyGroups,
    diffEntryKeys: [...diffEntryKeys].sort(),
  };
}

/**
 * Validate a URL before it's interpolated into Markdown link syntax.
 *
 * `url` values in this module come from `sample_entry_ids.yml`, which with
 * `--from-zip` is no longer guaranteed to originate from Silverfin's own
 * sampler backend - it's whatever local zip the caller points at. Checking
 * only the scheme isn't enough: a value like
 * `https://trusted.example/a) [injected](https://attacker)` still passes an
 * `^https?://` check but closes the generated `(...)` link early and injects
 * arbitrary Markdown - relevant since this diff is often posted verbatim as
 * a PR/CI comment. Parentheses (the link-destination terminator),
 * whitespace, angle brackets, and control characters are all rejected
 * outright rather than escaped, since a real Silverfin app URL never needs
 * any of them.
 * @param {*} url
 * @returns {string|null} the URL if it's safe to interpolate, else null
 */
function sanitizeUrl(url) {
  if (typeof url !== "string") return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (/[()\s<>]/.test(url)) return null;
  // eslint-disable-next-line no-control-regex -- deliberately scanning for control chars (e.g. line breaks) that could break out of Markdown link syntax.
  if (/[\x00-\x1f]/.test(url)) return null;
  return url;
}

/**
 * Wrap text in a Markdown code span whose delimiter is longer than any
 * backtick run inside it, so the text can't close the span early (with
 * `--from-zip` an entry id is a directory name from an arbitrary local zip)
 * and is still shown unchanged.
 * @param {string} text
 * @returns {string}
 */
function codeSpan(text) {
  // Never empty: a bare "``" would pair with the next span's delimiter on the line.
  const value = String(text).replace(/[\r\n]+/g, " ") || " ";
  let longestRun = 0;
  for (const run of value.match(/`+/g) || []) longestRun = Math.max(longestRun, run.length);
  const fence = "`".repeat(longestRun + 1);
  const pad = /^[` ]|[` ]$/.test(value) && value.trim() ? " " : "";
  return `${fence}${pad}${value}${pad}${fence}`;
}

/**
 * A label from the zip (or an entry id standing in for one) on a single line,
 * so a line break in it can't start a new Markdown block - a code fence
 * included.
 * @param {string} text
 * @returns {string}
 */
function oneLine(text) {
  return String(text).replace(/[\r\n]+/g, " ");
}

/**
 * A markdown link to an example entry: the live app URL when known and
 * safe to link to, else a relative path into the results directory so a
 * reviewer with the zip open locally still has somewhere to look.
 * @param {string|null} url
 * @param {string} entryKey - "kind/entryId"
 * @returns {string}
 */
function exampleRef(url, entryKey) {
  const safeUrl = sanitizeUrl(url);
  return safeUrl ? `([example](${safeUrl}))` : `(${codeSpan(`output/${entryKey}/`)})`;
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
  for (const change of changes.slice(0, activeCaps.changes)) {
    const times = change.count > 1 ? `[${change.count}×] ` : "";
    if (change.subLines !== undefined) {
      lines.push(`- ${times}${codeSpan(change.key)}:`);
      for (const sub of change.subLines) lines.push(`  - ${sub}`);
      continue;
    }
    const body = change.summary !== undefined ? change.summary : `\`${change.before}\` → \`${change.after}\``;
    lines.push(`- ${times}${codeSpan(change.key)}: ${body}`);
  }
  if (changes.length > activeCaps.changes) {
    lines.push(`- … +${changes.length - activeCaps.changes} more change${changes.length - activeCaps.changes === 1 ? "" : "s"}`);
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
function renderCompactAtActiveCaps(data) {
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

  // Worded as data-diff (named_results/results) specific, and only shown as
  // a "N template(s) changed" count when that tier actually has findings -
  // otherwise a run whose only changes are in the collapsed/scope/visual
  // tiers would print a contradictory "0 template(s) changed across 0
  // entries" line directly above sections that clearly do report changes.
  if (templates.length > 0) {
    const headline = [`**${summary.templatesChanged}** template(s) changed across **${summary.entriesChanged}** ${pluralizeWord(summary.entriesChanged, "entry")} in named_results/results`];
    headline.push(`(${summary.entriesSampled} sampled${skippedNote})`);
    lines.push(headline.join(" "));
  } else {
    lines.push(`No named_results/results changes (${summary.entriesSampled} sampled${skippedNote}) - see other tiers below.`);
  }

  if (collapsedTemplates.length > 0) {
    lines.push("");
    lines.push(`### ⚠️ Output vanished (${summary.collapsedCount} ${pluralizeWord(summary.collapsedCount, "entry")} across ${collapsedTemplates.length} template(s))`);
    lines.push("Rendered output that existed before is completely gone after - check for a broken include/tag, not a data change.");
    for (const template of collapsedTemplates) {
      lines.push("");
      const ref = exampleRef(template.exampleUrl, template.exampleEntryKey);
      lines.push(`**${oneLine(template.label)}** — ${template.entriesChanged} ${pluralizeWord(template.entriesChanged, "entry")} collapsed ${ref}`);
      lines.push(...formatChangeLines(template.changes));
    }
  }

  for (const template of templates) {
    lines.push("");
    const ref = exampleRef(template.exampleUrl, template.exampleEntryKey);
    lines.push(`### ${oneLine(template.label)} — ${template.entriesChanged} ${pluralizeWord(template.entriesChanged, "entry")} changed ${ref}`);
    lines.push(...formatChangeLines(template.changes));
  }

  if (scopeTemplates.length > 0) {
    lines.push("");
    lines.push("### 🔧 Scope/dependency changes");
    lines.push("What each template depends on/requires changed - not its rendered data.");
    for (const template of scopeTemplates) {
      lines.push("");
      const ref = exampleRef(template.exampleUrl, template.exampleEntryKey);
      lines.push(`**${oneLine(template.label)}** — ${template.entriesChanged} ${pluralizeWord(template.entriesChanged, "entry")} ${ref}`);
      lines.push(...formatChangeLines(template.changes));
    }
  }

  if (visualOnlyEntries.length > 0) {
    const groups = data.visualOnlyGroups || groupVisualOnlyEntries(visualOnlyEntries);
    lines.push("");
    lines.push(
      `### 👁️ Visual-only changes (${visualOnlyEntries.length} ${pluralizeWord(visualOnlyEntries.length, "entry")}, ` +
        `${groups.length} distinct ${pluralizeWord(groups.length, "finding")}, data unchanged)`
    );
    lines.push("`view.html` differs even though named_results/results didn't - a markup/layout change the data diff can't see.");
    for (const group of groups.slice(0, activeCaps.visualGroups)) {
      lines.push("");
      const first = group.entries[0];
      const entryKey = `${first.kind}/${first.entryId}`;
      const safeUrl = sanitizeUrl(first.url);
      const ref = safeUrl ? `[open in app](${safeUrl}) · ` : "";
      const shared =
        group.entries.length > 1 ? `${group.entries.length} entries, ${group.changes.length} shared ${pluralizeWord(group.changes.length, "change")} · ` : "";
      lines.push(`**${codeSpan(group.label)}** — ${shared}${ref}${codeSpan(`output/${entryKey}/{before,after}/view.html`)}`);
      for (const note of group.changes.slice(0, activeCaps.visualChanges)) {
        lines.push(`- ${note}`);
      }
      if (group.changes.length > activeCaps.visualChanges) {
        const hidden = group.changes.length - activeCaps.visualChanges;
        lines.push(`- … +${hidden} more change${hidden === 1 ? "" : "s"}`);
      }
      if (group.entries.length > 1) {
        lines.push(`- entries: ${previewList(group.entries.map((entry) => codeSpan(entry.entryId)), activeCaps.visualEntries)}`);
      }
    }
    if (groups.length > activeCaps.visualGroups) {
      const hiddenGroups = groups.length - activeCaps.visualGroups;
      const hiddenEntries = groups.slice(activeCaps.visualGroups).reduce((sum, group) => sum + group.entries.length, 0);
      lines.push("");
      lines.push(`… +${hiddenGroups} more visual-only ${pluralizeWord(hiddenGroups, "finding")} (${hiddenEntries} ${pluralizeWord(hiddenEntries, "entry")}) not shown`);
    }
  }

  return lines.join("\n");
}

/**
 * Format the compact diff, showing as much detail as the comment budget allows.
 *
 * Renders at the loosest cap tier first and only tightens if the result would
 * not fit, so a normal run discloses every finding instead of stopping at a
 * fixed count. The tightest tier is returned even if it still overflows: a
 * too-long diff is the caller's to trim, and silently emitting nothing would be
 * worse than emitting something oversized.
 * @param {ReturnType<typeof extractCompact>} data
 * @param {{budget?: number}} [options] - budget in characters; defaults to
 *   COMMENT_BUDGET_CHARS. Pass a small value to force tighter tiers in tests.
 * @returns {string}
 */
function formatCompact(data, options = {}) {
  const budget = options.budget === undefined ? COMMENT_BUDGET_CHARS : options.budget;
  const previous = activeCaps;
  try {
    let rendered = "";
    for (const tier of CAP_TIERS) {
      activeCaps = tier;
      rendered = renderCompactAtActiveCaps(data);
      if (rendered.length <= budget) return rendered;
    }
    // Every tier overflowed - return the tightest rather than nothing.
    return rendered;
  } finally {
    activeCaps = previous;
  }
}

module.exports = {
  extractCompact,
  formatCompact,
  diffNamedResults,
  diffResultsRegister,
  diffScope,
  describeVisualChange,
  groupVisualOnlyEntries,
  readEntryLabels,
};
