const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  extractCompact,
  formatCompact,
  diffNamedResults,
  diffResultsRegister,
  diffScope,
  describeVisualChange,
  groupVisualOnlyEntries,
  readEntryLabels,
} = require("../../lib/liquidSamplerCompact");

const FIXTURE_DIR = path.join(__dirname, "..", "fixtures", "sampler-results");

/**
 * Build a results directory (sample_entry_ids.yml + output/) under a fresh
 * temp dir, from a plain description of entries per kind. Each entry accepts
 * `before`/`after` (named_results), plus optional `registers` overrides
 * (results/dependencies/rollforward_params/required_keys_missing, merged in
 * per phase) and `viewHtml` (raw content per phase).
 * @param {Object<string, Array<{
 *   id: string, label: string, before: Object, after: Object,
 *   registers?: {before?: Object, after?: Object},
 *   viewHtml?: {before?: string, after?: string}
 * }>>} byKind
 * @returns {string} path to the built results directory
 */
function buildResultsDir(byKind) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sampler-compact-test-"));
  const yml = {};
  for (const [kind, entries] of Object.entries(byKind)) {
    yml[kind] = {};
    for (const entry of entries) {
      yml[kind][entry.id] = { label: entry.label, url: entry.url ?? null };
      for (const phase of ["before", "after"]) {
        const entryDir = path.join(dir, "output", kind, entry.id, phase);
        fs.mkdirSync(entryDir, { recursive: true });
        const registers = { named_results: entry[phase], ...(entry.registers && entry.registers[phase]) };
        fs.writeFileSync(path.join(entryDir, "registers.json"), JSON.stringify(registers));
        if (entry.viewHtml && entry.viewHtml[phase] !== undefined) {
          fs.writeFileSync(path.join(entryDir, "view.html"), entry.viewHtml[phase]);
        }
      }
    }
  }
  fs.writeFileSync(path.join(dir, "sample_entry_ids.yml"), JSON.stringify(yml));
  return dir;
}

describe("liquidSamplerCompact - diffNamedResults", () => {
  it("reports a changed value", () => {
    expect(diffNamedResults({ a: "" }, { a: null })).toEqual([{ key: "a", before: '""', after: "null" }]);
  });

  it("distinguishes an explicit null from an absent (removed) key", () => {
    // key present with null -> key removed entirely (broken template)
    expect(diffNamedResults({ a: null }, {})).toEqual([{ key: "a", before: "null", after: "undefined" }]);
    // an added key
    expect(diffNamedResults({}, { a: 1 })).toEqual([{ key: "a", before: "undefined", after: "1" }]);
  });

  it("returns nothing when unchanged", () => {
    expect(diffNamedResults({ a: "42.0", b: null }, { a: "42.0", b: null })).toEqual([]);
  });

  it("sorts changes by key", () => {
    const changes = diffNamedResults({ z: 1, a: 1 }, { z: 2, a: 2 });
    expect(changes.map((c) => c.key)).toEqual(["a", "z"]);
  });

  it("ignores object key-order differences that don't change content", () => {
    const changes = diffNamedResults({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } });
    expect(changes).toEqual([]);
  });

  it("still reports a real change to a nested object value", () => {
    const changes = diffNamedResults({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 99 } });
    expect(changes.map((c) => c.key)).toEqual(["a"]);
  });

  it("still treats array element reordering as a real change", () => {
    const changes = diffNamedResults({ a: [1, 2] }, { a: [2, 1] });
    expect(changes.map((c) => c.key)).toEqual(["a"]);
  });

  it("truncates long values instead of printing them in full", () => {
    const longText = "x".repeat(500);
    const changes = diffNamedResults({ a: longText }, { a: "short" });
    expect(changes[0].before).toMatch(/^"x+…\(502 chars, #[0-9a-f]{8}\)$/);
    expect(changes[0].before.length).toBeLessThan(140);
  });

  it("gives distinct truncated values a distinct dedup fingerprint, even with the same prefix and length", () => {
    // Same first 100 chars (JSON quote + 99 "x"s) and same total length (502),
    // but genuinely different content - must not render identically, since
    // the rendered string doubles as the cross-entry dedup key.
    const longA = "x".repeat(499) + "A";
    const longB = "x".repeat(499) + "B";
    const changesA = diffNamedResults({ a: longA }, { a: "short" });
    const changesB = diffNamedResults({ a: longB }, { a: "short" });
    expect(changesA[0].before).not.toBe(changesB[0].before);
  });
});

describe("liquidSamplerCompact - diffResultsRegister", () => {
  it("returns null when unchanged", () => {
    expect(diffResultsRegister(["1.0"], ["1.0"])).toBeNull();
    expect(diffResultsRegister(null, null)).toBeNull();
    expect(diffResultsRegister(undefined, null)).toBeNull();
  });

  it("formats an all-0/1 array as a triggered count", () => {
    expect(diffResultsRegister(["1.0"], ["0.0"])).toEqual({ before: "1/1 triggered", after: "0/1 triggered" });
    expect(diffResultsRegister(["0.0", "0.0"], ["1.0", "0.0"])).toEqual({ before: "0/2 triggered", after: "1/2 triggered" });
  });

  it("names which indices turned on/off when a flag-array reorder keeps the same triggered count", () => {
    // Same 1/2 triggered on both sides - the suffix goes on `after` only, so
    // the line reads "1/2 triggered -> 1/2 triggered (0 off, 1 on)" instead
    // of an identical-looking string on both sides.
    const diff = diffResultsRegister(["1.0", "0.0"], ["0.0", "1.0"]);
    expect(diff.before).toBe("1/2 triggered");
    expect(diff.after).toBe("1/2 triggered (0 off, 1 on)");
  });

  it("does not dedupe two entries whose flag-array reorders flip different indices into one change", () => {
    const a = diffResultsRegister(["1.0", "0.0", "0.0", "0.0"], ["0.0", "1.0", "0.0", "0.0"]);
    const b = diffResultsRegister(["0.0", "0.0", "1.0", "0.0"], ["0.0", "0.0", "0.0", "1.0"]);
    expect(a).not.toEqual(b);
  });

  it("does not dedupe two entries with opposite same-index reorders (naming direction, not just position)", () => {
    // Both touch indices 0 and 1 - a position-only suffix (e.g. "indices
    // 0,1 flipped") would render identically for both directions and still
    // collapse them into one deduped change.
    const a = diffResultsRegister(["1.0", "0.0"], ["0.0", "1.0"]);
    const b = diffResultsRegister(["0.0", "1.0"], ["1.0", "0.0"]);
    expect(a).not.toEqual(b);
  });

  it("caps the flip suffix and fingerprints the elided flips, so two long vectors don't collapse", () => {
    const before = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? "1.0" : "0.0"));
    const afterA = before.map((v, i) => (i < 10 ? (v === "1.0" ? "0.0" : "1.0") : v));
    const afterB = before.map((v, i) => (i >= 10 ? (v === "1.0" ? "0.0" : "1.0") : v));

    const diffA = diffResultsRegister(before, afterA);
    const diffB = diffResultsRegister(before, afterB);

    expect(diffA.after.length).toBeLessThan(100);
    expect(diffA).not.toEqual(diffB);
  });

  it("falls back to the raw value for non-flag (raw numeric) results arrays", () => {
    const diff = diffResultsRegister(["996.08", "0.0"], ["996.08", "27171.4"]);
    expect(diff.before).toBe('["996.08","0.0"]');
    expect(diff.after).toBe('["996.08","27171.4"]');
  });

  it("renders an explicit null distinctly from a genuinely absent (undefined) register", () => {
    // Both are treated as equivalent to "no results" for the unchanged-check
    // above, but once a change IS detected, the two must not display
    // identically - `results: null` is a real distinction from the register
    // being fully absent, and the "output vanished" collapse heuristic in
    // extractCompact keys off this exact rendered string.
    expect(diffResultsRegister(["1.0"], null)).toEqual({ before: "1/1 triggered", after: "null" });
    expect(diffResultsRegister(["1.0"], undefined)).toEqual({ before: "1/1 triggered", after: "undefined" });
  });
});

