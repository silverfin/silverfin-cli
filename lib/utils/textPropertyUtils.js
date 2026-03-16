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
 * If not, scan all reconciliation_texts folders and use reconciliationId to disambiguate.
 * Returns { custom, handle, periodKey } or exits with an error.
 */
function findTestData(testName, handle, reconciliationId, firmId) {
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
    const testsDir = path.join(baseDir, dir, "tests");
    if (!fs.existsSync(testsDir)) continue;

    const yamlFiles = fs.readdirSync(testsDir).filter((f) => f.endsWith(".yml"));

    for (const file of yamlFiles) {
      const filePath = path.join(testsDir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = yaml.parse(content, { maxAliasCount: 10000 });

      if (!parsed || !parsed[testName]) continue;

      const testData = parsed[testName];
      const periods = testData?.data?.periods;
      if (!periods) continue;

      const periodKey = Object.keys(periods)[0];
      const reconciliations = periods[periodKey]?.reconciliations;
      if (!reconciliations) continue;

      for (const [reconHandle, reconData] of Object.entries(reconciliations)) {
        if (reconData?.custom) {
          matches.push({
            handle: dir,
            reconHandle,
            periodKey,
            custom: reconData.custom,
            file,
          });
        }
      }
    }
  }

  if (matches.length === 0) {
    consola.error(`Test "${testName}" not found in any YAML file`);
    process.exit(1);
  }

  if (matches.length === 1) {
    return matches[0];
  }

  // Multiple matches — disambiguate using reconciliationId from config.json
  if (reconciliationId && firmId) {
    for (const match of matches) {
      try {
        const config = fsUtils.readConfig(templateType, match.handle);
        const templateId = config?.id?.[firmId];
        if (String(templateId) === String(reconciliationId)) {
          return match;
        }
      } catch {
        // config not found for this handle, skip
      }
    }
  }

  consola.error(
    `Test "${testName}" found in multiple templates: ${matches.map((m) => m.handle).join(", ")}. ` +
    `Use --handle to specify which one.`
  );
  process.exit(1);
}

module.exports = { transformCustomToProperties, findTestData };
