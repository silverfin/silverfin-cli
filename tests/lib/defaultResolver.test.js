const { parseReference, lookup } = require("../../lib/defaultResolver");

describe("defaultResolver.parseReference", () => {
  it("parses a current-period cross-template result", () => {
    expect(parseReference("period.reconciliations.2018_tax_module.results.taxable_base")).toEqual({
      kind: "reconResult",
      periodN: 0,
      handle: "2018_tax_module",
      tag: "taxable_base",
    });
  });

  it("parses a prior-period cross-template result", () => {
    expect(parseReference("period.minus_3y.reconciliations.foo.results.bar")).toEqual({
      kind: "reconResult",
      periodN: 3,
      handle: "foo",
      tag: "bar",
    });
  });

  it("parses a cross-template custom", () => {
    expect(parseReference("period.reconciliations.h.custom.ns.k")).toEqual({
      kind: "reconCustom",
      periodN: 0,
      handle: "h",
      ns: "ns",
      key: "k",
    });
  });

  it("parses a company custom and a period custom", () => {
    expect(parseReference("company.custom.general.x")).toEqual({ kind: "companyCustom", ns: "general", key: "x" });
    expect(parseReference("period.custom.ns.k")).toEqual({ kind: "periodCustom", periodN: 0, ns: "ns", key: "k" });
  });

  it("rejects computed defaults and non-references", () => {
    expect(parseReference("some_var | default: 0")).toBeNull();
    expect(parseReference("period.reconciliations.h.results.tag + 5")).toBeNull();
    expect(parseReference("1000")).toBeNull();
    expect(parseReference(null)).toBeNull();
    expect(parseReference("custom.ns.k")).toBeNull(); // own custom — handled as stored, not a cross-reference
  });
});

describe("defaultResolver.lookup", () => {
  const deep = {
    periodOrder: ["2023-12-31", "2022-12-31"],
    data: {
      company: { custom: { "general.x": 42 } },
      periods: {
        "2023-12-31": {
          custom: { "ns.k": 7 },
          reconciliations: { foo: { results: { bar: 100 }, custom: { "n.k": 9 } } },
        },
        "2022-12-31": { reconciliations: { foo: { results: { bar: 88 } } } },
      },
    },
  };

  it("reads company / period / cross-template values, current and prior period", () => {
    expect(lookup({ kind: "companyCustom", ns: "general", key: "x" }, deep)).toBe(42);
    expect(lookup({ kind: "reconResult", periodN: 0, handle: "foo", tag: "bar" }, deep)).toBe(100);
    expect(lookup({ kind: "reconResult", periodN: 1, handle: "foo", tag: "bar" }, deep)).toBe(88);
    expect(lookup({ kind: "periodCustom", periodN: 0, ns: "ns", key: "k" }, deep)).toBe(7);
    expect(lookup({ kind: "reconCustom", periodN: 0, handle: "foo", ns: "n", key: "k" }, deep)).toBe(9);
  });

  it("returns undefined for absent values or missing prior periods", () => {
    expect(lookup({ kind: "reconResult", periodN: 5, handle: "foo", tag: "bar" }, deep)).toBeUndefined();
    expect(lookup({ kind: "reconResult", periodN: 0, handle: "missing", tag: "bar" }, deep)).toBeUndefined();
    expect(lookup({ kind: "companyCustom", ns: "general", key: "nope" }, deep)).toBeUndefined();
  });
});
