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

  it("falls back to a generic note when no anchored field explains the diff", () => {
    const notes = describeVisualChange("<div>old layout</div>", "<div class=\"new\">new layout</div>");
    expect(notes).toEqual(["layout/markup changed with no anchored field explaining it - compare the two view.html files directly"]);
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
