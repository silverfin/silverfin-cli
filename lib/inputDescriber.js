const SF = require("./api/sfApi");
const Utils = require("./utils/liquidTestUtils");
const { ReconciliationText } = require("./templates/reconciliationText");
const { consola } = require("consola");

/**
 * describe-inputs: list a reconciliation's custom inputs with their declared
 * defaults, stored values, and live EFFECTIVE values — but only from sources we
 * can be CERTAIN about (no re-render, which can't faithfully reproduce live
 * company state). Effective value is filled from, in order:
 *   1. the stored custom (an explicit override), else
 *   2. the live result where the template directly exposes the input
 *      (`{% result 'tag' custom.ns.key %}`), else
 *   3. a literal default (`default:0`, `default:"x"`), else
 *   4. flagged unavailable (only resolvable in the rendered UI).
 */

// Combine main liquid + every text part into one string for parsing.
function combineLiquid(template) {
  const parts = [template.text || ""];
  const tp = template.text_parts;
  if (Array.isArray(tp)) {
    parts.push(...tp.map((p) => (p && p.content) || ""));
  } else if (tp && typeof tp === "object") {
    parts.push(...Object.values(tp).map((c) => (typeof c === "string" ? c : (c && c.content) || "")));
  }
  return parts.join("\n");
}

// Parse `{% input custom.ns.key as:type default:expr ... %}` declarations.
function parseInputs(liquid) {
  const inputRe = /\{%-?\s*input\s+(custom\.[a-zA-Z0-9_.]+)([^%]*?)-?%\}/g;
  const byPath = new Map();
  let match;
  while ((match = inputRe.exec(liquid)) !== null) {
    const path = match[1];
    const opts = match[2] || "";
    const typeMatch = opts.match(/\bas:([a-zA-Z0-9_]+)/);
    // default value runs until the next option keyword or the end of the tag
    const defaultMatch = opts.match(/\bdefault:(.+?)(?:\s+\b(?:as|placeholder|precision|width|required|html|size|maximum|minimum|on|off):|\s*$)/);
    const type = typeMatch ? typeMatch[1] : "text";
    const def = defaultMatch ? defaultMatch[1].trim() : null;
    const segments = path.split(".");
    const namespace = segments[1];
    const key = segments.slice(2).join(".");
    const existing = byPath.get(path);
    if (!existing || (def && !existing.default)) {
      byPath.set(path, { path, namespace, key, type, default: def });
    }
  }
  return Array.from(byPath.values());
}

// Parse `{% result 'tag' custom.ns.key %}` echoes → Map(customPath -> resultTag).
function parseResultEchoes(liquid) {
  const resultRe = /\{%-?\s*result\s+['"]([a-zA-Z0-9_]+)['"]\s+(custom\.[a-zA-Z0-9_.]+)\s*-?%\}/g;
  const byCustomPath = new Map();
  let match;
  while ((match = resultRe.exec(liquid)) !== null) {
    if (!byCustomPath.has(match[2])) {
      byCustomPath.set(match[2], match[1]);
    }
  }
  return byCustomPath;
}

// Build { "namespace.key": value } from the API custom array.
function storedMapFromCustom(customArray) {
  const map = {};
  for (const custom of customArray || []) {
    if (!custom || custom.namespace == null || custom.key == null) continue;
    map[`${custom.namespace}.${custom.key}`] = custom.value;
  }
  return map;
}

// If a default expression is a literal, return its value; otherwise undefined.
function literalValue(def) {
  if (def == null) return undefined;
  const trimmed = def.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const quoted = trimmed.match(/^["'](.*)["']$/);
  if (quoted) return quoted[1];
  if (trimmed === "true" || trimmed === "false") return trimmed === "true";
  return undefined;
}

async function describeInputs(url, opts = {}) {
  const parameters = Utils.extractURL(url);
  if (parameters.templateType !== "reconciliationText") {
    consola.error("describe-inputs currently supports reconciliation templates only.");
    return null;
  }

  const detailsResponse = await SF.readReconciliationTextDetails("firm", parameters.firmId, parameters.companyId, parameters.ledgerId, parameters.reconciliationId);
  const handle = detailsResponse?.data?.handle;
  if (!handle) {
    consola.error("Could not resolve the reconciliation handle from the URL.");
    return null;
  }

  const template = ReconciliationText.read(handle);
  if (!template) {
    consola.error(`Template "${handle}" was not found locally — run this command from your templates repo.`);
    return null;
  }

  const liquid = combineLiquid(template);
  const inputs = parseInputs(liquid);
  const echoes = parseResultEchoes(liquid);

  const customResponse = await SF.getReconciliationCustom("firm", parameters.firmId, parameters.companyId, parameters.ledgerId, parameters.reconciliationId);
  const resultsResponse = await SF.getReconciliationResults("firm", parameters.firmId, parameters.companyId, parameters.ledgerId, parameters.reconciliationId);
  const stored = storedMapFromCustom(customResponse?.data);
  const results = resultsResponse?.data || {};

  const rows = inputs.map((input) => {
    const nsKey = `${input.namespace}.${input.key}`;
    const hasStored = Object.hasOwn(stored, nsKey);
    let effective = null;
    let effectiveSource = null;

    if (hasStored && stored[nsKey] != null) {
      effective = stored[nsKey];
      effectiveSource = "stored";
    } else {
      const tag = echoes.get(input.path);
      const literal = literalValue(input.default);
      if (tag && Object.hasOwn(results, tag)) {
        effective = results[tag];
        effectiveSource = `result:${tag}`;
      } else if (literal !== undefined) {
        effective = literal;
        effectiveSource = "literal-default";
      } else {
        effective = null;
        effectiveSource = "unavailable: not exposed as a result (rendered-UI only)";
      }
    }

    return {
      input: input.path,
      type: input.type,
      stored: hasStored ? stored[nsKey] : null,
      default: input.default,
      effective,
      effectiveSource,
    };
  });

  const output = { handle, reconciliationId: parameters.reconciliationId, inputs: rows, results };

  // --resolve: fill the `unavailable` rows whose default is a direct reference to
  // data created elsewhere (cross-template result/custom, period/company custom),
  // by reading it straight from a targeted deep capture of the live company file.
  if (opts.resolve) {
    const { getDataScope } = require("./dataScope");
    const { resolveDefaults } = require("./defaultResolver");
    const scope = getDataScope(handle);
    if (!scope) {
      output.resolution = {
        resolved: 0,
        error: "Could not get the data scope from silverfin-ls; defaults left unresolved.",
      };
    } else {
      output.resolution = await resolveDefaults(url, scope, rows);
      // --compute: additionally compute variable-defaults that reduce to a lookup
      // into captured live data (offline evaluator; values need live validation).
      if (opts.compute) {
        const { computeOfflineDefaults } = require("./offlineDefaultResolver");
        output.offlineResolution = await computeOfflineDefaults(url, scope, rows);
      }
    }
  }

  return output;
}

module.exports = { describeInputs, parseInputs, parseResultEchoes, combineLiquid, storedMapFromCustom, literalValue };
