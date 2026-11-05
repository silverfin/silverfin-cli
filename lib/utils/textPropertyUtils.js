const fs = require("fs");
const path = require("path");
const yaml = require("yaml");
const { consola } = require("consola");
const fsUtils = require("./fsUtils");

/**
 * Transform a YAML custom properties object into the Silverfin API format.
 * Input: flat object with dot-notation keys (e.g. "namespace.key.subkey": value)
 * Output: array of { namespace, key, value } objects
 */
function transformCustomToProperties(customData) {
  const namespaceMap = new Map();

  for (const [fullKey, value] of Object.entries(customData)) {
    const keyParts = fullKey.split(".");

    if (keyParts.length < 2) {
      consola.warn(`Skipping key "${fullKey}" — expected namespace.key format`);
      continue;
    }

    const namespace = keyParts[0];
    const key = keyParts[1];
    const namespaceKey = `${namespace}.${key}`;

    if (keyParts.length === 2) {
      if (!namespaceMap.has(namespaceKey)) {
        namespaceMap.set(namespaceKey, { namespace, key, value });
      }
    } else {
      if (!namespaceMap.has(namespaceKey)) {
        namespaceMap.set(namespaceKey, { namespace, key, value: {} });
      }
      const subKey = keyParts.slice(2).join(".");
      namespaceMap.get(namespaceKey).value[subKey] = value;
    }
  }

  return Array.from(namespaceMap.values());
}

/**
 * Resolve a YAML period key to a company period.
 * Captured YAML keys are the period's fiscal_year.end_date when present, otherwise the
 * period id (lib/dataCapture.js, lib/deepCapture.js). Several periods can share the same
 * fiscal_year.end_date (e.g. monthly bookkeeping periods within one fiscal year); in that
 * case the year-end period (own end_date === key) is the intended target. Refuses to pick
 * an arbitrary period when the key stays ambiguous.
 * Returns { period } on success, { error } with a reason otherwise.
 */
function findPeriodByKey(periodsArray, periodKey) {
  const key = String(periodKey);

  const byId = periodsArray.find((p) => String(p.id) === key);
  if (byId) return { period: byId };

  const byFiscalYear = periodsArray.filter((p) => p.fiscal_year?.end_date === key);
  if (byFiscalYear.length === 1) return { period: byFiscalYear[0] };
  if (byFiscalYear.length > 1) {
    const yearEnd = byFiscalYear.filter((p) => p.end_date === key);
    if (yearEnd.length === 1) return { period: yearEnd[0] };
    return { error: `Period key "${key}" is ambiguous: ${byFiscalYear.length} periods share that fiscal year end date` };
  }

  return { error: `Period "${key}" not found in company` };
}

/**
 * Read the test file path referenced by a template's config.json ("test" key).
 * Local read instead of fsUtils.readConfig: that helper creates a missing
 * config.json as a side effect and exits the process on parse errors — both
 * wrong while scanning across template folders.
 */
function readConfigTestPath(baseDir, dir) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(baseDir, dir, "config.json"), "utf-8"));
    return config.test || null;
  } catch {
    return null;
  }
}

/**
 * Find a test by name in the templates' liquid test YAML files.
 * Per template, only ONE file is considered: the one referenced by the template's
 * config.json "test" key (the same file run-test uses), or — when fileName is
 * provided — exactly tests/<fileName>, so year variants (e.g. *_TY25_*.yml) can be
 * selected explicitly. If handle is provided, only that template folder is searched.
 * When the test name matches in several templates, the match is refused instead of
 * guessing: the candidates are listed and --handle is requested.
 * Extracts custom data from all 4 levels: company, period, reconciliation, account.
 * Returns { file, handle, company, periods } where periods contains per-period custom,
 * reconciliation custom, and account custom data.
 */
function findTestData(testName, handle, fileName) {
  const templateType = "reconciliationText";
  const baseDir = path.join(process.cwd(), fsUtils.FOLDERS[templateType]);

  if (!fs.existsSync(baseDir)) {
    consola.error(`Directory not found: ${fsUtils.FOLDERS[templateType]}`);
    process.exit(1);
  }

  const handleDirs = handle ? [handle] : fs.readdirSync(baseDir).filter((entry) => {
    return fs.statSync(path.join(baseDir, entry)).isDirectory();
  });

  const matches = [];
  for (const dir of handleDirs) {
    const relativeTestPath = fileName ? path.join("tests", fileName) : readConfigTestPath(baseDir, dir);
    if (!relativeTestPath) continue;

    const filePath = path.join(baseDir, dir, relativeTestPath);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, "utf-8");
    let parsed;
    try {
      parsed = yaml.parse(content, { maxAliasCount: 10000, merge: true });
    } catch (error) {
      consola.warn(`Skipping malformed YAML file "${filePath}": ${error.message}`);
      continue;
    }

    if (!parsed || !parsed[testName]) continue;

    matches.push({ file: path.basename(relativeTestPath), handle: dir, testData: parsed[testName] });
  }

  if (matches.length === 0) {
    if (fileName) {
      consola.error(`Test "${testName}" not found in any YAML file named "${fileName}"`);
    } else {
      consola.error(
        `Test "${testName}" not found in any test file referenced by a template's config.json. Use --file <exact-file-name> to read a specific YAML file instead (e.g. a year variant not referenced in config.json).`
      );
    }
    process.exit(1);
  }

  if (matches.length > 1) {
    consola.error(`Test "${testName}" found in multiple templates:`);
    for (const match of matches) {
      consola.error(`  - ${match.handle}/tests/${match.file}`);
    }
    consola.error("Re-run with --handle <handle> to select one.");
    process.exit(1);
  }

  const { file, handle: dir, testData } = matches[0];
  const result = { file, handle: dir, company: null, periods: {} };

  // Company-level custom
  if (testData?.data?.company?.custom) {
    result.company = { custom: testData.data.company.custom };
  }

  // Period-level data
  const periods = testData?.data?.periods;
  if (periods) {
    for (const [periodKey, periodData] of Object.entries(periods)) {
      if (!periodData) continue;

      const periodEntry = { custom: null, reconciliations: {}, accounts: {} };

      // Period-level custom
      if (periodData.custom) {
        periodEntry.custom = periodData.custom;
      }

      // Reconciliation-level custom
      if (periodData.reconciliations) {
        for (const [reconHandle, reconData] of Object.entries(periodData.reconciliations)) {
          if (reconData?.custom) {
            periodEntry.reconciliations[reconHandle] = reconData.custom;
          }
        }
      }

      // Account-level custom
      if (periodData.accounts) {
        for (const [accountNumber, accountData] of Object.entries(periodData.accounts)) {
          if (accountData?.custom) {
            periodEntry.accounts[accountNumber] = accountData.custom;
          }
        }
      }

      result.periods[periodKey] = periodEntry;
    }
  }

  return result;
}

module.exports = { transformCustomToProperties, findTestData, findPeriodByKey };
