const { traceDefault, parseUpstreamRef } = require("../../lib/provenanceTracer");

const deep = { periodOrder: ["2024-12-31", "2023-12-31"] };
const ctx = { period: {} };

describe("provenanceTracer.parseUpstreamRef", () => {
  it("parses current and prior-period reconciliation refs", () => {
    expect(parseUpstreamRef("period.reconciliations.foo.custom.ns.key")).toEqual({ periodOffset: 0, handle: "foo", kind: "custom", tail: ".ns.key" });
    expect(parseUpstreamRef("period.minus_2y.reconciliations.foo.results.tag")).toEqual({ periodOffset: 2, handle: "foo", kind: "results", tail: ".tag" });
  });
  it("rejects non-reconciliation refs", () => {
    expect(parseUpstreamRef("period.year_end_date")).toBeNull();
    expect(parseUpstreamRef("company.custom.a.b")).toBeNull();
  });
});

describe("provenanceTracer.traceDefault", () => {
  it("auto-inverts a default that is a direct cross-template custom", () => {
    const r = traceDefault({ input: "custom.x.y", default: "period.reconciliations.other.custom.ns.key" }, "", ctx, deep, () => null);
    expect(r.invertible).toBe(true);
    expect(r.target).toMatchObject({ handle: "other", namespace: "ns", key: "key", periodKey: "2024-12-31" });
  });

  it("auto-inverts a variable default that assigns from an upstream custom", () => {
    const liquid = `{% assign myvar = period.minus_1y.reconciliations.other.custom.ns.key %}`;
    const r = traceDefault({ input: "custom.x.y", default: "myvar" }, liquid, ctx, deep, () => null);
    expect(r.invertible).toBe(true);
    expect(r.target).toMatchObject({ handle: "other", namespace: "ns", key: "key", periodKey: "2023-12-31" });
  });

  it("inverts a result default via a static custom echo (upstream scope)", () => {
    const getScope = (h) => (h === "other" ? { resultEchoes: { tag: "custom.ns2.key2" } } : null);
    const r = traceDefault({ input: "custom.x.y", default: "period.reconciliations.other.results.tag" }, "", ctx, deep, getScope);
    expect(r.invertible).toBe(true);
    expect(r.via).toBe("result-echo:tag");
    expect(r.target).toMatchObject({ handle: "other", namespace: "ns2", key: "key2" });
  });

  it("does NOT invert a result with no static echo (points to mode 3)", () => {
    const r = traceDefault({ input: "custom.x.y", default: "period.reconciliations.other.results.tag" }, "", ctx, deep, () => null);
    expect(r.invertible).toBe(false);
    expect(r.upstreamResult).toMatchObject({ handle: "other", tag: "tag" });
    expect(r.reason).toMatch(/computed result/);
  });

  it("does NOT invert a computed (arithmetic) default", () => {
    const liquid = `{% assign v = a - b %}`;
    const r = traceDefault({ input: "custom.x.y", default: "v" }, liquid, ctx, deep, () => null);
    expect(r.invertible).toBe(false);
    expect(r.reason).toMatch(/computed/);
  });

  it("does NOT invert when there is no default", () => {
    const r = traceDefault({ input: "custom.x.y", default: null }, "", ctx, deep, () => null);
    expect(r.invertible).toBe(false);
  });
});

describe("provenanceTracer.traceDefault — safety (never a wrong write)", () => {
  it("refuses a direct default with a value-changing filter (times)", () => {
    const r = traceDefault({ input: "custom.x.y", default: "period.reconciliations.other.custom.ns.key | times: 2" }, "", ctx, deep, () => null);
    expect(r.invertible).toBe(false);
    expect(r.reason).toMatch(/value-changing filter/);
  });

  it("refuses a variable default whose assignment has a value-changing filter", () => {
    const liquid = `{% assign foo = period.reconciliations.other.custom.ns.key | times: 2 %}`;
    const r = traceDefault({ input: "custom.x.y", default: "foo" }, liquid, ctx, deep, () => null);
    expect(r.invertible).toBe(false);
    expect(r.reason).toMatch(/value-changing filter/);
  });

  it("still inverts through a harmless default: filter", () => {
    const r = traceDefault({ input: "custom.x.y", default: "period.reconciliations.other.custom.ns.key | default:0" }, "", ctx, deep, () => null);
    expect(r.invertible).toBe(true);
    expect(r.target).toMatchObject({ namespace: "ns", key: "key" });
  });

  it("refuses a custom field-access ref (custom.ns.key.value), not a plain custom", () => {
    const r = traceDefault({ input: "custom.x.y", default: "period.reconciliations.other.custom.ns.key.value" }, "", ctx, deep, () => null);
    expect(r.invertible).toBe(false);
    expect(r.reason).toMatch(/not a plain custom/);
  });
});
