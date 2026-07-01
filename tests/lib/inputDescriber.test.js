jest.mock("../../lib/api/sfApi");
jest.mock("../../lib/utils/liquidTestUtils");
jest.mock("../../lib/templates/reconciliationText");
jest.mock("consola");

const SF = require("../../lib/api/sfApi");
const Utils = require("../../lib/utils/liquidTestUtils");
const { ReconciliationText } = require("../../lib/templates/reconciliationText");
const { describeInputs, parseInputs, parseResultEchoes, parseAdjacentEchoes, storedMapFromCustom, literalValue } = require("../../lib/inputDescriber");

describe("parseAdjacentEchoes (indirect result echoes)", () => {
  it("attributes a result echoing a variable to the nearest preceding input", () => {
    const liquid = `
      {% input custom.liquidation.taxable_year1 as:currency default:some_var %}
      {% assign v = custom.liquidation.taxable_year1 | default:some_var | currency %}
      {% result 'taxable_year1_begin' v %}`;
    const map = parseAdjacentEchoes(liquid);
    expect(map.get("custom.liquidation.taxable_year1")).toBe("taxable_year1_begin");
  });

  it("keeps the 2026 split: from_2026 input -> from_2026 tag only", () => {
    const liquid = `
      {% input custom.liquidation_from_2026.taxable_year1 as:currency default:v %}
      {% result 'taxable_year1_begin_from_2026' vv %}`;
    const map = parseAdjacentEchoes(liquid);
    expect(map.get("custom.liquidation_from_2026.taxable_year1")).toBe("taxable_year1_begin_from_2026");
  });

  it("does NOT cross the 2026 split (before input, from_2026 tag)", () => {
    const liquid = `
      {% input custom.liquidation.taxable_year1 as:currency default:v %}
      {% result 'taxable_year1_begin_from_2026' vv %}`;
    expect(parseAdjacentEchoes(liquid).has("custom.liquidation.taxable_year1")).toBe(false);
  });

  it("ignores DIRECT echoes (those are parseResultEchoes' job)", () => {
    const liquid = `{% input custom.a.b %}{% result 'b' custom.a.b %}`;
    expect(parseAdjacentEchoes(liquid).has("custom.a.b")).toBe(false);
  });

  it("requires the tag to relate to the input key", () => {
    const liquid = `{% input custom.a.foo %}{% result 'totally_unrelated' some_var %}`;
    expect(parseAdjacentEchoes(liquid).has("custom.a.foo")).toBe(false);
  });
});

describe("inputDescriber pure helpers", () => {
  describe("parseInputs", () => {
    it("parses path, type and default expression", () => {
      const liquid = "{% input custom.amount.withdrawal_1 as:currency default:some_var placeholder:0 %}\n{% input custom.note.text as:text %}";
      const inputs = parseInputs(liquid);
      expect(inputs).toEqual([
        { path: "custom.amount.withdrawal_1", namespace: "amount", key: "withdrawal_1", type: "currency", default: "some_var" },
        { path: "custom.note.text", namespace: "note", key: "text", type: "text", default: null },
      ]);
    });

    it("dedupes by path, preferring the declaration that carries a default", () => {
      const liquid = "{% input custom.a.b as:currency %}\n{% input custom.a.b as:currency default:zero %}";
      const inputs = parseInputs(liquid);
      expect(inputs).toHaveLength(1);
      expect(inputs[0].default).toBe("zero");
    });
  });

  describe("parseResultEchoes", () => {
    it("maps a custom path to the result tag that echoes it", () => {
      const echoes = parseResultEchoes("{% result 'my_tag' custom.a.b %}");
      expect(echoes.get("custom.a.b")).toBe("my_tag");
    });
  });

  describe("literalValue", () => {
    it("resolves numeric, string and boolean literals, else undefined", () => {
      expect(literalValue("0")).toBe(0);
      expect(literalValue('"hi"')).toBe("hi");
      expect(literalValue("true")).toBe(true);
      expect(literalValue("some_var")).toBeUndefined();
      expect(literalValue(null)).toBeUndefined();
    });
  });

  describe("storedMapFromCustom", () => {
    it("builds a namespace.key map", () => {
      expect(storedMapFromCustom([{ namespace: "a", key: "b", value: 1 }])).toEqual({ "a.b": 1 });
    });
  });
});

describe("describeInputs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Utils.extractURL.mockReturnValue({
      templateType: "reconciliationText",
      firmId: "96",
      companyId: "100",
      ledgerId: "200",
      reconciliationId: "300",
    });
    SF.readReconciliationTextDetails.mockResolvedValue({ data: { handle: "my_handle" } });
  });

  it("fills effective values from stored, echoed result, and literal default; flags the rest", async () => {
    ReconciliationText.read.mockReturnValue({
      text:
        "{% input custom.over.ride as:currency %}\n" +
        "{% input custom.echo.field as:currency default:some_var %}{% result 'echo_tag' custom.echo.field %}\n" +
        "{% input custom.lit.field as:integer default:0 %}\n" +
        "{% input custom.gap.field as:currency default:computed_var %}",
      text_parts: [],
    });
    SF.getReconciliationCustom.mockResolvedValue({ data: [{ namespace: "over", key: "ride", value: 999 }] });
    SF.getReconciliationResults.mockResolvedValue({ data: { echo_tag: "42.0" } });

    const out = await describeInputs("https://live.getsilverfin.com/f/96/100/...");

    expect(out.handle).toBe("my_handle");
    const byInput = Object.fromEntries(out.inputs.map((r) => [r.input, r]));
    expect(byInput["custom.over.ride"]).toMatchObject({ effective: 999, effectiveSource: "stored" });
    expect(byInput["custom.echo.field"]).toMatchObject({ effective: "42.0", effectiveSource: "result:echo_tag" });
    expect(byInput["custom.lit.field"]).toMatchObject({ effective: 0, effectiveSource: "literal-default" });
    expect(byInput["custom.gap.field"].effective).toBeNull();
    expect(byInput["custom.gap.field"].effectiveSource).toMatch(/unavailable/);
    expect(out.results).toEqual({ echo_tag: "42.0" });
  });

  it("returns null for non-reconciliation templates", async () => {
    Utils.extractURL.mockReturnValue({ templateType: "accountTemplate" });
    const out = await describeInputs("https://live.getsilverfin.com/f/96/100/...");
    expect(out).toBeNull();
  });
});