describe("liquidSamplerCompact - diffScope", () => {
  it("returns nothing when dependencies/rollforward_params/required_keys_missing are unchanged", () => {
    const registers = {
      dependencies: { ledgers: [1], reconciliations: { handles_per_ledger: { 1: ["general_settings"] } } },
      rollforward_params: [{ name: "a" }],
      required_keys_missing: ["x"],
    };
    expect(diffScope(registers, registers)).toEqual([]);
  });

  it("summarizes dependency changes as one sub-line per category (ledgers/handles/...), not a semicolon-packed dump", () => {
    const before = { dependencies: { ledgers: [1, 2], reconciliations: { handles_per_ledger: { 1: ["a", "b"], 2: ["c"] } } } };
    const after = { dependencies: { reconciliations: { handles_per_ledger: { 1: ["a"] } } } };
    const [change] = diffScope(before, after);
    expect(change.key).toBe("dependencies");
    expect(change.subLines).toHaveLength(2);
    expect(change.subLines[0]).toBe("−1 ledger (2)");
    expect(change.subLines[1]).toContain("handle");
    expect(change.subLines[1]).toContain("b");
    expect(change.subLines[1]).toContain("c");
  });

  it("does not throw when `dependencies.ledgers` or `.account_ranges` is malformed (not an array)", () => {
    // A single entry with a malformed register value shouldn't abort the
    // whole run's diff (`.map` isn't a function on a string/number/object) -
    // it should be treated the same as the value being absent.
    const before = { dependencies: { ledgers: "not-an-array", account_ranges: 42 } };
    const after = { dependencies: { ledgers: [1, 2], account_ranges: ["60"] } };
    expect(() => diffScope(before, after)).not.toThrow();
    const [change] = diffScope(before, after);
    expect(change.key).toBe("dependencies");
    expect(change.subLines.join(" ")).toContain("+2 ledgers (1, 2)");
    expect(change.subLines.join(" ")).toContain('+1 account range (60)');
  });

  it("summarizes rollforward_params by name", () => {
    const before = { rollforward_params: [{ name: "selected.size_company" }, { name: "deposit_layout.dropdown" }] };
    const after = { rollforward_params: [{ name: "selected.size_company" }, { name: "show_prev_year_balance.presentation" }] };
    const [change] = diffScope(before, after);
    expect(change.key).toBe("rollforward_params");
    expect(change.summary).toBe("−1 param (deposit_layout.dropdown), +1 param (show_prev_year_balance.presentation)");
  });

  it("summarizes required_keys_missing as added/removed keys", () => {
    const before = { required_keys_missing: ["letter_of_representation.date"] };
    const after = { required_keys_missing: ["letter_of_representation.date", "report.period", "statements.signed"] };
    const [change] = diffScope(before, after);
    expect(change.key).toBe("required_keys_missing");
    expect(change.summary).toBe("+2 keys (report.period, statements.signed)");
  });

  it("caps preview lists and discloses the remainder", () => {
    const before = { required_keys_missing: [] };
    const after = { required_keys_missing: ["a", "b", "c", "d", "e"] };
    const [change] = diffScope(before, after);
    expect(change.summary).toBe("+5 keys (a, b, c +2 more)");
  });
});

describe("liquidSamplerCompact - describeVisualChange", () => {
  const field = (name, attrs, value) =>
    `<td><textarea data-name="${name}" data-object-type="ReconciliationText" ${attrs}>${value}</textarea></td>`;

  it("reports a removed field when a data-name'd tag disappears entirely", () => {
    const before = field("salutation.address", 'placeholder="Begroeting"', "Aan het bestuur van:");
    const after = `<td class="usr-width-76">&nbsp;</td><td></td>`;
    const notes = describeVisualChange(before, after);
    expect(notes).toEqual(["field `salutation.address` removed"]);
  });

  it("reports an added field the same way, symmetrically", () => {
    const before = `<td></td>`;
    const after = field("salutation.address", 'placeholder="Begroeting"', "Aan het bestuur van:");
    const notes = describeVisualChange(before, after);
    expect(notes).toEqual(["field `salutation.address` added"]);
  });

  it("reports a placeholder change on an otherwise-unchanged field (the real ac_policies_BS case)", () => {
    const before = field("salutation.header", 'placeholder=""', "Geacht bestuur,");
    const after = field("salutation.header", 'placeholder="Geacht bestuur,"', "Geacht bestuur,");
    const notes = describeVisualChange(before, after);
    expect(notes).toEqual(['field `salutation.header` placeholder: "" → "Geacht bestuur,"']);
  });

  it("reports a value change on a field whose placeholder didn't change", () => {
    const before = field("company_city", 'placeholder=""', "Amsterdam");
    const after = field("company_city", 'placeholder=""', "Rotterdam");
    const notes = describeVisualChange(before, after);
    expect(notes).toEqual(['field `company_city` value: "Amsterdam" → "Rotterdam"']);
  });

  it("reports both a value and a placeholder change as two separate notes", () => {
    const before = field("x", 'placeholder="old hint"', "old value");
    const after = field("x", 'placeholder="new hint"', "new value");
    const notes = describeVisualChange(before, after);
    expect(notes).toEqual(['field `x` value: "old value" → "new value"', 'field `x` placeholder: "old hint" → "new hint"']);
  });

  it("names the changed words when no anchored field explains the diff", () => {
    const notes = describeVisualChange("<div>old layout</div>", "<div class=\"new\">new layout</div>");
    expect(notes).toEqual(["static text: −1 word (`old`), +1 word (`new`)"]);
  });

  it("says nothing about fields that are identical in both", () => {
    const before = field("unchanged", 'placeholder="p"', "v") + field("changed", "", "old");
    const after = field("unchanged", 'placeholder="p"', "v") + field("changed", "", "new");
    const notes = describeVisualChange(before, after);
    expect(notes).toEqual(['field `changed` value: "old" → "new"']);
  });

  it("decodes HTML entities in an <input> value, consistently with the <textarea>/<select> branches", () => {
    const before = `<input data-name="company_name" value="Foo &amp; Bar" />`;
    const after = `<input data-name="company_name" value="Foo &amp; Baz" />`;
    const notes = describeVisualChange(before, after);
    expect(notes).toEqual(['field `company_name` value: "Foo & Bar" → "Foo & Baz"']);
  });

  it("reports a changed radio-group selection by which option is checked, not the last input in the group", () => {
    const radioGroup = (checkedValue) =>
      `<input type="radio" data-name="filing_type" value="vol" ${checkedValue === "vol" ? "checked" : ""} />` +
      `<input type="radio" data-name="filing_type" value="vkt" ${checkedValue === "vkt" ? "checked" : ""} />`;
    const notes = describeVisualChange(radioGroup("vol"), radioGroup("vkt"));
    expect(notes).toEqual(['field `filing_type` value: "vol" → "vkt"']);
  });

  it("does not mistake aria-checked for checked (which would make every radio look selected)", () => {
    const radioGroup = (selectedValue) =>
      `<input data-type="radio" type="radio" data-name="filing_type" value="vol" aria-checked="${selectedValue === "vol"}" ${
        selectedValue === "vol" ? "checked" : ""
      } />` +
      `<input data-type="radio" type="radio" data-name="filing_type" value="vkt" aria-checked="${selectedValue === "vkt"}" ${
        selectedValue === "vkt" ? "checked" : ""
      } />`;
    const notes = describeVisualChange(radioGroup("vol"), radioGroup("vkt"));
    expect(notes).toEqual(['field `filing_type` value: "vol" → "vkt"']);
  });
});

