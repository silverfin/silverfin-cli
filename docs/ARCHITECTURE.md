# Architecture

A map of what each file is for and what belongs in it. Use it to decide **where** a new method goes — and to judge whether a generated method has been put in the right place.

## Rules of placement

1. **One layer per concern.** CLI parsing → orchestration → API/filesystem. Never skip a layer: `bin/cli.js` must not call `lib/api/sfApi.js` directly, and `lib/api/` must not touch the filesystem.
2. **Anything reused twice belongs in `lib/utils/`**, not copied.
3. **Template-shape knowledge lives in `lib/templates/`.** If a method knows about `text_parts`, `name_nl`, or config layout for a specific template type, it belongs there.
4. **A new method should be findable from its name alone.** `fetch*`/`publish*`/`new*` → `index.js`; `read*`/`create*`/`update*`/`find*` (HTTP) → `sfApi.js`; `list*`/`create*File|Folder`/`read|writeConfig` → `fsUtils.js`.
5. **Every exported function gets a test** in the mirrored path under `tests/`.

## Layers

```
bin/cli.js          command definitions, option parsing, input validation
  └─ index.js       orchestration: API call + file write, per template type
       ├─ lib/api/          HTTP to Silverfin, auth, credentials
       ├─ lib/templates/    serialise/deserialise a template to/from disk
       └─ lib/utils/        filesystem, parsing, errors, shared helpers
  └─ lib/cli/       everything else a command needs (stats, dev mode, updater)
```

---

## `bin/cli.js`

Commander program: one `.command()` block per CLI verb, each with `.option()`s, a short `.description()`, and an `.action()` that validates then delegates. Commands cover import/update/create per template type, `add`/`remove-shared-part`, `run-test`, `create-test`, `check-dependencies`, `authorize`, `stats`, `config`, `get-*-id`, `development-mode`, `generate-export-file`, `update`.

**Contains:** command wiring only. Validation is delegated to `lib/cli/utils.js`; work is delegated to `index.js` or a `lib/cli/` module.
**Does not contain:** business logic, HTTP calls, `fs` calls, or more than a few lines inside an `.action()`.

## `index.js`

Public library surface (`main` in package.json) and the orchestration layer. Every function takes `(type, envId, …)` where `type` is `"firm"` or `"partner"`.

Per template type (reconciliation text, export file, account template, shared part), the same quartet:

- `fetch<Type>ById` / `fetch<Type>ByHandle|ByName` — pull one template from the API and write it to disk
- `fetchAll<Type>s` / `fetchExisting<Type>s` — paginated pull; "existing" = only those already present locally
- `publish<Type>ById` / `publish<Type>ByName|ByHandle` / `publishAll<Type>s` — read from disk, push to the API
- `new<Type>` / `newAll<Type>s` — create a template that does not yet exist remotely

Plus shared-part linkage (`addSharedPart`, `addAllSharedParts`, `removeSharedPart`), ID lookup (`getTemplateId`, `getAllTemplatesId`) and `updateFirmName`.

**Contains:** the sequence "call the API → hand the payload to a `lib/templates/` class → report errors". New template-type operations go here, following the naming quartet above.
**Does not contain:** raw axios calls, `fs` calls, or `console.log` formatting beyond progress/error reporting.

---

## `lib/api/`

### `sfApi.js`
One thin function per Silverfin REST endpoint. Naming mirrors HTTP intent: `create*`, `read*`, `update*`, `find*ByName|ByHandle` (paginated search), plus `getPeriods`, `getCompanyDrop`, `getWorkflows`, `getAccountDetails`, `verifyLiquid`, `createTestRun`, `readTestRun`, `createPreviewRun`, `createExportFileInstance`, and the auth re-exports (`authorizeFirm`, `refreshFirmTokens`, `refreshPartnerToken`).

**Contains:** URL, params, and a response/error pass-through. Each function is a handful of lines.
**Does not contain:** retries (the axios interceptors do that), filesystem access, or business decisions. A new endpoint = a new small function here.

### `axiosFactory.js` — `AxiosFactory`
Builds configured axios instances. `createInstance(type, envId)`, `createAuthInstanceForFirm(envId)`; private statics build firm vs partner instances, attach token-refresh interceptors, and handle staging hosts / basic auth.
**Contains:** transport configuration and token-refresh-on-401 logic only.

