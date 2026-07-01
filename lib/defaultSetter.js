const fs = require("fs");
const path = require("path");
const { consola } = require("consola");
const SF = require("./api/sfApi");
const Utils = require("./utils/liquidTestUtils");
const { ReconciliationText } = require("./templates/reconciliationText");
const inputDescriber = require("./inputDescriber");
const { getDataScope } = require("./dataScope");
const { buildContext } = require("./offlineDefaultResolver");
const { traceDefault } = require("./provenanceTracer");
const { ChangeReport } = require("./changeReport");
const { coerceValue } = require("./customWriter");

// Coarse blast radius: template dirs (reconciliation_texts + shared_parts) that
// reference the upstream handle's results/customs. Honest and cheap; a shared
// upstream is a broad change, so we surface who else reads it.
function downstreamReaders(handle, kind) {
  const roots = ["reconciliation_texts", "shared_parts"];
  const readers = new Set();
  const needle = new RegExp(`reconciliations\\.${handle}\\.${kind}`);
  for (const root of roots) {
    let dirs;
    try { dirs = fs.readdirSync(path.join(process.cwd(), root)); } catch { continue; }
    for (const dir of dirs) {
      const base = path.join(process.cwd(), root, dir);
      const files = [];
      try {
        const walk = (p) => {
          for (const e of fs.readdirSync(p, { withFileTypes: true })) {
            const fp = path.join(p, e.name);
            if (e.isDirectory()) walk(fp);
            else if (e.name.endsWith(".liquid")) files.push(fp);
          }
        };
        walk(base);
      } catch { continue; }
      for (const f of files) {
        try {
          if (needle.test(fs.readFileSync(f, "utf8"))) { readers.add(`${root}/${dir}`); break; }
        } catch { /* skip */ }
      }
    }
  }
  return [...readers];
}

// Lightweight capture for TRACING only: period dates (periodOrder + drop scalars).
// Tracing a default resolves a source PATH (handle + date-derived key), which needs
// only the period sequence — not the reconciliation data — so we skip the slow walk.
async function captureLight(url, handle, depth) {
  const { firmId, companyId, ledgerId } = Utils.extractURL(url);
  const periods = await SF.getAllPeriods(firmId, companyId);
  const currentIndex = periods.findIndex((p) => String(p.id) === String(ledgerId));
  if (currentIndex === -1) return null;
  const selected = periods.slice(currentIndex, currentIndex + (depth || 0) + 1);
  const keyOf = (p) => (p.fiscal_year?.end_date ? String(p.fiscal_year.end_date) : String(p.id));
  const periodOrder = selected.map(keyOf);
  const data = { company: { custom: {}, drop: null }, periods: {} };
  for (const p of selected) {
    data.periods[keyOf(p)] = {
      periodId: p.id,
      drop: {
        year_end_date: keyOf(p),
        year_start_date: p.fiscal_year?.start_date ?? null,
        end_date: p.end_date ?? null,
        fiscal_year: p.fiscal_year ?? null,
      },
      custom: {},
      reconciliations: {},
    };
  }
  return { handle, periodOrder, periodIds: selected.map((p) => p.id), currentPeriodKey: periodOrder[0] ?? null, data };
}

/**
 * Set a target input's DEFAULT to `rawValue` by writing the upstream custom it
 * derives from (never an override on the target field). Auto-proceeds when the
 * default is auto-invertible; otherwise surfaces the provenance chain and does
 * nothing. Returns a structured result (the command renders it).
 */