describe("liquidSamplerCompact - describeVisualChange, option sets", () => {
  const select = (opts) => `<select data-name="fuel_type">${opts.map((o) => `<option value="${o}">${o}</option>`).join("")}</select>`;
  const ALL_FUELS = ["petrol", "diesel", "electric", "hybrid", "lpg", "cng", "hydrogen", "other"];

  it("reports a <select> that lost its option list even though nothing is selected either side", () => {
    // The confirmed real-world miss: a renamed variable emptied a fleet
    // template's fuel-type dropdown. `selected` was null -> null, so the
    // selected-value projection alone showed nothing at all.
    const notes = describeVisualChange(select(ALL_FUELS), select(["petrol"]));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("field `fuel_type` options: 8 → 1");
    expect(notes[0]).toContain("lost: `cng`");
  });

  it("reports a <select> that lost every option", () => {
    const notes = describeVisualChange(select(ALL_FUELS), '<select data-name="fuel_type"></select>');
    expect(notes[0]).toContain("field `fuel_type` options: 8 → 0");
  });

  it("reports added options too, not just lost ones", () => {
    const notes = describeVisualChange(select(["petrol"]), select(["petrol", "diesel"]));
    expect(notes).toEqual(["field `fuel_type` options: 1 → 2 (added: `diesel`)"]);
  });

  it("says nothing about an unchanged option list", () => {
    expect(describeVisualChange(select(ALL_FUELS), select(ALL_FUELS))).toEqual([
      "attribute/styling-only change - element structure and visible text are identical",
    ]);
  });

  it("reports both the selected value and the option set when both changed", () => {
    const withSelected = (opts, chosen) =>
      `<select data-name="fuel_type">${opts.map((o) => `<option value="${o}"${o === chosen ? " selected" : ""}>${o}</option>`).join("")}</select>`;
    const notes = describeVisualChange(withSelected(["petrol", "diesel"], "diesel"), withSelected(["petrol"], "petrol"));
    expect(notes).toEqual(['field `fuel_type` value: "diesel" → "petrol"', "field `fuel_type` options: 2 → 1 (lost: `diesel`)"]);
  });

  it("reports a radio group that lost options even though the checked value is unchanged", () => {
    // Same scalar-projection bug as <select>: `checked` is one option out of
    // a group, so shrinking the group is invisible if the checked one survives.
    const radios = (values, checked) =>
      values.map((v) => `<input type="radio" data-name="size" value="${v}" ${v === checked ? "checked" : ""} />`).join("");
    const notes = describeVisualChange(radios(["micro", "small", "large"], "small"), radios(["small"], "small"));
    expect(notes).toEqual(["field `size` options: 3 → 1 (lost: `large`, `micro`)"]);
  });
});

