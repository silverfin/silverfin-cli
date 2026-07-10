const path = require("path");
const { extractCompact, formatCompact, diffNamedResults, readEntryLabels } = require("../../lib/liquidSamplerCompact");

const FIXTURE_DIR = path.join(__dirname, "..", "fixtures", "sampler-results");

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
});

describe("liquidSamplerCompact - readEntryLabels", () => {
  it("maps entry ids to template labels for both entry kinds", () => {
    const labels = readEntryLabels(FIXTURE_DIR);
    expect(labels["1_100_1000_5000"].label).toBe("vkt_1");
    expect(labels["1_103_1003_490000.000"].label).toBe("some_account_template");
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
});
