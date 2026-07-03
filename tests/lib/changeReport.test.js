const { ChangeReport } = require("../../lib/changeReport");

describe("ChangeReport", () => {
  it("renders a table with old → new and why, plus notes", () => {
    const r = new ChangeReport();
    r.add({ target: "liquidation_reserve @ 2024-12-31", level: "reconciliation", namespace: "reserve", key: "addition_2024", oldValue: 3000, newValue: 5000, why: "to set default of 275A.taxable_year1" });
    r.note("Blast radius: 3 templates read liquidation_reserve");
    const table = r.toTable();
    expect(table).toMatch(/liquidation_reserve @ 2024-12-31/);
    expect(table).toMatch(/reserve\.addition_2024/);
    expect(table).toMatch(/3000 → 5000/);
    expect(table).toMatch(/to set default of 275A\.taxable_year1/);
    expect(table).toMatch(/Blast radius: 3 templates/);
  });

  it("shows ∅ for null old values and serializes to JSON", () => {
    const r = new ChangeReport();
    r.add({ target: "t", level: "reconciliation", namespace: "ns", key: "k", oldValue: null, newValue: 1, why: "w" });
    expect(r.toTable()).toMatch(/∅ → 1/);
    expect(r.toJSON().changes).toHaveLength(1);
  });

  it("handles the empty case", () => {
    expect(new ChangeReport().toTable()).toBe("(no custom changes)");
  });
});
