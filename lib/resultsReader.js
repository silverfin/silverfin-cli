const SF = require("./api/sfApi");
const Utils = require("./utils/liquidTestUtils");
const { resolveReconciliationTarget } = require("./targetResolver");
const { consola } = require("consola");

// A `resultCount` (+ an explanatory note when zero) so an empty results table is
// self-explanatory: it means the template isn't computing here (gated/not set up),
// NOT that the API is cached. Prevents the "set-custom didn't re-render" misread.
function resultSummary(results) {
  const resultCount = results && typeof results === "object" ? Object.keys(results).length : 0;
  const summary = { resultCount };
  if (resultCount === 0) {
    summary.note =
      "No results computed for this reconciliation in this company/period — the template is likely gated or not set up here (this is NOT a caching issue; live writes ARE reflected once the template actually computes). To verify template logic, use a liquid test (`run-test`) or the `render` command; to see live effects, use a company/period where it computes.";
  }
  return summary;
}

/**
 * Fetch the computed results and custom data of a reconciliation or account
 * in a LIVE company file, identified by its Silverfin URL.
 *
 * Returns a plain object (no I/O) so it is easy to test and to serialise.
 * Reuses the same getters and URL parsing as `create-test`.
 *
 * @param {String} url Full Silverfin URL of the reconciliation/account in the company file
 * @returns {Promise<Object|null>} { templateType, firmId, companyId, periodId, ... , results, custom } or null on failure
 */
async function fetchResults(url, opts = {}) {
  const parameters = Utils.extractURL(url);

  // --handle: read a SIBLING reconciliation in the same company/period.
  if (opts.handle) {
    const target = await resolveReconciliationTarget(url, opts.handle);
    if (target.error) {
      consola.error(target.error);
      return null;
    }
    const customResponse = await SF.getReconciliationCustom("firm", target.firmId, target.companyId, target.ledgerId, target.reconciliationId);
    const resultsResponse = await SF.getReconciliationResults("firm", target.firmId, target.companyId, target.ledgerId, target.reconciliationId);
    return {
      templateType: "reconciliationText",
      firmId: target.firmId,
      companyId: target.companyId,
      periodId: target.ledgerId,
      reconciliationId: target.reconciliationId,
      handle: target.handle,
      url: target.url,
      results: resultsResponse?.data ?? null,
      ...resultSummary(resultsResponse?.data),
      custom: customResponse?.data ?? null,
    };
  }

  switch (parameters.templateType) {
    case "reconciliationText": {
      const customResponse = await SF.getReconciliationCustom("firm", parameters.firmId, parameters.companyId, parameters.ledgerId, parameters.reconciliationId);
      const resultsResponse = await SF.getReconciliationResults("firm", parameters.firmId, parameters.companyId, parameters.ledgerId, parameters.reconciliationId);
      return {
        templateType: parameters.templateType,
        firmId: parameters.firmId,
        companyId: parameters.companyId,
        periodId: parameters.ledgerId,
        reconciliationId: parameters.reconciliationId,
        results: resultsResponse?.data ?? null,
        ...resultSummary(resultsResponse?.data),
        custom: customResponse?.data ?? null,
      };
    }
    case "accountTemplate": {
      const account = await SF.findAccountByNumber(parameters.firmId, parameters.companyId, parameters.ledgerId, parameters.accountId);
      const accountId = account?.account?.id;
      if (!accountId) {
        consola.error(`Account "${parameters.accountId}" could not be resolved in this company file.`);
        return null;
      }
      const customResponse = await SF.getAccountTemplateCustom("firm", parameters.firmId, parameters.companyId, parameters.ledgerId, accountId);
      const resultsResponse = await SF.getAccountTemplateResults("firm", parameters.firmId, parameters.companyId, parameters.ledgerId, accountId);
      return {
        templateType: parameters.templateType,
        firmId: parameters.firmId,
        companyId: parameters.companyId,
        periodId: parameters.ledgerId,
        accountNumber: account.account.number,
        accountId,
        results: resultsResponse?.data ?? null,
        ...resultSummary(resultsResponse?.data),
        custom: customResponse?.data ?? null,
      };
    }
    default:
      consola.error(`Unsupported template type for URL: ${url}`);
      return null;
  }
}

module.exports = { fetchResults, resultSummary };
