const liquidTestRunner = require("./liquidTestRunner");

/**
 * Render a reconciliation template against its LOCAL liquid-test fixture via the
 * Silverfin render/test engine and return a structured JSON outcome.
 *
 * This is the DETERMINISTIC, fixture-driven way to verify what a template's code
 * produces — the right tool when a live company doesn't have the template's data
 * set up (where `get-results` would just return an empty results table). Unlike
 * `get-results` (which reflects a live company's actual state), this renders the
 * template against a fixture you control.
 *
 * Note: the render/test API reports expectation MISMATCHES (got vs expected), not
 * the full set of computed results — so to inspect a specific value, assert it in
 * the test's `expectation` block and read the `got` on mismatch.
 */
async function renderTemplate(firmId, handle, testName = "") {
  const result = await liquidTestRunner.runTests(firmId, "reconciliationText", handle, testName, false, "none", "");
  const testRun = result && result.testRun;
  if (!testRun) return null;

  const failures = testRun.tests || {};
  const failedNames = Object.keys(failures);
  const rendered = testRun.status === "completed" || testRun.status === "test_success";

  return {
    handle,
    status: testRun.status,
    rendered,
    allExpectationsPassed: rendered && failedNames.length === 0,
    failures, // per-test: { reconciled, results (got vs expected), rollforwards }
    note:
      failedNames.length === 0
        ? "Rendered against the local fixture. To inspect a specific result value, assert it in the test's `expectation` block — the render reports got-vs-expected on mismatch."
        : `${failedNames.length} test(s) had expectation mismatches — see failures (got vs expected).`,
  };
}

module.exports = { renderTemplate };