describe("liquidSamplerCompact - describeVisualChange, structural parsing", () => {
  it("describes a dropped table cell instead of waving at the two view.html files", () => {
    const before = "<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>";
    const after = "<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>";
    const notes = describeVisualChange(before, after);
    expect(notes.join(" ")).toContain("`<td>` 4 → 3");
    expect(notes.join(" ")).toContain("table 1 column span: row 2 (2 → 1)");
    expect(notes.join(" ")).not.toContain("compare the two view.html files");
  });

  it("describes a colspan change that silently widens a row", () => {
    const before = '<table><tr><td colspan="2">a</td><td>b</td></tr></table>';
    const after = '<table><tr><td colspan="4">a</td><td>b</td></tr></table>';
    expect(describeVisualChange(before, after)).toEqual(["table 1 column span: row 1 (3 → 5)"]);
  });

  it("describes an added table row", () => {
    const before = "<table><tr><td>a</td></tr></table>";
    const after = "<table><tr><td>a</td></tr><tr><td>b</td></tr></table>";
    expect(describeVisualChange(before, after).join(" ")).toContain("table 1: 1 row → 2 rows");
  });

  it("describes a dropped closing tag (the table no longer parses as a table)", () => {
    const before = "<div><table><tr><td>a</td></tr></table><p>after</p></div>";
    const after = "<div><table><tr><td>a</td></tr><p>after</p></div>";
    expect(describeVisualChange(before, after).join(" ")).toContain("`<table>` 1 → 0");
  });

  it("calls a class-only change styling, rather than an unexplained layout change", () => {
    const before = '<div class="usr-width-50"><span>Total</span></div>';
    const after = '<div class="usr-width-76"><span>Total</span></div>';
    expect(describeVisualChange(before, after)).toEqual([
      "attribute/styling-only change - element structure and visible text are identical",
    ]);
  });

  it("flags a re-nesting that keeps every tag count identical", () => {
    const before = "<div><b><i>x</i></b></div>";
    const after = "<div><i><b>x</b></i></div>";
    expect(describeVisualChange(before, after)).toEqual(["element order/nesting changed (tag counts unchanged)"]);
  });

  it("doesn't throw when a radio input shares its data-name with another field type", () => {
    // One thrown error here aborts the compact diff for every sampled entry
    // in the run, not just this one.
    const html = (value) => `<textarea data-name="x">${value}</textarea><input type="radio" data-name="x" value="1" checked />`;
    expect(() => describeVisualChange(html("a"), html("b"))).not.toThrow();
  });

  it("doesn't compare two unrelated tables when a table was added or removed", () => {
    const before = "<table><tr><td>a</td><td>b</td></tr></table><table><tr><td>c</td></tr></table>";
    const after = "<table><tr><td>c</td></tr></table>";
    const notes = describeVisualChange(before, after).join(" ");
    expect(notes).toContain("tables: 2 → 1");
    // The surviving table is unchanged - pairing it with the dropped one by
    // position would invent a row/colspan delta that isn't there.
    expect(notes).not.toContain("column span");
    expect(notes).not.toContain("rows");
  });

  it("reports an added or removed table even on the field-note path", () => {
    // elementNotes is skipped once a field explains the diff, so tableNotes is
    // the only thing that can still say a whole table appeared.
    const before = '<textarea data-name="n">a</textarea>';
    const after = '<textarea data-name="n">b</textarea><table><tr><td>x</td></tr></table>';
    expect(describeVisualChange(before, after)).toEqual(['field `n` value: "a" → "b"', "tables: 0 → 1"]);
  });

  it("treats a checkbox group like a radio group, not as last-input-wins", () => {
    const boxes = (values) => values.map((v) => `<input type="checkbox" data-name="opts" value="${v}" />`).join("");
    expect(describeVisualChange(boxes(["a", "b", "c"]), boxes(["a"]))).toEqual(["field `opts` options: 3 → 1 (lost: `b`, `c`)"]);
  });

  it("doesn't let a hidden companion input discard the radio group's option list", () => {
    const group = (values) =>
      values.map((v) => `<input type="radio" data-name="size" value="${v}" />`).join("") + '<input type="hidden" data-name="size" value="x" />';
    expect(describeVisualChange(group(["s", "m", "l"]), group(["s"]))).toEqual(["field `size` options: 3 → 1 (lost: `l`, `m`)"]);
  });

  it("reports a field that changed element type", () => {
    const before = '<select data-name="x"><option selected>a</option></select>';
    const after = '<input data-name="x" value="a" />';
    expect(describeVisualChange(before, after).join(" ")).toContain("field `x` element: `<select>` → `<input>`");
  });

  it("normalizes a non-breaking space in a field value, as the regex path did", () => {
    // Otherwise swapping `&nbsp;` for a literal space renders as
    // `value: "a b" → "a b"` - two strings a reader can't tell apart.
    const notes = describeVisualChange('<textarea data-name="x">a&nbsp;b</textarea>', '<textarea data-name="x">a b</textarea>');
    expect(notes).toEqual(["attribute/styling-only change - element structure and visible text are identical"]);
  });

  it("ignores <style>/<script> contents when diffing static text", () => {
    const before = "<div><style>.a{color:red}</style><span>Total</span></div>";
    const after = "<div><style>.a{color:blue}</style><span>Total</span></div>";
    expect(describeVisualChange(before, after)).toEqual([
      "attribute/styling-only change - element structure and visible text are identical",
    ]);
  });

  it("doesn't run adjacent inline elements together into one word", () => {
    const before = "<div><span>Total</span><span>Amount</span></div>";
    const after = "<div><span>Totaal</span><span>Amount</span></div>";
    expect(describeVisualChange(before, after)).toEqual(["static text: −1 word (`Total`), +1 word (`Totaal`)"]);
  });

  it("keeps option labels and static-text words inside a code span they can't close", () => {
    const select = (label) => `<select data-name="x"><option>keep</option><option>${label}</option></select>`;
    const notes = describeVisualChange(select("a"), select("[l](http://evil)`b"));
    // The label survives, minus the backtick that would have closed the span
    // and let `[l](...)` render as a live link in the posted comment.
    expect(notes.join(" ")).toContain("`[l](http://evil)b`");
    expect(notes.join(" ")).not.toContain("evil)`b");
  });

  it("distinguishes reordered text from text whose words changed in number", () => {
    expect(describeVisualChange("<td>a b</td>", "<td>b a</td>")).toEqual(["static text reordered (same words)"]);
    expect(describeVisualChange("<td>a a b</td>", "<td>a b b</td>")).toEqual([
      "static text: same words, different repeats (3 → 3 words)",
    ]);
  });

  it("still reports a table shape change when an anchored field also changed", () => {
    // Table shape is a separate axis - a field-level note can never account
    // for a lost column, so the two must not be mutually exclusive.
    const before = '<table><tr><td><textarea data-name="note">old</textarea></td><td>x</td></tr></table>';
    const after = '<table><tr><td><textarea data-name="note">new</textarea></td></tr></table>';
    expect(describeVisualChange(before, after)).toEqual([
      'field `note` value: "old" → "new"',
      "table 1 column span: row 1 (2 → 1)",
    ]);
  });

  it("ignores per-entry object ids, which differ between renders without being a visual change", () => {
    const before = '<td data-object-id="9001" data-object-ledger-id="70"><span>x</span></td>';
    const after = '<td data-object-id="9002" data-object-ledger-id="71"><span>x</span></td>';
    expect(describeVisualChange(before, after)).toEqual([
      "attribute/styling-only change - element structure and visible text are identical",
    ]);
  });
});

describe("liquidSamplerCompact - groupVisualOnlyEntries", () => {
  const entry = (entryId, changes, label = "wagenpark") => ({ kind: "reconciliation_entries", entryId, label, url: null, changes });

  it("collapses entries of the same template reporting the identical finding", () => {
    const changes = ["`<td>` 4 → 3"];
    const groups = groupVisualOnlyEntries([entry("1", changes), entry("2", changes), entry("3", changes)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ label: "wagenpark", changes });
    expect(groups[0].entries.map((e) => e.entryId)).toEqual(["1", "2", "3"]);
  });

  it("keeps genuinely different findings apart, and different templates apart", () => {
    const groups = groupVisualOnlyEntries([
      entry("1", ["a"]),
      entry("2", ["b"]),
      entry("3", ["a"], "other_tpl"),
    ]);
    expect(groups).toHaveLength(3);
  });

  it("orders groups by how many entries share the finding", () => {
    const groups = groupVisualOnlyEntries([entry("1", ["rare"]), entry("2", ["common"]), entry("3", ["common"])]);
    expect(groups[0].changes).toEqual(["common"]);
    expect(groups[0].entries).toHaveLength(2);
  });
});

describe("liquidSamplerCompact - readEntryLabels", () => {
  it("maps kind/entry id to template labels for both entry kinds", () => {
    const labels = readEntryLabels(FIXTURE_DIR);
    expect(labels["reconciliation_entries/1_100_1000_5000"].label).toBe("vkt_1");
    expect(labels["account_entries/1_103_1003_490000.000"].label).toBe("some_account_template");
  });

  it("keeps account and reconciliation entries separate when their raw ids match", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sampler-compact-test-"));
    fs.writeFileSync(
      path.join(dir, "sample_entry_ids.yml"),
      JSON.stringify({
        account_entries: { 5000: { label: "account_tpl", url: null } },
        reconciliation_entries: { 5000: { label: "reco_tpl", url: null } },
      }),
    );
    try {
      const labels = readEntryLabels(dir);
      expect(labels["account_entries/5000"].label).toBe("account_tpl");
      expect(labels["reconciliation_entries/5000"].label).toBe("reco_tpl");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty map when the yml is missing", () => {
    expect(readEntryLabels(path.join(__dirname, "does-not-exist"))).toEqual({});
  });
});

