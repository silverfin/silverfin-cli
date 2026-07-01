const stl = require("../../lib/stlLite");

const ctx = {
  period: {
    year_end_date: "2026-01-01",
    minus_1y: {
      year_end_date: "2024-12-31",
      reconciliations: { lr: { results: { addition_12_2024: "5000.0" }, custom: {} } },
    },
  },
  current_reconciliation: { handle: "my_template" },
};

describe("stlLite.run — dynamic-key lookup into captured data", () => {
  it("builds a date-derived key and reads the captured value", () => {
    const env = stl.run(
      `
      {% assign cy = period.minus_1y.year_end_date | date:"%m_%Y" %}
      {% capture k %}addition_{{ cy }}{% endcapture %}
      {% assign v = period.minus_1y.reconciliations.lr.results.[k] | default:0 %}
    `,
      ctx
    );
    expect(env.cy).toBe("12_2024");
    expect(env.k).toBe("addition_12_2024");
    expect(Number(env.v)).toBe(5000);
  });

  it("applies default:0 when the dynamic key is absent (short/missing period)", () => {
    const env = stl.run(
      `
      {% capture k %}addition_12_2020{% endcapture %}
      {% assign v = period.minus_1y.reconciliations.lr.results.[k] | default:0 %}
    `,
      ctx
    );
    expect(env.v).toBe(0);
  });

  it("selects the correct if/else branch by year comparison", () => {
    const env = stl.run(
      `{% assign yr = "2024" %}{% if yr >= "2026" %}{% assign b = "from2026" %}{% else %}{% assign b = "normal" %}{% endif %}`,
      ctx
    );
    expect(env.b).toBe("normal");
  });

  it("evaluates a handle-gated OR condition using current_reconciliation.handle", () => {
    const env = stl.run(
      `{% if current_reconciliation.handle == "other" or current_reconciliation.handle == "my_template" %}{% assign inside = 1 %}{% endif %}`,
      ctx
    );
    expect(env.inside).toBe(1);
  });
});

describe("stlLite.run — never fabricates (safety)", () => {
  it("leaves a variable undefined when it uses an unsupported filter", () => {
    const env = stl.run(`{% assign c = 100 | currency %}`, ctx);
    expect(env.c).toBeUndefined();
  });

  it("leaves a variable undefined when it uses infix arithmetic", () => {
    const env = stl.run(`{% assign a = 2 %}{% assign m = a + 3 %}`, ctx);
    expect(env.a).toBe(2);
    expect(env.m).toBeUndefined();
  });

  it("does not desync on unsupported blocks (for/case are skipped)", () => {
    const env = stl.run(
      `{% for x in list %}{% assign ignored = 1 %}{% endfor %}{% assign after = "ok" %}`,
      ctx
    );
    expect(env.after).toBe("ok");
    expect(env.ignored).toBeUndefined();
  });
});