### `firmCredentials.js` — exported singleton `firmCredentials`
Reads/writes `~/.silverfin/config.json`. Token pairs (`storeNewTokenPair`, `getTokenPair`), firm names, default firm (`set/getDefaultFirmId`), `listAuthorizedFirms`, partner API keys (`storePartnerApiKey`, `getPartnerCredentials`, `listAuthorizedPartners`), host (`set/getHost`).
**Contains:** the only code that reads or writes the credentials file. Any new stored setting gets a getter/setter pair here.

### `silverfinAuthorizer.js` — `SilverfinAuthorizer`
OAuth flow: `authorizeFirm`, `refreshFirm`, `refreshPartner`; private helpers prompt for the firm ID and auth code and open the browser.
**Contains:** the interactive authorisation dance. New auth flows go here, not in `sfApi.js`.

---

## `lib/templates/`

Four classes with an identical static shape — `ReconciliationText`, `AccountTemplate`, `ExportFile`, `SharedPart`. They are the only place that knows the on-disk layout of a template.

Each exposes:
- `save(type, envId, template)` — API payload → folders, `main.liquid`, text parts, `config.json`, liquid-test stub
- `read(handle|name)` — disk → API payload
- `updateTemplateId(type, envId, handle|name, templateId)` — record the remote ID in `config.json`

with private statics for config preparation, part filtering, locale defaults, folder-name validation, and main/parts liquid read+create. `SharedPart` additionally has `checkTemplateType` and `#processUsedIn` for the templates a shared part is linked to.

**Contains:** template-type-specific config keys and folder conventions.
**Does not contain:** HTTP calls. A new field on a template type belongs in that class's `#prepareConfigDetails` / `#filterConfigItems`, not in `index.js`.

---

## `lib/cli/`

### `utils.js`
Pre-flight checks shared by commands: `loadDefaultFirmId`, `checkDefaultFirm`, `handleUncaughtErrors`, `promptConfirmation`, `formatOption`, `checkDateFormat`, `checkHandleFormat`, `checkUniqueOption`, `checkRequiredFirmOrPartner`, `getCommandSettings`, `runCommandChecks`, `logCurrentHost`, `checkPartnerSupport`.
**Contains:** validation that ends in a clear message + `process.exit` on failure. All new option validation goes here so `bin/cli.js` stays declarative.

### `stats.js`
Coverage reporting over the local template repo. Entry points `generateOverview(sinceDate)` and `generateWorkflowOverview(sinceDate, workflowHandle)`; the rest are internal — counting templates and YAML tests (`getTemplatesSummary`, `getWorkflowTemplateSummary`, `yamlFilesActivity`, `countYamlFiles`), formatting (`displayOverview`, `createRow`, `percentageRoundTwo`) and CSV persistence (`saveOverviewToFile`, `saveWorkflowOverviewToFile`).
**Contains:** metrics and their presentation. Only the two `generate*` functions should be exported.

### `devMode.js`
`watchLiquidTest(...)` and `watchLiquidFiles(firmId)` — chokidar watchers that re-run tests or re-push liquid on save.

### `cliUpdater.js` — `CliUpdater`
`checkVersions()`, `performUpdate()`; privately fetches the latest npm version and compares semver.

### `changelogReader.js` — `ChangelogReader`
`fetchChanges(userVersion, updateVersion)` — extracts the CHANGELOG entries between two versions.

### `cwdValidator.js` — `CwdValidator`
`run()` — refuses to operate outside a templates repo.

### `autoCompletions.js` — `AutoCompletions`
`set()` — installs the shell completion script from `resources/autoCompletion`.

### `spinner.js`
Exported singleton `spinner` with `spin(text)`, `stop()`, `clear()`. The only terminal-animation code.

---

## `lib/` (top level)

### `liquidTestRunner.js`
Runs liquid tests against the API and renders the result. Public: `runTests`, `runTestsWithOutput`, `runTestsStatusOnly`, `getHTML`, `checkAllTestsErrorsPresent`, `checkTestErrorsPresent`. Internal: YAML scanning (`findTestRows`, `findAnchorDefinitions`, `findAliasReferences`, `extractAnchorBlocks`, `filterTestsByPattern`), request building (`buildTestParams`), polling (`fetchResult`), and output (`listErrors`, `processTestRunResponse`, `handleHTMLfiles`).
**Contains:** test-run lifecycle and terminal output for results.

