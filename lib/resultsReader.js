const SF = require("./api/sfApi");
const Utils = require("./utils/liquidTestUtils");
const { consola } = require("consola");

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
async function fetchResults(url) {
  const parameters = Utils.extractURL(url);

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
        custom: customResponse?.data ?? null,
      };
    }
    default:
      consola.error(`Unsupported template type for URL: ${url}`);
      return null;
  }
}

module.exports = { fetchResults };
