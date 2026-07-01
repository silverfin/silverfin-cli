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
  it("leaves a variable undefined when it uses a genuinely unsupported filter", () => {
    const env = stl.run(`{% assign c = 100 | some_unknown_filter %}`, ctx);
    expect(env.c).toBeUndefined();
  });

  it("leaves arithmetic undefined when an operand does not resolve", () => {
    const env = stl.run(`{% assign m = unknown_var - 3 %}`, ctx);
    expect(env.m).toBeUndefined();
  });

  it("does not desync on unsupported blocks / unresolved for-collections", () => {
    const env = stl.run(
      `{% for x in list %}{% assign ignored = 1 %}{% endfor %}{% assign after = "ok" %}`,
      ctx
    );
    expect(env.after).toBe("ok");
    expect(env.ignored).toBeUndefined();
  });
});

describe("stlLite.run — arithmetic, filters, loops, account aggregation", () => {
  it("computes safe arithmetic (incl. no-space subtraction and precedence)", () => {
    const env = stl.run(`{% assign a = 10 %}{% assign b = 3 %}{% assign r = a-b %}{% assign r2 = a + b * 2 %}`, ctx);
    expect(env.r).toBe(7);
    expect(env.r2).toBe(16);
  });

  it("treats currency/percentage as numeric pass-throughs", () => {
    const env = stl.run(`{% assign c = 5000.5 | currency %}{% assign p = 21 | percentage %}`, ctx);
    expect(env.c).toBe(5000.5);
    expect(env.p).toBe(21);
  });

  it("clamps with at_least / at_most", () => {
    const env = stl.run(`{% assign lo = 3 | at_least:10 %}{% assign hi = 30 | at_most:10 %}`, ctx);
    expect(env.lo).toBe(10);
    expect(env.hi).toBe(10);
  });

  it("splits a string into an array and iterates it in a for-loop", () => {
    const env = stl.run(`{% assign parts = "a|b|c" | split:"|" %}{% assign n = 0 %}{% for p in parts %}{% assign n = n + 1 %}{% endfor %}`, ctx);
    expect(env.n).toBe(3);
  });

  it("filters period.accounts by range and aggregates .value / .count", () => {
    const actx = {
      period: {
        accounts: [
          { number: "700000", value: 100 },
          { number: "705000", value: 50 },
          { number: "710000", value: 999 },
        ],
      },
    };
    const env = stl.run(`{% assign s = period.accounts | range:'700_709' %}{% assign total = s.value %}{% assign cnt = s.count %}`, actx);
    expect(env.total).toBe(150);
    expect(env.cnt).toBe(2);
  });

  it("does not fabricate opening_value (not captured)", () => {
    const actx = { period: { accounts: [{ number: "700000", value: 100 }] } };
    const env = stl.run(`{% assign x = period.accounts | range:'7' %}{% assign ov = x.opening_value %}`, actx);
    expect(env.ov).toBeUndefined();
  });
});