### `liquidTestGenerator.js`
`testGenerator(url, testName, reconciledStatus)` — builds a YAML liquid test from a live Silverfin URL, using `lib/utils/liquidTestUtils.js` for the pieces.

### `exportFileInstanceGenerator.js` — `ExportFileInstanceGenerator`
`new ExportFileInstanceGenerator(firmId, companyId, periodId, exportFileId)` then `generateAndOpenFile()` — creates an export-file instance, polls it, opens the result.

---

## `lib/utils/`

### `fsUtils.js`
All filesystem access. Constants `FOLDERS`, `TEMPLATE_TYPES`, `WORKFLOWS_FOLDER`, `SILVERFIN_URL_PATHS`. Config I/O (`configExists`, `readConfig`, `writeConfig`, `createConfigIfMissing`, `getTemplateId`, `setTemplateId`); creation (`createFolder`, `createTemplateFolders`, `createSharedPartFolders`, `createTemplateFiles`, `createLiquidFile`, `createLiquidTestFiles`); discovery (`getAllTemplatesOfAType`, `findHandleByID`, `identifyTypeAndHandle`, `listExistingFiles`, `listExistingRelatedLiquidFiles`, `listSharedPartsUsedInTemplate`, `findTemplatesWithLiquidTests`, `scanTextParts`, `checkLiquidTestDependencies`); workflows (`getWorkflow`, `getAllWorkflowHandles`).
**Contains:** every `fs` call in the codebase. If a new method needs to read or write a file, it goes here and is called from elsewhere.

### `templateUtils.js`
Template-type vocabulary and name validation: `TEMPLATES_NAME_ATTRIBUTE`, `TEMPLATE_TYPE_NAMES`, `TEMPLATE_MAP_TYPES`, `FILE_NAME_PROBLEMS`, `getTemplateName`, `checkValidName`, `fileNameProblem`, `isSafeName`, `filterParts`, `missingLiquidCode`, `missingNameNL`.
**Contains:** the mapping between API type names and internal type keys. New template types are registered here first.

### `errorUtils.js`
`uncaughtErrors`, `errorHandler`, `missingConfig`, `missing<Type>Id`, and `print<Type>BatchErrorSummary` for each of the four template types.
**Contains:** every user-facing error message. New failure modes get a named function here rather than an inline `console.error`.

### `apiUtils.js`
`checkAuthorizePartners`, `checkRequiredEnvVariables`, `responseSuccessHandler`, `responseErrorHandler` — the axios interceptor callbacks.

### `liquidTestUtils.js`
Pure helpers for generating a liquid test: `createBaseLiquidTest`, `extractURL`, `generateFileName`, `exportYAML`, `processCustom`, `getCompanyDependencies`, `searchForResultsFromDependenciesInLiquid`, `searchForCustomsFromDependenciesInLiquid`, `lookForSharedPartsInLiquid`, `lookForAccountsIDs`.
**Contains:** parsing/transformation only — no HTTP, no `fs`.

### `runTestUtils.js`
`checkRenderMode(htmlInput, htmlPreview)` — resolves the render mode from CLI flags.

### `urlHandler.js` — `UrlHandler`
`new UrlHandler(url, customFilename)` + `openFile()` — downloads or resolves a file and opens it, de-duplicating filenames.

### `wslHandler.js` — `WSLHandler`
`isWSL()`, `open(filePath)` — opening files from WSL. All Windows/WSL-specific behaviour lives here.

---

## Supporting directories

| Path | Purpose |
|---|---|
| `tests/` | Jest suites mirroring `lib/` and `bin/`; see `tests/TESTS.md`. `tests/setup.js` holds global setup. |
| `fixtures/` | Test data: `api-responses/`, `market-repo/` (a fake templates repo), `silverfin/`. |
| `resources/` | Shipped assets: `autoCompletion/` shell script, `liquidTests/` README template. |
| `jest.config.js`, `eslint.config.js` | Test and lint configuration. |
| `CHANGELOG.md` | Read at runtime by `ChangelogReader` — keep the version-heading format intact. |

## Review checklist for new code

- Is the method in the layer that matches its name and its dependencies (`fs` → `fsUtils`, HTTP → `sfApi`)?
- Does it duplicate an existing helper in `lib/utils/`?
- If it is template-type-specific, does it live in the right `lib/templates/` class rather than in a `switch` in `index.js`?
- Is it exported only if callers outside the file need it?
- Does it have a test in the mirrored `tests/` path?
- Do error paths go through `errorUtils.js`?
