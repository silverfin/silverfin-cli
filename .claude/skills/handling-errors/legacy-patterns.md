# Legacy error-handling patterns

Seven patterns that are in the codebase today and are **not** the pattern to copy. This is a discussion list, not a fix list: when your change touches one, raise it with the dev in one line and let them decide the scope.

How to raise it, in your response — the pattern, the location, the cost, the smallest fix, and the call:

> `index.js:296` catches and prints the raw error. That means a missing config prints a stack instead of a sentence. I can route it through a named `errorUtils` function while I'm here (~5 lines), or leave it and note it. Which?

Fix it in the same change **only if** it is inside the block you were already editing and the fix is a few lines. Anything wider is a separate branch — say so and move on.

| # | Pattern | Where it lives | What it costs | Smallest fix |
|---|---|---|---|---|
| 1 | `consola.error(error); process.exit(1);` as the whole handler | ~27 catch blocks in `index.js` (e.g. `:30`, `:63`, `:296`, `:321`) | Prints an object or stack where a sentence belongs; bypasses `errorUtils`, against `docs/ARCHITECTURE.md` | Add a named function to `errorUtils.js`, call it, keep the raw error at `consola.debug` |
| 2 | `process.exit` inside a helper layer | `lib/utils/apiUtils.js:17`, `lib/utils/fsUtils.js:146,341`, `lib/utils/liquidTestUtils.js`, `lib/api/silverfinAuthorizer.js`, `lib/api/axiosFactory.js` | A helper cannot know it is not step 3 of a 200-template loop; kills the batch, skips spinner teardown, forces `process.exit` mocks in tests | Return falsy or `throw`; move the exit up to `index.js` or `bin/cli.js` |
| 3 | Empty or comment-only catch | `lib/utils/fsUtils.js:481` (`catch { continue }`) | Corrupt YAML is reported as absent YAML; the user has no way to find the bad file | `consola.debug` naming the file that was skipped and why |
| 4 | Cause discarded after recognising the error | `lib/utils/liquidTestUtils.js:61`, `lib/utils/fsUtils.js:279` | The one fact that explains the failure is gone even under `-v` | `consola.debug(error)` before the message |
| 5 | Interceptor exits on some statuses, returns `undefined` on others | `lib/utils/apiUtils.js:35-58` (404/400 return, 422/403 exit) | Callers get `undefined`, fail later as a `TypeError`, and route to `uncaughtErrors` — so a plain 404 asks the user to open an issue | Make the branch's contract explicit at the call site: check for the falsy return and report it as an expected failure |
| 6 | Exit codes that misreport the outcome | `lib/cli/utils.js:43` (user declines the prompt → exit 1), `lib/cli/spinner.js:34` (SIGINT → exit 0) | A deliberate cancel scripts as a failure; Ctrl-C scripts as a success. CI cannot tell what happened | Needs a decision on the convention before changing — always raise, never fix silently |
| 7 | No error subclasses; structure only exists as `{ kind }` on batch paths | `lib/utils/errorUtils.js` `print*BatchErrorSummary`, `index.js` `publishAll*` | Single-template paths have no way to carry a machine-readable reason, so each one re-invents ad-hoc branching | Out of scope for an incidental fix. A `class SilverfinError extends Error` is cross-cutting — propose it as its own piece of work |

Items 1 and 2 are the ones worth pushing on. Item 6 needs a product decision. Item 7 is a project, not a fix.
