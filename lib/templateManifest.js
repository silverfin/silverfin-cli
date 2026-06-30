const Utils = require("./utils/liquidTestUtils");
const { ReconciliationText } = require("./templates/reconciliationText");
const { SharedPart } = require("./templates/sharedPart");
const fsUtils = require("./utils/fsUtils");
const { consola } = require("consola");

/**
 * Build a static DATA MANIFEST (scope) for a reconciliation template by scanning
 * its Liquid (main + text_parts + every shared part, recursively).
 *
 * The manifest describes the SCOPE of data the template reads — not a guaranteed
 * exhaustive key list (runtime-built references can't be resolved statically).
 * It is meant to drive a "deep capture": fetch everything within this scope, then
 * self-validate a render against the live results.
 */

function uniq(array) {
  return [...new Set(array)];
}

// Concatenate main + text_parts + shared-part liquid into one string for scanning.
function combinedText(objects) {
  const parts = [];
  for (const object of objects) {
    if (!object) continue;
    if (object.text) parts.push(object.text);
    if (Array.isArray(object.text_parts)) {
      for (const part of object.text_parts) parts.push((part && part.content) || "");
    }
  }
  return parts.join("\n");
}

// Recursively resolve the shared parts a template includes (and their nested ones).
async function gatherSharedParts(template, handle) {
  const objects = [];
  const seen = new Set();
  const missing = [];
  const queue = Utils.lookForSharedPartsInLiquid(template, handle) || [];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    let sharedPart = null;
    try {
      sharedPart = await SharedPart.read(name);
    } catch (error) {
      sharedPart = null;
    }
    if (!sharedPart || !sharedPart.text) {
      missing.push(name);
      continue;
    }
    objects.push(sharedPart);
    const nested = Utils.lookForSharedPartsInLiquid(sharedPart, name) || [];
    for (const nestedName of nested) {
      if (!seen.has(nestedName)) queue.push(nestedName);
    }
  }
  return { objects, names: objects.map((object) => object.name), missing };
}

async function buildManifest(handle) {
  const template = ReconciliationText.read(handle);
  if (!template) {
    consola.error(`Template "${handle}" was not found locally — run this from your templates repo.`);
    return null;
  }

  const { objects: sharedObjects, names: sharedParts, missing } = await gatherSharedParts(template, handle);

  // Cross-template results/customs via the existing (assign-aware) scanners,
  // across the template AND every shared part.
  let results = Utils.searchForResultsFromDependenciesInLiquid(template, handle);
  let customs = Utils.searchForCustomsFromDependenciesInLiquid(template, handle);
  for (const sharedPart of sharedObjects) {
    results = Utils.searchForResultsFromDependenciesInLiquid(sharedPart, sharedPart.name, results);
    customs = Utils.searchForCustomsFromDependenciesInLiquid(sharedPart, sharedPart.name, customs);
  }
  // A template's own results are not a cross-template dependency to fetch separately.
  delete results[handle];
  delete customs[handle];
  const crossTemplate = {};
  for (const dependencyHandle of uniq([...Object.keys(results), ...Object.keys(customs)])) {
    crossTemplate[dependencyHandle] = {
      results: results[dependencyHandle] || [],
      customs: customs[dependencyHandle] || [],
    };
  }

  const text = combinedText([template, ...sharedObjects]);

  // Own custom drop reads (standalone `custom.ns.key`, not `<x>.custom.ns.key`).
  const ownCustoms = uniq([...text.matchAll(/(?:^|[^.\w])custom\.([a-z0-9_]+)\.([a-z0-9_]+)/g)].map((m) => `custom.${m[1]}.${m[2]}`));

  // Period drop + prior-period depth (period.minus_Ny → how many prior years are read).
  let priorPeriodDepth = 0;
  for (const match of text.matchAll(/period\.minus_(\d+)y/g)) {
    priorPeriodDepth = Math.max(priorPeriodDepth, Number(match[1]));
  }
  const periodDrop = uniq([...text.matchAll(/\bperiod\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1])).filter(
    (field) => !["reconciliations", "accounts", "custom"].includes(field) && !/^minus_\d+y$/.test(field)
  );

  // Company drop (standard + custom).
  const companyCustom = uniq([...text.matchAll(/\bcompany\.custom\.([a-z0-9_]+)\.([a-z0-9_]+)/g)].map((m) => `${m[1]}.${m[2]}`));
  const companyStandard = uniq([...text.matchAll(/\bcompany\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1])).filter((field) => field !== "custom");

  // Accounts referenced directly (#number) + the configured account range.
  const accounts = uniq([...text.matchAll(/#(\d{3,})/g)].map((m) => `#${m[1]}`));
  let accountRange = null;
  try {
    const config = fsUtils.readConfig("reconciliationText", handle);
    accountRange = config && config.account_range ? config.account_range : null;
  } catch (error) {
    accountRange = null;
  }

  const rollforward = /rollforward/i.test(text);

  return {
    handle,
    ownCustoms,
    crossTemplate,
    periodDrop,
    priorPeriodDepth,
    companyDrop: { standard: companyStandard, custom: companyCustom },
    accounts,
    accountRange,
    sharedParts,
    missingSharedParts: missing,
    rollforward,
  };
}

module.exports = { buildManifest, combinedText };
