---
name: handling-errors
description: Use when writing or changing a catch block, adding a process.exit, reporting a new failure mode, or handling ENOENT / EACCES / a 4xx API response in this repo - including "the CLI crashed with a stack trace", "it printed the whole error object", "it exited halfway through the batch", and errors that are silently swallowed.
---

# Handling errors in the CLI

Every failure this CLI reports is one of two things, and the user can tell them apart by what they see:

| Kind | Cause | What the user sees | Who prints it |
|---|---|---|---|
| **Expected failure** | Something in their repo, command, or firm is wrong: missing file, missing ID, bad date, 404, 403 | One sentence naming the thing, plus the next command to run | a named function in `lib/utils/errorUtils.js` |
| **Bug** | Our code is wrong: `TypeError`, `ReferenceError`, anything unrecognised | Stack trace, versions, and the "open an issue" banner | `errorUtils.uncaughtErrors` only |

**A stack trace is a bug report, not an error message.** Printing one for a missing file tells the user to open an issue about their own typo. Printing a bare sentence for a `TypeError` throws away the only evidence we would have had.

## Step 1 — Classify before you write the catch

Ask: can the user fix this without changing our code?

- **Yes** → expected failure. It needs a message in `errorUtils.js` and a next step.
- **No** → bug. Hand it to `errorUtils.errorHandler(error)` and write nothing else. `errorHandler` recognises `ENOENT` and routes everything else to `uncaughtErrors`.
- **Don't know yet** → recognise the cases you know (`error.code`, `error.response.status`) and let the rest fall through to `errorHandler`. Never let "don't know" become a generic message.

## Step 2 — Write the catch block

A catch block in this repo has four parts, in this order. Anything missing is a defect:

1. **Recognise** — branch on `error.code` (`ENOENT`, `EACCES`) or `error.response.status` (400, 403, 404, 422). One branch per case you can name.
2. **Report** — call a named function from `lib/utils/errorUtils.js`. New failure mode means a new function there, not an inline `consola.error` string. Messages go through `consola`, never `console.log`; suggested commands get `chalk.bold`.
3. **Keep the cause** — the raw error goes to `consola.debug(error)` so `-v` still shows it. Recognising an error is not a reason to discard it.
4. **Decide the exit** — see Step 3. Falling off the end of a catch block is a decision too, and usually the wrong one.

```javascript
// lib/utils/errorUtils.js — the message and the next step live here
function missingWorkflowConfig(handle) {
  consola.error(`Workflow ${handle}: config.json was not found in the workflows folder`);
  consola.log(`Try running: ${chalk.bold(`silverfin import-workflow --handle ${handle}`)}`);
  return false;
}

// the caller recognises, reports, keeps the cause, and decides
try {
  return await sfApi.readWorkflow(envId, handle);
} catch (error) {
  consola.debug(error);
  if (error.code === "ENOENT") {
    return errorUtils.missingWorkflowConfig(handle); // false — caller decides what next
  }
  errorUtils.errorHandler(error); // unrecognised: stack trace + issue URL
}
```

## Step 3 — Only the boundary exits

`process.exit` is a statement about the whole run, so only code that owns the whole run may call it.

| Layer | On failure |
|---|---|
`bin/cli.js`, `lib/cli/utils.js` | validate input up front and `process.exit(1)` — nothing has happened yet, so stopping is free
`index.js` | report through `errorUtils`, then exit or return depending on whether more work remains
`lib/utils/`, `lib/api/`, `lib/templates/` | `return` a falsy value or `throw`. **Never exit.** These modules do not know whether they are one step of a 200-template loop

`lib/utils/*` and `lib/api/*` do contain legacy `process.exit(1)` calls. They are the pattern to move away from, not the one to copy: an exit inside a helper cannot be tested without mocking `process.exit`, skips the spinner teardown, and kills a batch that had 199 templates left.

## Step 4 — In a loop, defer

A failure on template 3 of 200 must not end the run. Follow the deferred pattern already in `index.js` `publishAll*`: push a tagged object, keep going, summarise at the end.

```javascript
deferredErrors.push({ kind: "exception", handle, message, stack: error.stack });
// after the loop
errorUtils.printReconciliationBatchErrorSummary(deferredErrors);
```

`kind` is the repo's stand-in for custom error classes: `"missing_id"`, `"update_failed"`, `"exception"`. Reuse those three. A new kind means teaching the matching `print<Type>BatchErrorSummary` to print it — a kind nothing prints is a swallowed error.

## Step 5 — Touching existing code: raise the legacy pattern, don't silently fix it

Much of the existing error handling predates this skill. When your change lands in or next to code that matches one of the seven patterns in [legacy-patterns.md](legacy-patterns.md), read that file and name the match in your response: the pattern, the location, what it costs the user, the smallest fix, and whether you should do it now. Then let the dev choose.

Fix it in the same change only when it sits inside the block you were already editing and the fix is a few lines. Wider than that is a separate branch — say so rather than growing the diff.

Two failure modes here, both wrong:

- **Silently rewriting** surrounding error handling because it offends this skill. The diff stops being reviewable.
- **Silently copying** it because it is the local convention. New code follows Steps 1–4 even when its neighbours don't.

## Step 6 — Global handlers are already installed

`bin/cli.js` calls `cliUtils.handleUncaughtErrors()`, which wires `uncaughtException` and `unhandledRejection` to `uncaughtErrors`. Do not add `process.on` handlers elsewhere, and do not rely on them as your error handling: a promise that reaches them prints "open an issue" for what may be an ordinary missing file.

## Never

- **An empty catch.** `catch { continue }` with no message hides a corrupt YAML file as "not found". Log at `consola.debug` at minimum, and say what was skipped.
- **`consola.error(error)` as the whole handler.** It prints an object or a stack where a sentence belongs, and `process.exit(1)` after it means the user gets a crash for a typo.
- **A message that omits the identifier.** Every message names the handle, name, or path it is about — the user has 200 templates.
- **Discarding the cause.** `catch (err) { consola.error("The URL provided is not correct"); }` loses the one fact that would explain why.
- **`try`/`catch` as flow control.** If you are catching to test whether a file exists, call `configExists` instead.
- **Exposing raw axios errors.** They carry request URLs, params, and tokens. `apiUtils.responseErrorHandler` is where status codes get turned into messages; extend it rather than printing `error.response` at a call site.

## Red flags

- "I'll just `consola.error(error)` and exit here" — that is the pattern this skill exists to stop
- A `process.exit` in a file under `lib/utils/` or `lib/api/`
- A new error string typed directly into `index.js` or `bin/cli.js`
- A catch block whose `error` parameter is never read
- A batch loop with `process.exit(1)` inside it
- `errorHandler` called for a failure you could name — it will tell the user to open an issue
- "The file already does it this way, so I'll match it" — Step 5, not a licence
- A diff that quietly rewrites error handling the task never asked about

## Then test it

Error paths are the paths users hit. Add the case in the mirrored `tests/` path and run `npx jest <path>` before claiming it works. Use the **writing-tests** skill for how to mock `consola`, `sfApi`, and `process.exit` in this repo.