async function setDefault(url, inputPath, rawValue, opts = {}) {
  const parameters = Utils.extractURL(url);
  const { firmId, companyId } = parameters;
  const details = await SF.readReconciliationTextDetails("firm", firmId, companyId, parameters.ledgerId, parameters.reconciliationId);
  const handle = details?.data?.handle;
  if (!handle) { consola.error("Could not resolve the reconciliation handle from the URL."); return null; }

  const template = ReconciliationText.read(handle);
  if (!template) { consola.error(`Template "${handle}" not found locally — run from your templates repo.`); return null; }
  const inputs = inputDescriber.parseInputs(inputDescriber.combineLiquid(template));
  const row = inputs.find((i) => i.path === inputPath);
  if (!row) { consola.error(`Input "${inputPath}" not found in ${handle}.`); return null; }

  const scope = getDataScope(handle);
  if (!scope) return null;
  let liquid = "";
  for (const f of scope.involvedFiles || []) { try { liquid += "\n" + fs.readFileSync(f, "utf8"); } catch { /* skip */ } }

  const light = await captureLight(url, handle, scope.priorPeriodDepth || 0);
  if (!light) { consola.error("Could not resolve the company periods."); return null; }
  const ctx = buildContext(light);
  const trace = traceDefault(row, liquid, ctx, light, (h) => getDataScope(h));

  if (!trace.invertible) {
    return { invertible: false, handle, input: inputPath, trace };
  }

  // Resolve the upstream write target (same company, traced period + handle).
  // Resolve the period by OFFSET, not by end-date key (two periods can share an
  // end_date), so we never write to the wrong period.
  const t = trace.target;
  const periodId = light.periodIds[t.periodOffset];
  if (periodId == null) return { invertible: false, handle, input: inputPath, trace: { ...trace, invertible: false, reason: `period offset ${t.periodOffset} (${t.periodKey}) not captured` } };
  const upstreamRecon = await SF.findReconciliationInWorkflows(firmId, t.handle, companyId, periodId);
  if (!upstreamRecon || !upstreamRecon.id) {
    return { invertible: false, handle, input: inputPath, trace: { ...trace, invertible: false, reason: `upstream template ${t.handle} not found in period ${t.periodKey}` } };
  }
  const upstreamId = upstreamRecon.id;
  const nsKey = `${t.namespace}.${t.key}`;
  let oldValue = null;
  try {
    const cur = await SF.getReconciliationCustom("firm", firmId, companyId, periodId, upstreamId);
    const map = Utils.processCustom(cur?.data || []);
    if (Object.hasOwn(map, nsKey)) oldValue = map[nsKey];
  } catch { /* ignore */ }
  const newValue = coerceValue(String(rawValue));

  const report = new ChangeReport();
  report.add({
    target: `${t.handle} @ ${t.periodKey} (company ${companyId})`,
    level: "reconciliation",
    namespace: t.namespace,
    key: t.key,
    oldValue,
    newValue,
    why: `to set default of ${inputPath} (${trace.via})`,
    applied: false,
  });

  const uniqueReaders = [...new Set(downstreamReaders(t.handle, "results").concat(downstreamReaders(t.handle, "custom")))];
  if (uniqueReaders.length > 1) {
    report.note(`Blast radius: ${uniqueReaders.length} templates read ${t.handle} — this also affects: ${uniqueReaders.slice(0, 8).join(", ")}${uniqueReaders.length > 8 ? " …" : ""}`);
  }

  // Warn if the target field has a stored override that would SHADOW the default.
  try {
    const tgt = await SF.getReconciliationCustom("firm", firmId, companyId, parameters.ledgerId, parameters.reconciliationId);
    const tgtMap = Utils.processCustom(tgt?.data || []);
    const tgtKey = `${row.namespace}.${row.key}`;
    if (Object.hasOwn(tgtMap, tgtKey) && tgtMap[tgtKey] != null) {
      report.note(`${inputPath} currently has a STORED override (${tgtMap[tgtKey]}); it keeps showing that until you clear it with delete-custom — set-default only changes the DEFAULT.`);
    }
  } catch { /* ignore */ }

  if (opts.dryRun) {
    return { invertible: true, handle, input: inputPath, trace, report, applied: false, wrote: false };
  }

  const response = await SF.updateReconciliationCustom(firmId, companyId, periodId, upstreamId, [{ namespace: t.namespace, key: t.key, value: newValue }]);
  const ok = response && response.status >= 200 && response.status < 300;
  report.changes[0].applied = ok;

  let verified = null;
  try {
    const fresh = await SF.getReconciliationCustom("firm", firmId, companyId, periodId, upstreamId);
    const map = Utils.processCustom(fresh?.data || []);
    verified = Object.hasOwn(map, nsKey) ? map[nsKey] : null;
  } catch { /* ignore */ }

  return { invertible: true, handle, input: inputPath, trace, report, applied: ok, wrote: true, verified };
}

module.exports = { setDefault, downstreamReaders, captureLight };
