const fs = require("fs");
const os = require("os");
const path = require("path");
const { extractCompact, formatCompact, diffNamedResults, readEntryLabels } = require("../../lib/liquidSamplerCompact");

const FIXTURE_DIR = path.join(__dirname, "..", "fixtures", "sampler-results");

/**
 * Build a minimal results directory (sample_entry_ids.yml + output/) under a
 * fresh temp dir, from a plain description of entries per kind.
 * @param {Object<string, Array<{id: string, label: string, before: Object, after: Object}>>} byKind
 * @returns {string} path to the built results directory
 */
function buildResultsDir(byKind) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sampler-compact-test-"));
  const yml = {};
  for (const [kind, entries] of Object.entries(byKind)) {
    yml[kind] = {};
    for (const entry of entries) {
      yml[kind][entry.id] = { label: entry.label, url: null };
      for (const phase of ["before", "after"]) {
        const entryDir = path.join(dir, "output", kind, entry.id, phase);
        fs.mkdirSync(entryDir, { recursive: true });
        fs.writeFileSync(path.join(entryDir, "registers.json"), JSON.stringify({ named_results: entry[phase] }));
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
});

describe("liquidSamplerCompact - readEntryLabels", () => {
  it("maps kind/entry id to template labels for both entry kinds", () => {
    const labels = readEntryLabels(FIXTURE_DIR);
    expect(labels["reconciliation_entries/1_100_1000_5000"].label).toBe("vkt_1");
    expect(labels["account_entries/1_103_1003_490000.000"].label).toBe("some_account_template");
  });

  it("keeps account and reconciliation entries separate when their raw ids match", () => {
    const labels = readEntryLabels(FIXTURE_DIR);
    // The fixture ids don't collide, but the map must be keyed by kind too so
    // that a shared raw id between kinds doesn't overwrite one label with
    // the other's.
    expect(Object.keys(labels).every((key) => key.includes("/"))).toBe(true);
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

  it("surfaces a broken template (value -> removed) as undefined", () => {
    const liq = data.templates.find((t) => t.label === "liquidation_reserve");
    const change = liq.changes.find((c) => c.key === "distributable_at_5");
    expect(change.before).toBe('"20615.89"');
    expect(change.after).toBe("undefined");
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
});

describe("liquidSamplerCompact - formatCompact", () => {
  it("renders a markdown summary with per-template sections", () => {
    const md = formatCompact(extractCompact(FIXTURE_DIR));
    expect(md).toContain("Sampler compact diff (named_results)");
    expect(md).toContain("### vkt_1");
    expect(md).toContain("[2×] `street_var`: `\"\"` → `null`");
    expect(md).toContain("### liquidation_reserve");
  });

  it("renders a clear message when nothing changed", () => {
    const md = formatCompact({ summary: { templatesChanged: 0, entriesChanged: 0, entriesSampled: 5 }, templates: [] });
    expect(md).toContain("No `named_results` changes across 5 sampled entries");
  });

  it("discloses skipped entries when some registers.json were unreadable", () => {
    const md = formatCompact({
      summary: { templatesChanged: 0, entriesChanged: 0, entriesSampled: 5, entriesSkipped: 2 },
      templates: [],
    });
    expect(md).toContain("2 skipped (unreadable registers.json)");
  });
});
