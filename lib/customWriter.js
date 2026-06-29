const SF = require("./api/sfApi");
const Utils = require("./utils/liquidTestUtils");
const { consola } = require("consola");
const fs = require("fs");

/**
 * Coerce a CLI string value into its natural JS type when possible
 * (numbers, booleans, JSON objects/arrays), otherwise keep it as a string.
 * e.g. "10" -> 10, "true" -> true, '{"a":1}' -> {a:1}, "hello" -> "hello".
 */
function coerceValue(raw) {
  if (raw === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Build the array of {namespace, key, value} property objects to write.
 * For deletes, value is forced to null (soft-delete).
 */
function buildProperties(options, del) {
  if (options.file) {
    const parsed = JSON.parse(fs.readFileSync(options.file, "utf-8"));
    if (!Array.isArray(parsed)) {
      throw new Error("--file must contain a JSON array of {namespace, key[, value]} objects");
    }
    return parsed.map((property) => ({
      namespace: property.namespace,
      key: property.key,
      value: del ? null : property.value,
    }));
  }

  if (!options.namespace || !options.key) {
    throw new Error("--namespace and --key are required (or use --file)");
  }
  if (!del && options.value === undefined) {
    throw new Error("--value is required for set-custom (or use --file)");
  }

  return [{ namespace: options.namespace, key: options.key, value: del ? null : coerceValue(options.value) }];
}

/**
 * Resolve the write target from the URL + options and assemble an apply()
 * closure that calls the correct level-specific update function. Returns null
 * (after logging) when the target/property set cannot be resolved.
 *
 * @param {String} url
 * @param {Object} options CLI options (level, namespace, key, value, handle, account, file)
 * @param {Object} [meta]
 * @param {Boolean} [meta.del=false]
 * @returns {Promise<Object|null>} { level, firmId, companyId, targetDesc, properties, apply }
 */
async function prepareWrite(url, options, { del = false } = {}) {
  const parameters = Utils.extractURL(url);
  const level = options.level || (parameters.templateType === "accountTemplate" ? "account" : "reconciliation");

  let properties;
  try {
    properties = buildProperties(options, del);
  } catch (error) {
    consola.error(error.message);
    return null;
  }

  let apply;
  let targetDesc;
  switch (level) {
    case "company":
      targetDesc = `company ${parameters.companyId}`;
      apply = () => SF.updateCompanyCustom(parameters.firmId, parameters.companyId, properties);
      break;
    case "period":
      targetDesc = `period ${parameters.ledgerId}`;
      apply = () => SF.updatePeriodCustom(parameters.firmId, parameters.companyId, parameters.ledgerId, properties);
      break;
    case "reconciliation": {
      let reconciliationId = parameters.reconciliationId;
      if (options.handle) {
        const reconciliation = await SF.findReconciliationInWorkflows(parameters.firmId, options.handle, parameters.companyId, parameters.ledgerId);
        if (!reconciliation) {
          consola.error(`Reconciliation "${options.handle}" not found in any workflow.`);
          return null;
        }
        reconciliationId = reconciliation.id;
      }
      if (!reconciliationId) {
        consola.error("No reconciliation id found in the URL; pass --handle to target a reconciliation.");
        return null;
      }
      targetDesc = `reconciliation ${reconciliationId}`;
      apply = () => SF.updateReconciliationCustom(parameters.firmId, parameters.companyId, parameters.ledgerId, reconciliationId, properties);
      break;
    }
    case "account": {
      const accountNumber = options.account || parameters.accountId;
      if (!accountNumber) {
        consola.error("No account number found; pass --account to target an account.");
        return null;
      }
      const account = await SF.findAccountByNumber(parameters.firmId, parameters.companyId, parameters.ledgerId, accountNumber);
      if (!account?.account?.id) {
        consola.error(`Account "${accountNumber}" could not be resolved in this company file.`);
        return null;
      }
      const accountId = account.account.id;
      targetDesc = `account ${accountNumber}`;
      apply = () => SF.updateAccountCustom(parameters.firmId, parameters.companyId, parameters.ledgerId, accountId, properties);
      break;
    }
    default:
      consola.error(`Unknown level "${level}". Use company | period | reconciliation | account.`);
      return null;
  }

  return { level, firmId: parameters.firmId, companyId: parameters.companyId, targetDesc, properties, apply };
}

module.exports = { prepareWrite, buildProperties, coerceValue };
