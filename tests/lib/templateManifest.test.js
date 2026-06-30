jest.mock("../../lib/templates/reconciliationText");
jest.mock("../../lib/templates/sharedPart");
jest.mock("../../lib/utils/fsUtils");
jest.mock("consola");
// NOTE: liquidTestUtils is intentionally NOT mocked — we want the real scanners.

const { ReconciliationText } = require("../../lib/templates/reconciliationText");
const { SharedPart } = require("../../lib/templates/sharedPart");
const fsUtils = require("../../lib/utils/fsUtils");
const { buildManifest } = require("../../lib/templateManifest");

describe("templateManifest.buildManifest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("scans the template + recurses shared parts to build the data scope", async () => {
    ReconciliationText.read.mockReturnValue({
      text:
        "{% input custom.a.b as:currency default:0 %} " +
        "period.minus_3y period.fiscal_year " +
        "period.reconciliations.dep.results.tag1 " +
        "company.custom.ns.key company.street #280000 rollforward " +
        "{% include 'shared/sp1' %}",
      text_parts: [],
    });
    SharedPart.read.mockImplementation((name) => {
      if (name === "sp1") return { name: "sp1", text: "period.reconciliations.dep2.results.tag2 {% include 'shared/sp2' %}" };
      if (name === "sp2") return { name: "sp2", text: "custom.c.d" };
      return null;
    });
    fsUtils.readConfig.mockReturnValue({ account_range: "280,282" });

    const m = await buildManifest("my_handle");

    expect(m.handle).toBe("my_handle");
    expect(m.priorPeriodDepth).toBe(3);
    expect(m.rollforward).toBe(true);
    expect(m.ownCustoms).toEqual(expect.arrayContaining(["custom.a.b", "custom.c.d"]));
    // cross-template deps come from the template AND the recursed shared parts
    expect(Object.keys(m.crossTemplate).sort()).toEqual(["dep", "dep2"]);
    expect(m.crossTemplate.dep.results).toEqual(["tag1"]);
    expect(m.crossTemplate.dep2.results).toEqual(["tag2"]);
    expect(m.periodDrop).toEqual(expect.arrayContaining(["fiscal_year"]));
    expect(m.periodDrop).not.toContain("minus_3y");
    expect(m.companyDrop.custom).toContain("ns.key");
    expect(m.companyDrop.standard).toContain("street");
    expect(m.accounts).toContain("#280000");
    expect(m.accountRange).toBe("280,282");
    expect(m.sharedParts.sort()).toEqual(["sp1", "sp2"]);
    expect(m.missingSharedParts).toEqual([]);
  });

  it("returns null when the template is not found locally", async () => {
    ReconciliationText.read.mockReturnValue(false);
    const m = await buildManifest("missing");
    expect(m).toBeNull();
  });

  it("records shared parts that cannot be read", async () => {
    ReconciliationText.read.mockReturnValue({ text: "{% include 'shared/gone' %}", text_parts: [] });
    SharedPart.read.mockReturnValue(null);
    fsUtils.readConfig.mockReturnValue({});
    const m = await buildManifest("h");
    expect(m.missingSharedParts).toEqual(["gone"]);
    expect(m.sharedParts).toEqual([]);
  });
});
