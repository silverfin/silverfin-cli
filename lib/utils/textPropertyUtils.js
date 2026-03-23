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
 * Find a test by name across YAML files in a template's tests/ folder.
 * If handle is provided, only search that handle's folder.
 * If not, scan all reconciliation_texts folders.
 * Extracts custom data from all 4 levels: company, period, reconciliation, account.
 * Returns { file, handle, company, periods } where periods contains per-period custom,
 * reconciliation custom, and account custom data.
 */
function findTestData(testName, handle) {
  const templateType = "reconciliationText";
  const baseDir = path.join(process.cwd(), fsUtils.FOLDERS[templateType]);

  if (!fs.existsSync(baseDir)) {
    consola.error(`Directory not found: ${fsUtils.FOLDERS[templateType]}`);
    process.exit(1);
  }

  const handleDirs = handle ? [handle] : fs.readdirSync(baseDir).filter((entry) => {
    return fs.statSync(path.join(baseDir, entry)).isDirectory();
  });

  for (const dir of handleDirs) {
    const testsDir = path.join(baseDir, dir, "tests");
    if (!fs.existsSync(testsDir)) continue;

    const yamlFiles = fs.readdirSync(testsDir).filter((f) => f.endsWith(".yml"));

    for (const file of yamlFiles) {
      const filePath = path.join(testsDir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = yaml.parse(content, { maxAliasCount: 10000, merge: true });

      if (!parsed || !parsed[testName]) continue;

      const testData = parsed[testName];
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
  }

  consola.error(`Test "${testName}" not found in any YAML file`);
  process.exit(1);
}

module.exports = { transformCustomToProperties, findTestData };
