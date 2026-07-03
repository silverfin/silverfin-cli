const SF = require("./api/sfApi");
const Utils = require("./utils/liquidTestUtils");

/**
 * Resolve which reconciliation a command should act on: the one in the URL, or a
 * SIBLING in the same company/period identified by a handle (`--handle`). This lets
 * read commands (get-results / describe-inputs / capture) inspect an upstream
 * template without the user having to reconstruct its URL.
 */

const PER_PAGE = 200;
const MAX_PAGES = 50;

// handle -> { id, workflowId, name } for a period (loops workflows, returns the
// workflow so a URL can be reconstructed). Null if not found.
async function findReconciliationWithWorkflow(firmId, handle, companyId, periodId) {
  const workflowsResponse = await SF.getWorkflows(firmId, companyId, periodId);
  const workflows = workflowsResponse?.data ?? [];
  for (const workflow of workflows) {
    let page = 1;
    while (page <= MAX_PAGES) {
      const response = await SF.getWorkflowInformation(firmId, companyId, periodId, workflow.id, page);
      const reconciliations = response?.data ?? [];
      const match = reconciliations.find((r) => r.handle === handle);
      if (match) return { id: match.id, workflowId: workflow.id, name: match.name };
      if (reconciliations.length < PER_PAGE) break;
      page++;
    }
  }
  return null;
}

function buildReconciliationUrl(p) {
  if (!p.workflowId || !p.reconciliationId) return null;
  return `https://live.getsilverfin.com/f/${p.firmId}/${p.companyId}/ledgers/${p.ledgerId}/workflows/${p.workflowId}/reconciliation_texts/${p.reconciliationId}`;
}

/**
 * @param {String} url
 * @param {String} [handleOverride] target a sibling reconciliation by handle instead of the URL's target
 * @returns {Promise<Object>} URL parameters with handle/reconciliationId (and workflowId+url when resolved by handle), or { error }
 */
async function resolveReconciliationTarget(url, handleOverride) {
  const parameters = Utils.extractURL(url);

  if (handleOverride) {
    const found = await findReconciliationWithWorkflow(parameters.firmId, handleOverride, parameters.companyId, parameters.ledgerId);
    if (!found) {
      return { error: `Reconciliation "${handleOverride}" not found in period ${parameters.ledgerId} of company ${parameters.companyId}.` };
    }
    const resolved = {
      ...parameters,
      templateType: "reconciliationText",
      reconciliationId: found.id,
      workflowId: found.workflowId,
      handle: handleOverride,
    };
    resolved.url = buildReconciliationUrl(resolved);
    return resolved;
  }

  // No override: resolve the URL target's handle (for reconciliations) so callers have it.
  if (parameters.templateType === "reconciliationText") {
    const details = await SF.readReconciliationTextDetails("firm", parameters.firmId, parameters.companyId, parameters.ledgerId, parameters.reconciliationId);
    parameters.handle = details?.data?.handle || null;
  }
  return parameters;
}

module.exports = { resolveReconciliationTarget, findReconciliationWithWorkflow, buildReconciliationUrl };
