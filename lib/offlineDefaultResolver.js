const fs = require("fs");
const { buildDeepFixture } = require("./deepCapture");
const stl = require("./stlLite");

/**
 * Offline computation of input-default VARIABLES that reduce to a lookup into
 * already-captured live data (a cross-template result/custom indexed by a
 * date-derived dynamic key, with branch selection). It runs the bounded stlLite
 * evaluator over the template's involved liquid against a context built from a
 * deep capture, and fills only the defaults stlLite could resolve entirely from
 * captured data.
 *
 * IMPORTANT: values from here are OFFLINE-COMPUTED. Because nearly every read
 * ends in `| default:0`, a wrong key/branch silently yields 0 — so these must be
 * validated against a live render/results before being trusted. They are labelled
 * `computed:<var> (offline; validate vs live)` to keep them distinct from the
 * trustworthy `captured:<path>` direct-reference resolutions.
 */

// period drop (with minus_Ny), reconciliations, company, current_reconciliation.
function buildContext(deep) {
  const byOffset = (deep.periodOrder || []).map((key) => {
    const p = (deep.data && deep.data.periods && deep.data.periods[key]) || {};
    const recon = {};
    for (const [h, v] of Object.entries(p.reconciliations || {})) {
      recon[h] = { results: v.results || {}, custom: v.custom || {} };
    }
    return { year_end_date: key, reconciliations: recon, custom: p.custom || {} };
  });
  const period = Object.assign({}, byOffset[0]);
  for (let k = 1; k < byOffset.length; k++) period["minus_" + k + "y"] = byOffset[k];
  return {
    period,
    company: { custom: (deep.data && deep.data.company && deep.data.company.custom) || {}, drop: (deep.data && deep.data.company && deep.data.company.drop) || {} },
    current_reconciliation: { handle: deep.handle },
  };
}

function loadLiquid(involvedFiles) {
  let out = "";
  for (const file of involvedFiles || []) {
    try {
      out += "\n" + fs.readFileSync(file, "utf8");
    } catch {
      // skip unreadable involved file
    }
  }
  return out;
}

// A default expression that is a bare variable name (not a literal or data path).
function isVariableDefault(def) {
  return typeof def === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(def.trim());
}

function numericish(v) {
  return typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v;
}

/**
 * @param {String} url
 * @param {Object} scope silverfin-ls data scope (handle, crossTemplate, priorPeriodDepth, involvedFiles)
 * @param {Array} rows describe-inputs rows (mutated in place for computed defaults)
 * @returns {Object} summary
 */
async function computeOfflineDefaults(url, scope, rows) {
  const targets = rows.filter(
    (r) => typeof r.effectiveSource === "string" && r.effectiveSource.startsWith("unavailable") && isVariableDefault(r.default)
  );
  if (targets.length === 0) {
    return { attempted: 0, computed: 0, note: "no variable-defaults to compute" };
  }

  const deep = await buildDeepFixture(url, scope, { maxPriorPeriods: scope.priorPeriodDepth || 0 });
  if (!deep) {
    return { attempted: targets.length, computed: 0, warning: "deep capture failed" };
  }

  const ctx = buildContext(deep);
  const liquid = loadLiquid(scope.involvedFiles);
  let env;
  try {
    env = stl.run(liquid, ctx);
  } catch (error) {
    return { attempted: targets.length, computed: 0, warning: `evaluator error: ${String(error.message)}` };
  }

  let computed = 0;
  for (const row of targets) {
    const value = env[row.default.trim()];
    if (value !== undefined && value !== null && value !== stl.UNRESOLVED) {
      row.effective = numericish(value);
      row.effectiveSource = `computed:${row.default.trim()} (offline; validate vs live)`;
      computed++;
    }
  }

  return { attempted: targets.length, computed, periodsCaptured: deep.periodsCaptured, note: "offline-computed values require validation against a live render" };
}

module.exports = { computeOfflineDefaults, buildContext, isVariableDefault };
