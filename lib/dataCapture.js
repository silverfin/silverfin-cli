const SF = require("./api/sfApi");
const Utils = require("./utils/liquidTestUtils");
const liquidTestGenerator = require("./liquidTestGenerator");
const { consola } = require("consola");

const PER_PAGE = 200;
const MAX_PAGES = 50;

/**
 * Capture a live company file's data as a plain object (no I/O).
 *
 * Two modes:
 *  - scoped (default): reuses the create-test gathering (`buildLiquidTest`) to
 *    capture exactly what the template at the URL references (+ dependencies).
 *  - full: fans out across the whole company file (company + every period +
 *    every workflow reconciliation) collecting customs and results.
 *
 * The Silverfin API allows max 1 in-flight call per company, so the full
 * capture is intentionally sequential.
 *
 * @param {String} url Full Silverfin URL of the reconciliation/account
 * @param {Object} [opts]
 * @param {Boolean} [opts.full=false]
 * @returns {Promise<Object|null>}
 */
async function capture(url, opts = {}) {
  return opts.full ? captureFull(url) : captureScoped(url);
}

async function captureScoped(url) {
  const built = await liquidTestGenerator.buildLiquidTest(url, "capture", true);
  if (!built) {
    return null;
  }
  const snapshot = (built.liquidTestObject && built.liquidTestObject.capture) || {};
  return {
    mode: "scoped",
    handle: built.templateHandle,
    templateType: built.templateType,
    context: snapshot.context ?? null,
    data: snapshot.data ?? null,
    expectation: snapshot.expectation ?? null,
  };
}

async function captureFull(url) {
  const parameters = Utils.extractURL(url);
  const { firmId, companyId } = parameters;

  const out = { mode: "full", firmId, companyId, company: {}, periods: {} };

  // Company-level drop + customs
  const companyDrop = await SF.getCompanyDrop(firmId, companyId);
  out.company.drop = companyDrop?.data ?? null;
  const companyCustom = await SF.getCompanyCustom(firmId, companyId);
  out.company.custom = companyCustom?.data ?? null;

  // Every period
  const periods = await fetchAllPeriods(firmId, companyId);
  for (const period of periods) {
    const periodId = period.id;
    const key = period.fiscal_year?.end_date ? String(period.fiscal_year.end_date) : String(periodId);
    const periodEntry = { periodId, custom: [], workflows: {} };

    // Period-level customs (paginated internally)
    periodEntry.custom = (await SF.getAllPeriodCustom(firmId, companyId, periodId)) || [];

    // Workflows -> reconciliations (custom + results)
    const workflowsResponse = await SF.getWorkflows(firmId, companyId, periodId);
    const workflows = workflowsResponse?.data ?? [];
    for (const workflow of workflows) {
      const reconciliations = await fetchAllWorkflowReconciliations(firmId, companyId, periodId, workflow.id);
      const reconciliationsOut = {};
      for (const reconciliation of reconciliations) {
        const customResponse = await SF.getReconciliationCustom("firm", firmId, companyId, periodId, reconciliation.id);
        const resultsResponse = await SF.getReconciliationResults("firm", firmId, companyId, periodId, reconciliation.id);
        reconciliationsOut[reconciliation.handle || reconciliation.id] = {
          id: reconciliation.id,
          custom: customResponse?.data ?? null,
          results: resultsResponse?.data ?? null,
        };
      }
      const workflowKey = workflow.name ? `${workflow.name} (${workflow.id})` : String(workflow.id);
      periodEntry.workflows[workflowKey] = { id: workflow.id, reconciliations: reconciliationsOut };
    }

    out.periods[key] = periodEntry;
  }

  // Account-level customs are not included in --full: there is no list-accounts
  // endpoint wired into the CLI. Use scoped capture (or get-results) for accounts.
  consola.info("Full capture covers company/period/reconciliation customs + results. Account-level customs are only captured in scoped mode.");

  return out;
}

async function fetchAllPeriods(firmId, companyId) {
  const items = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const response = await SF.getPeriods(firmId, companyId, page);
    const data = response?.data ?? [];
    items.push(...data);
    if (data.length < PER_PAGE) {
      break;
    }
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
    if (data.length < PER_PAGE) {
      break;
    }
    page++;
  }
  return items;
}

module.exports = { capture, captureScoped, captureFull };
