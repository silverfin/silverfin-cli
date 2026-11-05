---
name: writing-tests
description: Use when writing, adding, or fixing a Jest test in this repo - a new suite under tests/, a case for a new or changed function, a regression test for a bug, or a failing suite that needs diagnosing. Also use when deciding how to mock sfApi, axios, consola, or the filesystem.
---

# Writing tests

Three harnesses live in this repo and they are not interchangeable. Pick by what the code under test touches, then follow that harness exactly — most test failures here come from using the wrong one, not from the assertion.

## Pick the harness

| Code under test | Harness | Lives in |
|---|---|---|
| A function in `lib/` with no HTTP and no disk | **Unit** | `tests/lib/**` |
| A function in `lib/api/sfApi.js` | **API** | `tests/lib/api/sfApi.test.js` |
| A `lib/templates/*.js` class, or anything that writes real files | **Temp-dir unit** | `tests/lib/templates/**`, `tests/lib/utils/**` |
| An `index.js` orchestration function, or a `bin/cli.js` command end to end | **E2E** | `tests/bin/cli/**` |

The suite path mirrors the source path: `lib/utils/fsUtils.js` → `tests/lib/utils/fsUtils.test.js`.

## Unit

Mock every external dependency — `sfApi`, `consola`, and the filesystem if it is touched. Assert on the return value and on which mocked functions were called with what.

## API

Only for `sfApi.js`. Intercept a real axios instance with `axios-mock-adapter` rather than mocking axios itself:

```js
jest.mock("../../../lib/utils/apiUtils", () => ({
  checkRequiredEnvVariables: jest.fn(),        // module-load env check must not run
  responseSuccessHandler: jest.fn(),
  responseErrorHandler: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../../lib/api/axiosFactory", () => ({
  AxiosFactory: { createInstance: jest.fn() },  // returns your controlled instance
}));
jest.mock("../../../lib/api/silverfinAuthorizer", () => ({ SilverfinAuthorizer: { /* ... */ } }));
```

Then have `AxiosFactory.createInstance` return the instance `AxiosMockAdapter` is attached to. Response bodies come from `fixtures/api-responses/<type>/single.json` or `list.json` — extend those rather than inlining a payload.

## Temp-dir unit

For template classes, where `save()`, `read()` and `updateTemplateId()` must write real files: `fs.mkdtempSync` plus `process.chdir` into it, inspect the files afterwards, and restore cwd in `afterEach`.

## E2E

Six steps, in this order, in every `tests/bin/cli/**` suite:

1. `fsPromises.mkdtemp` in `os.tmpdir()`, save `process.cwd()`, `process.chdir()` into the temp dir.
2. Copy `fixtures/market-repo/` in when the test needs pre-existing local state.
3. `jest.mock("../../../lib/api/sfApi")` and `jest.mock("consola")`; assign `jest.fn()` to the `consola` methods the code path uses.
4. Replace `process.exit` with `jest.fn()`, keeping the original. **Error paths call `process.exit(1)` and will kill the runner otherwise.**
5. Call the toolkit function directly — `require("../../../index")` — not the CLI binary.
6. `afterEach`: restore `process.cwd()`, restore `process.exit`, `rm` the temp dir with `{ recursive: true, force: true }`.

Start `beforeEach` with `jest.clearAllMocks()`.

## Assert on both sides

An E2E test that only checks `consola.success` was called has not tested anything. Assert on the filesystem result too — `config.json` contents, liquid files present with the right names — and on the API mock having been called with the expected arguments.

## Before you finish

- Run `npx jest <path>` on the suite and read the output. Do not report a test as passing without it.
- New exported function with no test? It is not done.
- Update the catalogue entry in [tests/TESTS.md](../../../tests/TESTS.md) for the suite you changed.

## Red flags

- Mocking `axios` directly instead of using `axios-mock-adapter` on a real instance
- An E2E test with no `process.exit` stub, or no `afterEach` cwd restore
- A large inline JSON payload that duplicates something in `fixtures/api-responses/`
- Writing test files anywhere other than the mirrored path
- `process.chdir` without a matching restore — it leaks into every later suite in the run