describe("liquidSamplerCompact - extractCompact", () => {
  let data;
  beforeAll(() => {
    data = extractCompact(FIXTURE_DIR);
  });

  it("counts all sampled entries, including unchanged ones", () => {
    expect(data.summary.entriesSampled).toBe(4);
  });

  it("only reports templates with named_results changes", () => {
    const labels = data.templates.map((t) => t.label);
    expect(labels).toContain("vkt_1");
    expect(labels).toContain("liquidation_reserve");
    // the account template was unchanged - it must not appear
    expect(labels).not.toContain("some_account_template");
    expect(data.summary.templatesChanged).toBe(2);
  });

  it("orders templates by number of changed entries (desc)", () => {
    expect(data.templates[0].label).toBe("vkt_1"); // 2 entries
    expect(data.templates[0].entriesChanged).toBe(2);
  });

  it("dedupes identical changes across entries with a count", () => {
    const vkt = data.templates.find((t) => t.label === "vkt_1");
    const streetChange = vkt.changes.find((c) => c.key === "street_var");
    expect(streetChange).toEqual({ key: "street_var", before: '""', after: "null", count: 2 });
  });

  it("surfaces a broken template (value -> removed) as undefined when below the collapse threshold", () => {
    const liq = data.templates.find((t) => t.label === "liquidation_reserve");
    const change = liq.changes.find((c) => c.key === "distributable_at_5");
    expect(change.before).toBe('"20615.89"');
    expect(change.after).toBe("undefined");
    // Only 1 key lost - not enough to call it a collapse.
    expect(data.collapsedTemplates).toEqual([]);
  });

  it("attaches an example URL to each template for follow-up", () => {
    const vkt = data.templates.find((t) => t.label === "vkt_1");
    expect(vkt.exampleUrl).toMatch(/^https:\/\/example\.staging\.getsilverfin\.com/);
  });

  it("collects every flagged entry's kind/entryId into diffEntryKeys, excluding unchanged entries", () => {
    expect(data.diffEntryKeys).toEqual([
      "reconciliation_entries/1_100_1000_5000",
      "reconciliation_entries/1_101_1001_5000",
      "reconciliation_entries/1_102_1002_6000",
    ]);
    // the unchanged account entry must not appear
    expect(data.diffEntryKeys).not.toContain("account_entries/1_103_1003_490000.000");
  });

  it("falls back to raw entry id when labels are missing", () => {
    // point at a dir with entries but no sample_entry_ids.yml -> label = entry id.
    // Reuse the fixture output dir but from a path without the yml alongside.
    const noLabels = extractCompact(path.join(FIXTURE_DIR, "..", "sampler-results-no-such"));
    expect(noLabels.templates).toEqual([]);
  });

  it("keeps an account entry and a reconciliation entry with the same raw id separate", () => {
    const dir = buildResultsDir({
      account_entries: [{ id: "5000", label: "account_tpl", before: { a: "1" }, after: { a: "2" } }],
      reconciliation_entries: [{ id: "5000", label: "reco_tpl", before: { b: "1" }, after: { b: "2" } }],
    });
    try {
      const data = extractCompact(dir);
      const labels = data.templates.map((t) => t.label).sort();
      expect(labels).toEqual(["account_tpl", "reco_tpl"]);
      expect(data.summary.entriesChanged).toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("doesn't merge an account entry and a reconciliation entry that share the same label", () => {
    const dir = buildResultsDir({
      account_entries: [{ id: "5000", label: "shared_label", before: { a: "1" }, after: { a: "2" } }],
      reconciliation_entries: [{ id: "6000", label: "shared_label", before: { b: "1" }, after: { b: "2" } }],
    });
    try {
      const data = extractCompact(dir);
      // Two distinct templates (one per kind), not one merged "shared_label"
      // entry combining both entries/changes.
      expect(data.templates).toHaveLength(2);
      expect(data.summary.templatesChanged).toBe(2);
      for (const template of data.templates) {
        expect(template.label).toBe("shared_label");
        expect(template.entriesChanged).toBe(1);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("doesn't count an entry with unreadable registers.json as sampled", () => {
    const dir = buildResultsDir({
      reconciliation_entries: [{ id: "5000", label: "vkt_1", before: { a: "1" }, after: { a: "2" } }],
    });
    // Corrupt the "after" file for a second entry that was never given valid content.
    const brokenEntryDir = path.join(dir, "output", "reconciliation_entries", "5001", "after");
    fs.mkdirSync(brokenEntryDir, { recursive: true });
    fs.mkdirSync(path.join(dir, "output", "reconciliation_entries", "5001", "before"), { recursive: true });
    fs.writeFileSync(path.join(brokenEntryDir, "registers.json"), "not json");
    fs.writeFileSync(
      path.join(dir, "output", "reconciliation_entries", "5001", "before", "registers.json"),
      JSON.stringify({ named_results: {} }),
    );

    try {
      const data = extractCompact(dir);
      expect(data.summary.entriesSampled).toBe(1);
      expect(data.summary.entriesSkipped).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats a registers.json that parses to a non-object as unreadable, not an empty result", () => {
    const dir = buildResultsDir({});
    const entryDir = path.join(dir, "output", "reconciliation_entries", "5002");
    fs.mkdirSync(path.join(entryDir, "before"), { recursive: true });
    fs.mkdirSync(path.join(entryDir, "after"), { recursive: true });
    // Valid JSON, but not an object - e.g. a truncated-mid-write file.
    fs.writeFileSync(path.join(entryDir, "before", "registers.json"), "42");
    fs.writeFileSync(path.join(entryDir, "after", "registers.json"), JSON.stringify({ named_results: { a: "1" } }));

    try {
      const data = extractCompact(dir);
      // Must be counted as skipped (unreadable), not as a sampled entry with
      // a spurious ABSENT -> "1" change for key "a".
      expect(data.summary.entriesSampled).toBe(0);
      expect(data.summary.entriesSkipped).toBe(1);
      expect(data.templates).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("groups >= 3 keys vanishing at once into a single collapsed-template finding", () => {
    const dir = buildResultsDir({
      reconciliation_entries: [
        {
          id: "7000",
          label: "ac_policies_BS",
          before: { a: "long policy text a", b: "long policy text b", c: "long policy text c" },
          after: {},
        },
      ],
    });
    try {
      const data = extractCompact(dir);
      expect(data.templates).toEqual([]); // not folded into the normal data-diff tier
      expect(data.collapsedTemplates).toHaveLength(1);
      expect(data.collapsedTemplates[0]).toMatchObject({ label: "ac_policies_BS", entriesChanged: 1 });
      expect(data.collapsedTemplates[0].changes[0]).toMatchObject({ key: "output vanished", summary: "3 value(s) lost" });
      expect(data.summary.collapsedCount).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("groups multiple collapsed entries of the same template into one finding", () => {
    const dir = buildResultsDir({
      reconciliation_entries: [
        { id: "7010", label: "note_BEivAgi", before: { a: "1", b: "2", c: "3" }, after: {} },
        { id: "7011", label: "note_BEivAgi", before: { a: "1", b: "2", c: "3" }, after: {} },
        { id: "7012", label: "note_BEivAgi", before: { a: "1", b: "2", c: "3", d: "4" }, after: {} },
      ],
    });
    try {
      const data = extractCompact(dir);
      expect(data.collapsedTemplates).toHaveLength(1);
      expect(data.collapsedTemplates[0].entriesChanged).toBe(3);
      // Two entries lost 3 keys (deduped with a count), one lost 4 (separate line).
      expect(data.collapsedTemplates[0].changes).toEqual(
        expect.arrayContaining([
          { key: "output vanished", summary: "3 value(s) lost", count: 2 },
          { key: "output vanished", summary: "4 value(s) lost", count: 1 },
        ]),
      );
      expect(data.summary.collapsedCount).toBe(3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not treat 1-2 lost keys as a collapse (stays in the normal data-diff tier)", () => {
    const dir = buildResultsDir({
      reconciliation_entries: [{ id: "7001", label: "small_break", before: { a: "1", b: "2" }, after: {} }],
    });
    try {
      const data = extractCompact(dir);
      expect(data.collapsedTemplates).toEqual([]);
      expect(data.templates.map((t) => t.label)).toEqual(["small_break"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not treat a template gaining named_results from nothing as a collapse", () => {
    const dir = buildResultsDir({
      reconciliation_entries: [{ id: "7002", label: "newly_populated", before: {}, after: { a: "1", b: "2", c: "3" } }],
    });
    try {
      const data = extractCompact(dir);
      expect(data.collapsedTemplates).toEqual([]);
      expect(data.templates.map((t) => t.label)).toEqual(["newly_populated"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a `results` register change alongside named_results changes", () => {
    const dir = buildResultsDir({
      reconciliation_entries: [
        {
          id: "8000",
          label: "general_settings",
          before: {},
          after: {},
          registers: { before: { results: ["1.0"] }, after: { results: ["0.0"] } },
        },
      ],
    });
    try {
      const data = extractCompact(dir);
      const template = data.templates.find((t) => t.label === "general_settings");
      const resultsChange = template.changes.find((c) => c.key === "results");
      expect(resultsChange).toMatchObject({ before: "1/1 triggered", after: "0/1 triggered" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports scope (dependencies/rollforward_params/required_keys_missing) changes separately from data changes", () => {
    const dir = buildResultsDir({
      reconciliation_entries: [
        {
          id: "9000",
          label: "general_settings",
          before: {},
          after: {},
          registers: {
            before: { dependencies: { ledgers: [1, 2] } },
            after: { dependencies: { ledgers: [1] } },
          },
        },
      ],
    });
    try {
      const data = extractCompact(dir);
      // No data (named_results/results) change - must not appear in the main tier.
      expect(data.templates).toEqual([]);
      expect(data.scopeTemplates).toHaveLength(1);
      expect(data.scopeTemplates[0].label).toBe("general_settings");
      expect(data.scopeTemplates[0].changes[0]).toMatchObject({ key: "dependencies" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flags a visual-only change (view.html differs, named_results/results identical) and describes it field-by-field", () => {
    const dir = buildResultsDir({
      reconciliation_entries: [
        {
          id: "10000",
          label: "general_settings",
          before: { a: "1" },
          after: { a: "1" },
          viewHtml: {
            before: '<textarea data-name="salutation.header" placeholder="">Geacht bestuur,</textarea>',
            after: '<textarea data-name="salutation.header" placeholder="Geacht bestuur,">Geacht bestuur,</textarea>',
          },
        },
      ],
    });
    try {
      const data = extractCompact(dir);
      expect(data.templates).toEqual([]);
      expect(data.visualOnlyEntries).toHaveLength(1);
      expect(data.visualOnlyEntries[0]).toMatchObject({ label: "general_settings", entryId: "10000" });
      expect(data.visualOnlyEntries[0].changes).toEqual(['field `salutation.header` placeholder: "" → "Geacht bestuur,"']);
      expect(data.summary.visualOnlyCount).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does NOT flag a visual-only change when the data already changed (avoids redundant noise)", () => {
    const dir = buildResultsDir({
      reconciliation_entries: [
        {
          id: "10001",
          label: "general_settings",
          before: { a: "1" },
          after: { a: "2" },
          viewHtml: { before: "<div>old</div>", after: "<div>new</div>" },
        },
      ],
    });
    try {
      const data = extractCompact(dir);
      expect(data.visualOnlyEntries).toEqual([]);
      expect(data.templates).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not flag anything when view.html wasn't extracted at all", () => {
    // No viewHtml given -> files simply don't exist, same as the old selective extraction.
    const dir = buildResultsDir({
      reconciliation_entries: [{ id: "10002", label: "general_settings", before: { a: "1" }, after: { a: "1" } }],
    });
    try {
      const data = extractCompact(dir);
      expect(data.visualOnlyEntries).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("degrades to a note instead of aborting when a view.html can't be read", () => {
    // A crafted --from-zip archive can put a directory where a file belongs;
    // one throw here would lose every other tier's findings for the whole run.
    const dir = buildResultsDir({
      reconciliation_entries: [{ id: "10004", label: "unreadable_tpl", before: { a: "1" }, after: { a: "1" } }],
    });
    for (const phase of ["before", "after"]) {
      fs.mkdirSync(path.join(dir, "output", "reconciliation_entries", "10004", phase, "view.html"));
    }
    try {
      expect(() => extractCompact(dir)).not.toThrow();
      expect(extractCompact(dir).visualOnlyEntries).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("degrades to a note instead of parsing a view.html too large to be worth it", () => {
    const huge = `<div>${"x".repeat(3 * 1024 * 1024)}</div>`;
    const dir = buildResultsDir({
      reconciliation_entries: [
        { id: "10005", label: "huge_tpl", before: { a: "1" }, after: { a: "1" }, viewHtml: { before: huge, after: `${huge}<p>y</p>` } },
      ],
    });
    try {
      const data = extractCompact(dir);
      expect(data.visualOnlyEntries).toHaveLength(1);
      expect(data.visualOnlyEntries[0].changes.join(" ")).toContain("larger than 2 MB");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exposes the grouped visual-only findings, like every other tier does", () => {
    const dir = buildResultsDir({
      reconciliation_entries: ["11000", "11001"].map((id) => ({
        id,
        label: "grouped_tpl",
        before: { a: "1" },
        after: { a: "1" },
        viewHtml: { before: "<td>old</td>", after: "<td>new</td>" },
      })),
    });
    try {
      const data = extractCompact(dir);
      expect(data.visualOnlyGroups).toHaveLength(1);
      expect(data.visualOnlyGroups[0].entries).toHaveLength(2);
      expect(data.summary.visualOnlyCount).toBe(2);
      expect(data.summary.visualOnlyFindings).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not flag an entry whose view.html differs only in per-entry object ids", () => {
    const dir = buildResultsDir({
      reconciliation_entries: [
        {
          id: "10003",
          label: "wagenpark",
          before: { a: "1" },
          after: { a: "1" },
          viewHtml: {
            before: '<td data-object-id="9001" data-object-ledger-id="70">x</td>',
            after: '<td data-object-id="9002" data-object-ledger-id="70">x</td>',
          },
        },
        // Same, but single-quoted and unquoted - a renderer isn't obliged to
        // use double quotes, and an unstripped id makes every entry its own
        // "finding", which is exactly the noise this normalization removes.
        {
          id: "10006",
          label: "wagenpark",
          before: { a: "1" },
          after: { a: "1" },
          viewHtml: {
            before: "<td data-object-id='9001' data-object-ledger-id=70>x</td>",
            after: "<td data-object-id='9002' data-object-ledger-id=71>x</td>",
          },
        },
      ],
    });
    try {
      const data = extractCompact(dir);
      expect(data.visualOnlyEntries).toEqual([]);
      expect(data.diffEntryKeys).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still flags an entry that stopped emitting an object id altogether", () => {
    // The values are blanked, not the attributes deleted - losing the binding
    // is a real regression that deletion would hide as "no change".
    const dir = buildResultsDir({
      reconciliation_entries: [
        {
          id: "10007",
          label: "wagenpark",
          before: { a: "1" },
          after: { a: "1" },
          viewHtml: { before: '<td data-object-id="9001">x</td>', after: "<td>x</td>" },
        },
      ],
    });
    try {
      expect(extractCompact(dir).visualOnlyEntries).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("liquidSamplerCompact - formatCompact", () => {
  it("renders a markdown summary with per-template sections and an example link", () => {
    const md = formatCompact(extractCompact(FIXTURE_DIR));
    expect(md).toContain("## 🧪 Sampler compact diff");
    expect(md).toContain("### vkt_1");
    expect(md).toContain("[2×] `street_var`: `\"\"` → `null`");
    expect(md).toContain("### liquidation_reserve");
    expect(md).toContain("[example](https://example.staging.getsilverfin.com");
  });

  it("falls back to an output-path reference instead of trusting an unsafe example URL", () => {
    // `sample_entry_ids.yml` isn't guaranteed to come from Silverfin's own
    // sampler backend with `--from-zip` - a crafted `url` value must not be
    // interpolated straight into Markdown link syntax.
    const dir = buildResultsDir({
      reconciliation_entries: [
        { id: "1", label: "unsafe_url_tpl", before: { a: "1" }, after: { a: "2" }, url: "javascript:alert(1)" },
      ],
    });
    try {
      const md = formatCompact(extractCompact(dir));
      expect(md).not.toContain("javascript:alert(1)");
      expect(md).toContain("(`output/reconciliation_entries/1/`)");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a URL that passes an http(s) scheme check but injects Markdown link syntax via parentheses", () => {
    // `https://trusted.example/a) [injected](https://attacker)` starts with
    // "https://" but the unescaped `)` closes the generated `(...)` link
    // early, letting the rest inject arbitrary Markdown.
    const dir = buildResultsDir({
      reconciliation_entries: [
        {
          id: "1",
          label: "injection_tpl",
          before: { a: "1" },
          after: { a: "2" },
          url: "https://trusted.example/a) [injected](https://attacker)",
        },
      ],
    });
    try {
      const md = formatCompact(extractCompact(dir));
      expect(md).not.toContain("[injected](https://attacker)");
      expect(md).toContain("(`output/reconciliation_entries/1/`)");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("also sanitizes the visual-only section's 'open in app' link, not just exampleRef", () => {
    const dir = buildResultsDir({
      reconciliation_entries: [
        {
          id: "1",
          label: "visual_unsafe_url",
          before: { a: "1" },
          after: { a: "1" },
          viewHtml: { before: "<div>old</div>", after: "<div>new</div>" },
          url: "javascript:alert(1)",
        },
      ],
    });
    try {
      const md = formatCompact(extractCompact(dir));
      expect(md).not.toContain("javascript:alert(1)");
      expect(md).not.toContain("[open in app]");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a clear message when nothing changed at all, across every tier", () => {
    const md = formatCompact({ summary: { entriesSampled: 5 }, templates: [], scopeTemplates: [], collapsedTemplates: [], visualOnlyEntries: [] });
    expect(md).toContain("No changes detected across 5 sampled entries");
  });

  it("discloses skipped entries when some registers.json were unreadable", () => {
    const md = formatCompact({
      summary: { templatesChanged: 0, entriesChanged: 0, entriesSampled: 5, entriesSkipped: 2 },
      templates: [],
      scopeTemplates: [],
      collapsedTemplates: [],
      visualOnlyEntries: [],
    });
    expect(md).toContain("2 skipped (unreadable registers.json)");
  });

  it("caps the number of change lines per template and discloses the remainder", () => {
    const before = {};
    const after = {};
    for (let i = 0; i < 12; i++) after[`key_${i}`] = `value_${i}`;
    const data = extractCompact(
      buildResultsDir({ reconciliation_entries: [{ id: "1", label: "many_changes", before, after }] }),
    );
    const md = formatCompact(data);
    const changeLines = md.split("\n").filter((l) => l.startsWith("- `key_"));
    expect(changeLines).toHaveLength(8);
    expect(md).toContain("+4 more changes");
  });

  it("doesn't print a contradictory '0 template(s) changed' headline when only the collapsed tier has findings", () => {
    const dir = buildResultsDir({
      reconciliation_entries: [{ id: "1", label: "collapsed_only", before: { a: "1", b: "2", c: "3" }, after: {} }],
    });
    try {
      const md = formatCompact(extractCompact(dir));
      expect(md).not.toContain("**0** template(s) changed");
      expect(md).toContain("No named_results/results changes");
      expect(md).toContain("⚠️ Output vanished");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders the collapsed-output section with a file/url pointer, ahead of the normal template sections", () => {
    const dir = buildResultsDir({
      reconciliation_entries: [
        { id: "1", label: "collapsed_tpl", before: { a: "1", b: "2", c: "3" }, after: {}, url: "https://app.example.com/entry/1" },
      ],
    });
    try {
      const md = formatCompact(extractCompact(dir));
      expect(md).toContain("⚠️ Output vanished");
      expect(md).toContain("collapsed_tpl");
      expect(md).toContain("3 value(s) lost");
      expect(md).toContain("[example](https://app.example.com/entry/1)");
      expect(md.indexOf("⚠️ Output vanished")).toBeLessThan(md.indexOf("🔧 Scope") === -1 ? Infinity : md.indexOf("🔧 Scope"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders the scope section with a file/url pointer and without arrows (it's a delta, not a before/after pair)", () => {
    const dir = buildResultsDir({
      reconciliation_entries: [
        {
          id: "1",
          label: "scoped_tpl",
          before: {},
          after: {},
          registers: { before: { required_keys_missing: [] }, after: { required_keys_missing: ["report.period"] } },
          url: "https://app.example.com/entry/1",
        },
      ],
    });
    try {
      const md = formatCompact(extractCompact(dir));
      expect(md).toContain("🔧 Scope/dependency changes");
      expect(md).toContain("required_keys_missing");
      expect(md).toContain("report.period");
      expect(md).toContain("[example](https://app.example.com/entry/1)");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders the visual-only section pointing at the view.html files, with the field-level change explained", () => {
    const dir = buildResultsDir({
      reconciliation_entries: [
        {
          id: "1",
          label: "visual_tpl",
          before: { a: "1" },
          after: { a: "1" },
          viewHtml: {
            before: '<textarea data-name="salutation.header" placeholder="">Geacht bestuur,</textarea>',
            after: '<textarea data-name="salutation.header" placeholder="Geacht bestuur,">Geacht bestuur,</textarea>',
          },
          url: "https://app.example.com/entry/1",
        },
      ],
    });
    try {
      const md = formatCompact(extractCompact(dir));
      expect(md).toContain("👁️ Visual-only changes");
      expect(md).toContain("visual_tpl");
      expect(md).toContain("[open in app](https://app.example.com/entry/1)");
      expect(md).toContain("output/reconciliation_entries/1/{before,after}/view.html");
      expect(md).toContain('- field `salutation.header` placeholder: "" → "Geacht bestuur,"');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("caps visual-only change notes per entry and discloses the remainder", () => {
    const fields = Array.from({ length: 8 }, (_, i) => i);
    const html = (val) => fields.map((i) => `<textarea data-name="f${i}">${val}${i}</textarea>`).join("");
    const dir = buildResultsDir({
      reconciliation_entries: [
        {
          id: "1",
          label: "many_visual_changes",
          before: { a: "1" },
          after: { a: "1" },
          viewHtml: { before: html("old"), after: html("new") },
        },
      ],
    });
    try {
      const md = formatCompact(extractCompact(dir));
      const noteLines = md.split("\n").filter((l) => l.startsWith("- field `f"));
      expect(noteLines).toHaveLength(6);
      expect(md).toContain("+2 more change");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("collapses repeated identical visual-only findings into one shared finding plus the entry list", () => {
    // 12 entries of one template, each differing only in its per-entry object
    // ids: one finding, not 12 near-identical boilerplate blocks.
    const view = (objectId, heading) =>
      `<table><tr><td data-object-id="${objectId}" data-object-ledger-id="70"><span>${heading}</span></td></tr></table>`;
    const dir = buildResultsDir({
      reconciliation_entries: Array.from({ length: 12 }, (_, i) => ({
        id: `${7000 + i}`,
        label: "wagenpark",
        before: { a: "1" },
        after: { a: "1" },
        viewHtml: { before: view(1000 + i, "Total"), after: view(1000 + i, "Totaal") },
      })),
    });
    try {
      const md = formatCompact(extractCompact(dir));
      expect(md).toContain("12 entries, 1 shared change");
      expect(md).toContain("entries: `7000`, `7001`, `7002`");
      // One findings block, not one per entry.
      expect(md.split("**wagenpark**")).toHaveLength(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("caps the number of visual-only findings shown and discloses the remainder", () => {
    const dir = buildResultsDir({
      reconciliation_entries: Array.from({ length: 14 }, (_, i) => ({
        id: `${8000 + i}`,
        label: `tpl_${i}`,
        before: { a: "1" },
        after: { a: "1" },
        viewHtml: { before: `<td>word_${i}</td>`, after: `<td>changed_${i}</td>` },
      })),
    });
    try {
      const md = formatCompact(extractCompact(dir));
      const headings = md.split("\n").filter((l) => l.startsWith("**tpl_"));
      expect(headings).toHaveLength(10);
      expect(md).toContain("+4 more visual-only findings");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("doesn't let an entry id from an arbitrary zip break out of the entry list's Markdown", () => {
    // With `--from-zip` an entry id is a directory name from whatever zip the
    // caller points at, and this diff is posted verbatim as a PR comment.
    // No slash - that would just create nested directories, not test anything.
    const hostileId = "1](x)`y";
    const dir = buildResultsDir({
      reconciliation_entries: [hostileId, "2"].map((id) => ({
        id,
        label: "hostile_tpl",
        before: { a: "1" },
        after: { a: "1" },
        viewHtml: { before: "<td>old</td>", after: "<td>new</td>" },
      })),
    });
    try {
      const md = formatCompact(extractCompact(dir));
      // The id still appears, but only ever inside a code span it can't close.
      expect(md).toContain("1](x)y");
      expect(md).not.toContain("1](x)`y");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("caps the per-finding entry list and discloses the remainder", () => {
    const dir = buildResultsDir({
      reconciliation_entries: Array.from({ length: 9 }, (_, i) => ({
        id: `${9000 + i}`,
        label: "shared_tpl",
        before: { a: "1" },
        after: { a: "1" },
        viewHtml: { before: "<td>old</td>", after: "<td>new</td>" },
      })),
    });
    try {
      const md = formatCompact(extractCompact(dir));
      expect(md).toContain("9 entries, 1 shared change");
      expect(md).toContain("entries: `9000`, `9001`, `9002`, `9003`, `9004` +4 more");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a dependencies change as an indented sub-list, one category per line", () => {
    const dir = buildResultsDir({
      reconciliation_entries: [
        {
          id: "1",
          label: "deps_tpl",
          before: {},
          after: {},
          registers: {
            before: { dependencies: { ledgers: [1, 2], account_ranges: ["A%"] } },
            after: { dependencies: { ledgers: [1] } },
          },
        },
      ],
    });
    try {
      const md = formatCompact(extractCompact(dir));
      const lines = md.split("\n");
      const keyLineIndex = lines.findIndex((l) => l.includes("`dependencies`:"));
      expect(keyLineIndex).toBeGreaterThan(-1);
      // No colon-separated summary crammed onto the key line itself.
      expect(lines[keyLineIndex].trim()).toMatch(/`dependencies`:$/);
      // Each category is its own indented sub-bullet underneath.
      expect(lines[keyLineIndex + 1]).toMatch(/^ {2}- −1 ledger \(2\)$/);
      expect(lines[keyLineIndex + 2]).toMatch(/^ {2}- −1 account range \(A%\)$/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
