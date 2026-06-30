const SF = require("./api/sfApi");
const Utils = require("./utils/liquidTestUtils");
const { consola } = require("consola");

const PER_PAGE = 200;
const MAX_PAGES = 50;

/**
 * Manifest-driven DEEP capture: fetch the complete data scope a template needs so
 * a render can faithfully reproduce the live state — current + N prior periods,
 * the template + its cross-template dependencies' customs/results per period,
 * period custom, and company drop. Serialised per company (1 in-flight call max).
 *
 * Returns the gathered data; renderResolver shapes it into the test fixture.
 */

async function fetchAllPeriods(firmId, companyId) {
  const items = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const response = await SF.getPeriods(firmId, companyId, page);
    const data = response?.data ?? [];
    items.push(...data);
    if (data.length < PER_PAGE) break;
    page++;
  }
  return items;
}

async function fetchAllWorkflowReconciliations(firmId, companyId, periodId, workflowId) {
  const items = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const response = await SF.getWorkflowInformation(firmId, companyId, periodId, workflowId, page);
    const data = response?.data ?? [];
    items.push(...data);
    if (data.length < PER_PAGE) break;
    page++;
  }
  return items;
}

// handle -> reconciliation id for a given period (one pass over the workflows).
async function buildHandleMap(firmId, companyId, periodId) {
  const map = {};
  const workflowsResponse = await SF.getWorkflows(firmId, companyId, periodId);
  const workflows = workflowsResponse?.data ?? [];
  for (const workflow of workflows) {
    const reconciliations = await fetchAllWorkflowReconciliations(firmId, companyId, periodId, workflow.id);
    for (const reconciliation of reconciliations) {
      if (reconciliation.handle && !(reconciliation.handle in map)) {
        map[reconciliation.handle] = reconciliation.id;
      }
    }
  }
  return map;
}

async function buildDeepFixture(url, manifest, opts = {}) {
  const parameters = Utils.extractURL(url);
  const { firmId, companyId, ledgerId } = parameters;
  const maxPrior = opts.maxPriorPeriods ?? manifest.priorPeriodDepth ?? 0;

  const periods = await fetchAllPeriods(firmId, companyId);
  const currentIndex = periods.findIndex((period) => String(period.id) === String(ledgerId));
  if (currentIndex === -1) {
    consola.error("Current period not found in the company periods.");
    return null;
  }
  // Periods come newest-first; the current period plus the next `maxPrior` older ones.
  const selected = periods.slice(currentIndex, currentIndex + maxPrior + 1);
  const periodKey = (period) =>
    period.fiscal_year?.end_date ? String(period.fiscal_year.end_date) : String(period.id);
  // Ordered newest-first: index 0 is the current period, index N is period.minus_Ny.
  const periodOrder = selected.map(periodKey);

  const neededHandles = [manifest.handle, ...Object.keys(manifest.crossTemplate || {})];

  const companyDrop = await SF.getCompanyDrop(firmId, companyId);
  const companyCustom = await SF.getCompanyCustom(firmId, companyId);

  const data = {
    company: {
      drop: companyDrop?.data ?? null,
      custom: Utils.processCustom(companyCustom?.data || []),
    },
    periods: {},
  };

  for (const period of selected) {
    const periodId = period.id;
    const key = periodKey(period);
    const entry = { periodId, custom: Utils.processCustom((await SF.getAllPeriodCustom(firmId, companyId, periodId)) || []), reconciliations: {} };

    const handleMap = await buildHandleMap(firmId, companyId, periodId);
    for (const handle of neededHandles) {
      const reconciliationId = handleMap[handle];
      if (!reconciliationId) continue;
      const customResponse = await SF.getReconciliationCustom("firm", firmId, companyId, periodId, reconciliationId);
      const resultsResponse = await SF.getReconciliationResults("firm", firmId, companyId, periodId, reconciliationId);
      entry.reconciliations[handle] = {
        id: reconciliationId,
        custom: Utils.processCustom(customResponse?.data || []),
        results: resultsResponse?.data ?? null,
      };
    }
    data.periods[key] = entry;
  }

  return {
    handle: manifest.handle,
    firmId,
    companyId,
    currentPeriodId: ledgerId,
    currentPeriodKey: periodOrder[0] ?? null,
    periodOrder,
    periodsCaptured: selected.length,
    priorPeriodsRequested: maxPrior,
    accountsNote: manifest.accounts?.length || manifest.accountRange ? "manifest references accounts; account values are not captured in this deep fixture yet" : null,
    data,
  };
}

module.exports = { buildDeepFixture };
