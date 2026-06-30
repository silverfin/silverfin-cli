const { buildDeepFixture } = require("./deepCapture");

/**
 * Resolve the effective value of inputs whose default is a DIRECT reference to
 * live data created elsewhere — a cross-template result/custom, a period/company
 * custom, optionally a prior period (`period.minus_Ny...`). These values exist in
 * the live API (no browser, no re-render), so we read them straight from a
 * targeted deep capture of only the referenced handles/periods.
 *
 * Computed defaults (filters, arithmetic, conditionals) are NOT resolved here and
 * stay flagged — they would need an actual render.
 */

// A resolvable reference is a single dotted path (no spaces / filters / operators).
const REF_RE = /^[a-zA-Z0-9_.]+$/;

// Parse a default expression into a typed reference, or null if not a direct ref.
function parseReference(def) {
  if (typeof def !== "string") return null;
  const ref = def.trim();
  if (!REF_RE.test(ref)) return null;

  let m = ref.match(/^company\.custom\.([a-z0-9_]+)\.([a-z0-9_]+)$/i);
  if (m) return { kind: "companyCustom", ns: m[1], key: m[2] };

  // period[.minus_Ny].<rest>
  let periodN = 0;
  let rest = null;
  m = ref.match(/^period\.minus_(\d+)y\.(.+)$/i);
  if (m) {
    periodN = Number(m[1]);
    rest = m[2];
  } else {
    m = ref.match(/^period\.(.+)$/i);
    if (m) rest = m[1];
  }
  if (rest == null) return null;

  m = rest.match(/^reconciliations\.([a-z0-9_]+)\.results\.([a-z0-9_]+)$/i);
  if (m) return { kind: "reconResult", periodN, handle: m[1], tag: m[2] };

  m = rest.match(/^reconciliations\.([a-z0-9_]+)\.custom\.([a-z0-9_]+)\.([a-z0-9_]+)$/i);
  if (m) return { kind: "reconCustom", periodN, handle: m[1], ns: m[2], key: m[3] };

  m = rest.match(/^custom\.([a-z0-9_]+)\.([a-z0-9_]+)$/i);
  if (m) return { kind: "periodCustom", periodN, ns: m[1], key: m[2] };

  return null;
}

// Look up a parsed reference in a deep fixture; undefined if not present.
function lookup(parsed, deep) {
  if (parsed.kind === "companyCustom") {
    return deep?.data?.company?.custom?.[`${parsed.ns}.${parsed.key}`];
  }
  const periodKey = deep?.periodOrder?.[parsed.periodN];
  if (!periodKey) return undefined;
  const entry = deep?.data?.periods?.[periodKey];
  if (!entry) return undefined;
  if (parsed.kind === "reconResult") {
    return entry.reconciliations?.[parsed.handle]?.results?.[parsed.tag];
  }
  if (parsed.kind === "reconCustom") {
    return entry.reconciliations?.[parsed.handle]?.custom?.[`${parsed.ns}.${parsed.key}`];
  }
  if (parsed.kind === "periodCustom") {
    return entry.custom?.[`${parsed.ns}.${parsed.key}`];
  }
  return undefined;
}

function sourceLabel(parsed, deep) {
  if (parsed.kind === "companyCustom") {
    return `captured:company.custom.${parsed.ns}.${parsed.key}`;
  }
  const at = `@${deep?.periodOrder?.[parsed.periodN]}`;
  switch (parsed.kind) {
    case "reconResult":
      return `captured:period${at}.reconciliations.${parsed.handle}.results.${parsed.tag}`;
    case "reconCustom":
      return `captured:period${at}.reconciliations.${parsed.handle}.custom.${parsed.ns}.${parsed.key}`;
    case "periodCustom":
      return `captured:period${at}.custom.${parsed.ns}.${parsed.key}`;
    default:
      return "captured";
  }
}

/**
 * Resolve still-unavailable rows in place. Captures only the referenced handles
 * and the deepest referenced prior period.
 * @returns {Object} a resolution summary
 */
async function resolveDefaults(url, scope, rows) {
  const unresolved = rows.filter(
    (r) => typeof r.effectiveSource === "string" && r.effectiveSource.startsWith("unavailable") && r.default
  );

  const targets = [];
  const neededHandles = new Set();
  let maxPriorPeriods = 0;
  for (const row of unresolved) {
    const parsed = parseReference(row.default);
    if (!parsed) continue;
    targets.push({ row, parsed });
    // The own handle is always captured by buildDeepFixture; only add others.
    if (parsed.handle && parsed.handle !== scope.handle) neededHandles.add(parsed.handle);
    if (parsed.periodN) maxPriorPeriods = Math.max(maxPriorPeriods, parsed.periodN);
  }

  if (targets.length === 0) {
    return { attempted: 0, resolved: 0, stillUnavailable: unresolved.length, capture: null };
  }

  const crossTemplate = {};
  for (const h of neededHandles) crossTemplate[h] = { results: [], customs: [] };
  const trimmedManifest = {
    handle: scope.handle,
    crossTemplate,
    priorPeriodDepth: maxPriorPeriods,
    accounts: [],
  };

  const deep = await buildDeepFixture(url, trimmedManifest, { maxPriorPeriods });
  if (!deep) {
    return {
      attempted: targets.length,
      resolved: 0,
      stillUnavailable: unresolved.length,
      capture: null,
      warning: "Deep capture failed; direct-reference defaults left unresolved.",
    };
  }

  let resolved = 0;
  for (const { row, parsed } of targets) {
    const value = lookup(parsed, deep);
    if (value !== undefined) {
      row.effective = value;
      row.effectiveSource = sourceLabel(parsed, deep);
      resolved++;
    }
  }

  return {
    attempted: targets.length,
    resolved,
    stillUnavailable: unresolved.length - resolved,
    capture: {
      periodsCaptured: deep.periodsCaptured,
      periodOrder: deep.periodOrder,
      handles: [scope.handle, ...neededHandles],
    },
  };
}

module.exports = { resolveDefaults, parseReference, lookup };
