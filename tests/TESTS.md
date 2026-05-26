# Test Suite Documentation

## Running tests

```bash
npm test                        # run all tests
npm test -- --watch             # watch mode
npm test -- --testPathPattern=tests/lib/toolkit.test.js  # run a single file
```

## Structure

```text
tests/
├── TESTS.md                         # this file
├── bin/
│   └── cli/                         # E2E command tests (real FS + mocked API)
│       ├── import-reconciliation.test.js
│       ├── update-reconciliation.test.js
│       ├── create-reconciliation.test.js
│       ├── get-reconciliation-id.test.js
│       ├── import-export-file.test.js
│       ├── update-export-file.test.js
│       ├── create-export-file.test.js
│       ├── get-export-file-id.test.js
│       ├── import-account-template.test.js
│       ├── update-account-template.test.js
│       ├── create-account-template.test.js
│       ├── get-account-template-id.test.js
│       ├── import-shared-part.test.js
│       ├── update-shared-part.test.js
│       ├── create-shared-part.test.js
│       └── get-shared-part-id.test.js
└── lib/
    ├── api/
    │   ├── axiosFactory.test.js
    │   ├── firmCredentials.test.js
    │   ├── sfApi.test.js            # HTTP-level API tests with axios-mock-adapter
    │   └── silverfinAuthorizer.test.js
    ├── cli/
    │   ├── changelogReader.spec.js
    │   ├── cliUpdater.spec.js
    │   ├── cwdValidator.spec.js
    │   └── utils.test.js
    ├── templates/
    │   ├── reconciliationTexts.test.js
    │   ├── exportFiles.test.js
    │   ├── accountTemplates.test.js
    │   └── sharedParts.test.js
    ├── utils/
    │   ├── apiUtils.test.js
    │   ├── checkLiquidTestDependencies.test.js
    │   ├── findTemplatesWithLiquidTests.test.js
    │   ├── fsUtils.test.js
    │   ├── liquidTestUtils.test.js
    │   ├── templateUtils.test.js
    │   └── urlHandler.test.js
    ├── exportFileInstanceGenerator.test.js
    ├── liquidTestGenerator.test.js
    ├── liquidTestRunner.test.js
    └── toolkit.test.js
```

## Fixtures

Test fixtures live under `fixtures/` and are shared across all test files:

```text
fixtures/
├── api-responses/                   # JSON shapes returned by the Silverfin API
│   ├── reconciliation-texts/
│   │   ├── single.json
│   │   └── list.json
│   ├── account-templates/
│   │   ├── single.json
│   │   └── list.json
│   ├── export-files/
│   │   ├── single.json
│   │   └── list.json
│   └── shared-parts/
│       ├── single.json
│       └── list.json
└── market-repo/                     # On-disk structure of a typical project
    ├── reconciliation_texts/        # 3 sample reconciliation texts
    ├── account_templates/           # 3 sample account templates
    ├── export_files/                # 3 sample export files
    └── shared_parts/                # 3 sample shared parts
```

`fixtures/api-responses/` fixtures represent the JSON objects the Silverfin API returns.
`fixtures/market-repo/` fixtures represent the filesystem layout written by the CLI.

## Test patterns

### Unit tests (`tests/lib/**`)

Mock all external dependencies (`sfApi`, `consola`, filesystem if needed).
Assert on return values and on which mocked functions were called.

Template class tests (`reconciliationTexts`, `exportFiles`, `accountTemplates`, `sharedParts`)
use a real temporary directory (`fs.mkdtempSync` + `process.chdir`) so that
`save()`, `read()`, and `updateTemplateId()` can write actual files and then be
inspected.

### API tests (`tests/lib/api/sfApi.test.js`)

Use `axios-mock-adapter` to intercept HTTP requests on a real axios instance.
`AxiosFactory.createInstance` is mocked to return that controlled instance.
`apiUtils.checkRequiredEnvVariables` is mocked so the module can be `require()`d
without env-var setup.

### E2E tests (`tests/bin/cli/**`)

Each file:
1. Creates a temporary directory in `os.tmpdir()` and `process.chdir()` into it.
2. Copies the `fixtures/market-repo/` tree into that directory where the test
   needs pre-existing local state.
3. Mocks `lib/api/sfApi` (all methods) and `consola`.
4. Calls toolkit functions directly (`require('../../../index')`).
5. Asserts on `consola.success/error/warn` calls and on the resulting filesystem
   state (config.json content, liquid file presence).
6. In `afterEach`, restores `process.cwd()` to the project root and removes the
   temp directory.

The `process.exit` is replaced with `jest.fn()` for the duration of each test so
that error-path code that calls `process.exit(1)` does not terminate the runner.

---

## Test Catalogue

### `tests/bin/cli/create-account-template.test.js`
Source: `index.js` → `lib/templates/accountTemplate.js`

| Function | Test | Description |
|---|---|---|
| `newAccountTemplate` | should create account template and store new id on success | Verifies that the API is called with the template payload, the response ID is persisted in `config.json`, and a success message is logged. |
| `newAccountTemplate` | should skip creation when account template already exists remotely | Verifies that when the remote look-up returns an existing template the create API is not called and a warning is logged. |

---

### `tests/bin/cli/create-export-file.test.js`
Source: `index.js` → `lib/templates/exportFile.js`

| Function | Test | Description |
|---|---|---|
| `newExportFile` | should create export file and store new id on success | Verifies that the API is called, the returned ID is written to `config.json`, and a success message is logged. |
| `newExportFile` | should skip creation when export file already exists remotely | Verifies that when the remote look-up finds an existing export file the create API is not called and a warning is logged. |

---

### `tests/bin/cli/create-reconciliation.test.js`
Source: `index.js` → `lib/templates/reconciliationText.js`

| Function | Test | Description |
|---|---|---|
| `newReconciliation` | should create reconciliation and store new id on success | Verifies the reconciliation is POSTed to the API, the returned ID is stored in `config.json`, and a success message is logged. |
| `newReconciliation` | should skip creation when reconciliation already exists on remote | Verifies that when a matching handle is found remotely the create API is not called and a warning is logged. |

---

### `tests/bin/cli/create-shared-part.test.js`
Source: `index.js` → `lib/templates/sharedPart.js`

| Function | Test | Description |
|---|---|---|
| `newSharedPart` | should create shared part and store new id on success | Verifies the shared part is created via the API, the ID is persisted in `config.json`, and a success message is logged. |
| `newSharedPart` | should skip creation when shared part already exists remotely | Verifies that when the remote look-up returns an existing shared part the create API is not called and a warning is logged. |

---

### `tests/bin/cli/get-account-template-id.test.js`
Source: `index.js` → `lib/templates/accountTemplate.js`

| Function | Test | Description |
|---|---|---|
| `getTemplateId` | should store the account template id and return true when found | Verifies that when the API locates the template the ID is saved in `config.json`, a success message is logged, and the function returns `true`. |
| `getTemplateId` | should warn and return false when account template not found | Verifies that when the API returns nothing a warning is logged and the function returns `false`. |

---

### `tests/bin/cli/get-export-file-id.test.js`
Source: `index.js` → `lib/templates/exportFile.js`

| Function | Test | Description |
|---|---|---|
| `getTemplateId` | should store the export file id and return true when found | Verifies that the found ID is written to `config.json`, a success message is logged, and the function returns `true`. |
| `getTemplateId` | should warn and return false when export file not found | Verifies that when the API returns nothing a warning is logged and the function returns `false`. |

---

### `tests/bin/cli/get-reconciliation-id.test.js`
Source: `index.js` → `lib/templates/reconciliationText.js`

| Function | Test | Description |
|---|---|---|
| `getTemplateId` | should store the reconciliation id and return true when found | Verifies that the remote ID is written to `config.json`, a success message is logged, and the function returns `true`. |
| `getTemplateId` | should warn and return false when reconciliation not found | Verifies that when the API returns nothing a warning is logged and the function returns `false`. |

---

### `tests/bin/cli/get-shared-part-id.test.js`
Source: `index.js` → `lib/templates/sharedPart.js`

| Function | Test | Description |
|---|---|---|
| `getTemplateId` | should store the shared part id and return true when found | Verifies that the remote ID is written to `config.json`, a success message is logged, and the function returns `true`. |
| `getTemplateId` | should warn and return false when shared part not found | Verifies that when the API returns nothing a warning is logged and the function returns `false`. |

---

### `tests/bin/cli/import-account-template.test.js`
Source: `index.js` → `lib/templates/accountTemplate.js`

| Function | Test | Description |
|---|---|---|
| `fetchAccountTemplateById` | should import account template and create necessary files | Verifies that `main.liquid` and `config.json` are created on disk and a success message is logged after a successful API fetch by ID. |
| `fetchAccountTemplateById` | should log error and exit when account template not found | Verifies that an error is logged and `process.exit(1)` is called when the API returns null for the given ID. |
| `fetchAccountTemplateByName` | should import account template when found by name | Verifies that the API is queried by name, the files are created on disk, and a success message is logged. |
| `fetchAccountTemplateByName` | should log error and exit when account template not found by name | Verifies that an error is logged and `process.exit(1)` is called when the name look-up returns null. |

---

### `tests/bin/cli/import-export-file.test.js`
Source: `index.js` → `lib/templates/exportFile.js`

| Function | Test | Description |
|---|---|---|
| `fetchExportFileById` | should import export file and create necessary files | Verifies that `main.liquid` and `config.json` are created on disk and a success message is logged after a successful fetch by ID. |
| `fetchExportFileById` | should log error and exit when export file not found | Verifies that an error is logged and `process.exit(1)` is called when the API returns null for the given ID. |
| `fetchExportFileByName` | should import export file when found by name | Verifies that the name look-up succeeds, files are created on disk, and a success message is logged. |
| `fetchExportFileByName` | should log error and exit when export file not found by name | Verifies that an error is logged and `process.exit(1)` is called when the name look-up returns null. |

---

### `tests/bin/cli/import-reconciliation.test.js`
Source: `index.js` → `lib/templates/reconciliationText.js`

| Function | Test | Description |
|---|---|---|
| `fetchReconciliationById` | should import the reconciliation by ID and create all necessary files | Verifies that `main.liquid`, text-part files, YAML test file, and `config.json` are created with correct content when importing a new reconciliation from a firm. |
| `fetchReconciliationById` | should import the reconciliation and update necessary existing files | Verifies that existing liquid files are overwritten with API data while the pre-existing YAML test file is preserved when re-importing an existing reconciliation. |
| `fetchReconciliationById` | should import reconciliation and create necessary files (partner, new) | Verifies that when importing from a partner environment the ID is stored under `partner_id` instead of `id` in `config.json`. |
| `fetchReconciliationById` | should import the reconciliation and update necessary files (partner, existing) | Verifies that an existing partner reconciliation is updated and the `partner_id` mapping is preserved correctly. |
| `fetchReconciliationById` | should handle reconciliation not found by ID | Verifies that when the API returns no data an error message is logged and `process.exit(1)` is called without creating any files. |
| `fetchReconciliationById` | should handle API error when fetching by ID | Verifies that an API rejection is caught, an error is logged, and `process.exit(1)` is called without creating any files. |
| `fetchReconciliationByHandle` | should find reconciliation by handle remotely when not local | Verifies that when no local config exists the handle is looked up remotely and the reconciliation is then fetched by its resolved ID. |

---

### `tests/bin/cli/import-shared-part.test.js`
Source: `index.js` → `lib/templates/sharedPart.js`

| Function | Test | Description |
|---|---|---|
| `fetchSharedPartById` | should import shared part and create necessary files | Verifies that the liquid file and `config.json` are created on disk and a success message is logged after a successful fetch by ID. |
| `fetchSharedPartById` | should log error and exit when shared part not found | Verifies that an error is logged and `process.exit(1)` is called when the API returns null data for the given ID. |
| `fetchSharedPartByName` | should import shared part when found by name | Verifies that the name look-up resolves to an ID, the full record is then fetched, files are created, and a success message is logged. |
| `fetchSharedPartByName` | should log error and exit when shared part not found by name | Verifies that an error is logged, `process.exit(1)` is called, and the detail API is never invoked when the name look-up returns null. |

---

### `tests/bin/cli/update-account-template.test.js`
Source: `index.js` → `lib/templates/accountTemplate.js`

| Function | Test | Description |
|---|---|---|
| `publishAccountTemplateByName` | should update account template when config and id exist | Verifies that the update API is called with the correct ID from `config.json` and a success message is logged. |
| `publishAccountTemplateByName` | should return false when config does not exist | Verifies that the update API is not called and `false` is returned when there is no local config file. |
| `publishAccountTemplateByName` | should return false when config has no matching firm id | Verifies that the update API is not called and `false` is returned when the config has no entry for the requested firm. |
| `publishAccountTemplateById` | should update account template when matching local template found by id | Verifies that when a local template is matched by its remote ID the update API is called and a success message is logged. |
| `publishAccountTemplateById` | should return false when no local account template has the given id | Verifies that when no local template matches the given ID an error is logged and `false` is returned. |

---

### `tests/bin/cli/update-export-file.test.js`
Source: `index.js` → `lib/templates/exportFile.js`

| Function | Test | Description |
|---|---|---|
| `publishExportFileByName` | should update export file when config and id exist | Verifies the update API is called with the correct ID and a success message is logged. |
| `publishExportFileByName` | should return false when config does not exist | Verifies the update API is not called and `false` is returned when no local config is present. |
| `publishExportFileByName` | should return false when config has no matching firm id | Verifies the update API is not called and `false` is returned when the config has no entry for the firm. |
| `publishExportFileById` | should update export file when matching local file found by id | Verifies that the update API is called and a success message is logged when a local file is matched by its remote ID. |
| `publishExportFileById` | should return false when no local export file has the given id | Verifies that when no local template matches the given ID an error is logged and `false` is returned. |

---

### `tests/bin/cli/update-reconciliation.test.js`
Source: `index.js` → `lib/templates/reconciliationText.js`

| Function | Test | Description |
|---|---|---|
| `publishReconciliationByHandle` | should update reconciliation when config and id exist | Verifies the update API is called with the correct ID derived from `config.json` and a success message is logged. |
| `publishReconciliationByHandle` | should return false when config file does not exist | Verifies the update API is not called and `false` is returned when there is no local config. |
| `publishReconciliationByHandle` | should return false when config has no matching firm id | Verifies the update API is not called and `false` is returned when the config lacks an entry for the requested firm. |
| `publishReconciliationById` | should update reconciliation when matching handle found by ID | Verifies the update API is called with the correct ID and a success message is logged when a local template is resolved from the given ID. |
| `publishReconciliationById` | should return false when no local template has the given id | Verifies that when no local template matches the ID an error is logged and `false` is returned. |

---

### `tests/bin/cli/update-shared-part.test.js`
Source: `index.js` → `lib/templates/sharedPart.js`

| Function | Test | Description |
|---|---|---|
| `publishSharedPartByName` | should update shared part when config and id exist | Verifies the update API is called with the correct ID and a success message is logged. |
| `publishSharedPartByName` | should return false when config does not exist | Verifies the update API is not called and `false` is returned when there is no local config. |
| `publishSharedPartByName` | should return false when config has no matching firm id | Verifies the update API is not called and `false` is returned when the config has no entry for the firm. |
| `publishSharedPartById` | should update shared part when matching local shared part found by id | Verifies the update API is called and a success message is logged when a local part is matched by its remote ID. |
| `publishSharedPartById` | should return false when no local shared part has the given id | Verifies that when no local template matches the ID an error is logged and `false` is returned. |

---

### `tests/lib/api/axiosFactory.test.js`
Source: `lib/api/axiosFactory.js`

| Function | Test | Description |
|---|---|---|
| `AxiosFactory.createInstance` | should throw an error for invalid type | Verifies that passing an unsupported type logs an error and terminates the process with code 1. |
| `AxiosFactory.createInstance` (firm) | should create a valid instance | Verifies that a firm instance has the correct `baseURL` and `Authorization` header set from stored tokens. |
| `AxiosFactory.createInstance` (firm) | should throw an error for missing tokens and terminate process | Verifies that when no token pair is stored for the firm an error is logged and the process exits with code 1. |
| `AxiosFactory.createInstance` (firm) | should refresh tokens on 401 Unauthorized error | Verifies that a 401 response triggers a token refresh POST, new tokens are stored, and the original request is retried successfully. |
| `AxiosFactory.createInstance` (firm) | should attempt to refresh tokens only once on 401 and terminate the process | Verifies that when the token refresh itself returns 401 the process exits with code 1 after exactly one refresh attempt. |
| `AxiosFactory.createInstance` (firm) | should throw any other response errors | Verifies that non-401 HTTP errors (e.g. 404) are rethrown without triggering a refresh or exiting the process. |
| `AxiosFactory.createInstance` (firm) | should throw the error again if there is no response | Verifies that network-level errors (no HTTP response) are rethrown without triggering a refresh or process exit. |
| `AxiosFactory.createInstance` (partner) | should create a valid instance | Verifies that a partner instance has the correct `baseURL` and no `Authorization` header. |
| `AxiosFactory.createInstance` (partner) | should add partner_id and api_key to requests params | Verifies that every outgoing request automatically includes `api_key` and `partner_id` query parameters. |
| `AxiosFactory.createInstance` (partner) | should throw an error for missing API key and terminate process | Verifies that when no partner credentials are stored an error is logged and the process exits. |
| `AxiosFactory.createInstance` (partner) | should refresh API key on 401 Unauthorized error | Verifies that a 401 triggers an API key refresh, the new key is stored, and the original request is retried with the new key. |
| `AxiosFactory.createInstance` (partner) | should attempt to refresh API key only once on 401 and terminate the process | Verifies that when the API key refresh itself returns 401 the process exits after one refresh attempt. |
| `AxiosFactory.createInstance` (partner) | should throw any other response error | Verifies that non-401 HTTP errors are rethrown without triggering a refresh or process exit. |
| `AxiosFactory.createInstance` (partner) | should throw the error again if there is no response | Verifies that network-level errors are rethrown without triggering a refresh or process exit. |
| `AxiosFactory.createInstance` (staging) | should raise an error if environment variable is not set | Verifies that using a staging host without `SF_BASIC_AUTH` set causes an error and process exit. |
| `AxiosFactory.createInstance` (staging) | should use basic auth for firm instance in staging | Verifies that a staging firm instance uses a `Basic` `Authorization` header and passes the access token as a query parameter. |
| `AxiosFactory.createInstance` (staging) | should use basic auth for partner instance in staging | Verifies that a staging partner instance uses a `Basic` `Authorization` header with credentials in query params. |
| `AxiosFactory.createAuthInstanceForFirm` | should not thrown an error for missing tokens | Verifies that the auth instance is created successfully even when no tokens are stored, without logging errors or exiting. |
| `AxiosFactory.createAuthInstanceForFirm` | should not attempt to refresh tokens | Verifies that a 401 response from an auth instance is rethrown as-is without triggering any token refresh. |
| `AxiosFactory.createAuthInstanceForFirm` | should use basic auth for firm instance in staging | Verifies that the auth instance uses a `Basic` `Authorization` header when the host is a staging URL. |

---

### `tests/lib/api/firmCredentials.test.js`
Source: `lib/api/firmCredentials.js`

| Function | Test | Description |
|---|---|---|
| `FirmCredentials` (initialization) | creates the .silverfin directory if it does not exist | Verifies that `fs.mkdirSync` is called with the expected path when the `.silverfin` directory is absent. |
| `FirmCredentials` (initialization) | does not create the .silverfin directory if it already exists | Verifies that `fs.mkdirSync` is not called when the `.silverfin` directory already exists. |
| `FirmCredentials` (initialization) | creates the credentials file if it does not exist | Verifies that `fs.writeFileSync` is called with the default credentials structure when the config file is absent. |
| `FirmCredentials` (initialization) | loads existing credentials if the file exists | Verifies that existing credentials are read from disk and populated into `firmCredentials.data`. |
| `FirmCredentials` (initialization) | adds default values if they are missing from existing credentials | Verifies that `defaultFirmIDs` and `host` defaults are merged in when loading a credentials file that lacks them. |
| `loadCredentials` | loads credentials from file successfully | Verifies that calling `loadCredentials` replaces the in-memory data with freshly read credentials from disk. |
| `saveCredentials` | writes credentials to file successfully | Verifies that `saveCredentials` calls `fs.writeFileSync` with the current in-memory credentials serialised as JSON. |
| `saveCredentials` | handles file system error when saving credentials | Verifies that a filesystem error during save is caught and logged without throwing. |
| `setHost` / `getHost` | should set and get the host correctly | Verifies that `setHost` persists the host to disk and `getHost` returns the updated value. |
| `setHost` / `getHost` | should return environment variable host if set | Verifies that `getHost` returns the `SF_HOST` env var value instead of the stored host when the env var is set. |
| `setHost` / `getHost` | should return default host if not set | Verifies that `getHost` returns the default live host when neither `SF_HOST` nor a stored value is present. |

---

### `tests/lib/api/sfApi.test.js`
Source: `lib/api/sfApi.js`

| Function | Test | Description |
|---|---|---|
| `authorizeFirm` | should delegate to SilverfinAuthorizer.authorizeFirm | Verifies that calling `SF.authorizeFirm` passes the firm ID straight through to `SilverfinAuthorizer.authorizeFirm`. |
| `refreshFirmTokens` | should delegate to SilverfinAuthorizer.refreshFirm | Verifies that calling `SF.refreshFirmTokens` delegates to `SilverfinAuthorizer.refreshFirm` and returns its result. |
| `refreshPartnerToken` | should delegate to SilverfinAuthorizer.refreshPartner | Verifies that calling `SF.refreshPartnerToken` delegates to `SilverfinAuthorizer.refreshPartner` and returns its result. |
| `createReconciliationText` | should POST to reconciliations and return response on success (201) | Verifies that a POST to `reconciliations` succeeds with a 201 and the response data is returned. |
| `createReconciliationText` | should call responseErrorHandler on error | Verifies that a 422 response causes `responseErrorHandler` to be invoked. |
| `readReconciliationTexts` | should GET reconciliations list and return data | Verifies that a GET to `reconciliations` returns the list as an array. |
| `readReconciliationTexts` | should return empty array when list is empty | Verifies that when the API returns an empty array the function returns an empty array. |
| `readReconciliationTextById` | should GET reconciliation by id and return response | Verifies that a GET to `reconciliations/:id` returns the expected reconciliation object. |
| `readReconciliationTextById` | should call responseErrorHandler on 404 | Verifies that a 404 response invokes `responseErrorHandler`. |
| `findReconciliationTextByHandle` | should find reconciliation by handle on page 1 | Verifies that when a matching handle appears on page 1 it is returned. |
| `findReconciliationTextByHandle` | should return null when list is empty (not found) | Verifies that when the list is empty `null` is returned. |
| `findReconciliationTextByHandle` | should skip partner templates (marketplace_template_id is not null) | Verifies that templates with a non-null `marketplace_template_id` are not returned even when the handle matches. |
| `updateReconciliationText` | should POST to update reconciliation and return response | Verifies that a POST to `reconciliations/:id` returns the updated reconciliation. |
| `updateReconciliationText` | should call responseErrorHandler on 422 error | Verifies that a 422 response invokes `responseErrorHandler`. |
| `readSharedParts` | should GET shared_parts list and return response | Verifies that a GET to `shared_parts` returns the full list response. |
| `readSharedPartById` | should GET shared part by id and return response | Verifies that a GET to `shared_parts/:id` returns the expected shared part object. |
| `findSharedPartByName` | should find shared part by name | Verifies that the matching shared part is returned when its name is found in the list. |
| `findSharedPartByName` | should return null when list is empty | Verifies that `null` is returned when the list API returns an empty array. |
| `createSharedPart` | should POST to shared_parts and return response | Verifies that a POST to `shared_parts` returns the created shared part. |
| `updateSharedPart` | should POST to update shared part and return response | Verifies that a POST to `shared_parts/:id` returns the updated shared part. |
| `createExportFile` | should POST to export_files and return response | Verifies that a POST to `export_files` returns the created export file. |
| `readExportFiles` | should GET export_files list and return data | Verifies that a GET to `export_files` returns an array. |
| `readExportFileById` | should GET export file by id and return data | Verifies that a GET to `export_files/:id` returns the expected export file object. |
| `updateExportFile` | should POST to update export file and return response | Verifies that a POST to `export_files/:id` returns the updated export file. |
| `findExportFileByName` | should find export file by name_nl | Verifies that the matching export file is returned when its `name_nl` is found in the list. |
| `findExportFileByName` | should return null when list is empty | Verifies that `null` is returned when the list API returns an empty array. |
| `createAccountTemplate` | should POST to account_templates and return response | Verifies that a POST to `account_templates` returns the created account template. |
| `readAccountTemplates` | should GET account_templates list and return data | Verifies that a GET to `account_templates` returns an array. |
| `readAccountTemplateById` | should GET account template by id and return data | Verifies that a GET to `account_templates/:id` returns the expected account template object. |
| `updateAccountTemplate` | should POST to update account template and return response | Verifies that a POST to `account_templates/:id` returns the updated account template. |
| `findAccountTemplateByName` | should find account template by name_nl | Verifies that the matching account template is returned when its `name_nl` is found in the list. |
| `findAccountTemplateByName` | should return null when list is empty | Verifies that `null` is returned when the list API returns an empty array. |

---

### `tests/lib/api/silverfinAuthorizer.test.js`
Source: `lib/api/silverfinAuthorizer.js`

| Function | Test | Description |
|---|---|---|
| `SilverfinAuthorizer.authorizeFirm` | should successfully store new tokens when they dont exist | Verifies the full OAuth flow: the browser is opened, the authorization code is exchanged for tokens, firm details are fetched, and tokens are stored. |
| `SilverfinAuthorizer.authorizeFirm` | should succesfully store new tokens when they exist | Verifies that re-authorizing an already-authorized firm also completes the OAuth flow and stores the new tokens. |
| `SilverfinAuthorizer.authorizeFirm` | should raise an error when firm id is missing | Verifies that when the user enters an empty firm ID an error is logged and the process exits without opening the browser. |
| `SilverfinAuthorizer.authorizeFirm` | should handle response errors | Verifies that an HTTP error response during token exchange logs the status, error description, and exits the process without storing tokens. |
| `SilverfinAuthorizer.authorizeFirm` | should not raise errors when getting the firm name fails | Verifies that a failure to fetch the firm name is silently ignored and the tokens are still stored. |
| `SilverfinAuthorizer.refreshFirm` | should store provided tokens | Verifies that when valid stored tokens exist a refresh request is made with the correct parameters and new tokens are stored. |
| `SilverfinAuthorizer.refreshFirm` | should raise an error when there are no previous tokens | Verifies that when no existing tokens are stored an error is logged, no refresh request is made, and the process exits. |
| `SilverfinAuthorizer.refreshFirm` | should handle response errors | Verifies that an HTTP error during token refresh logs the status and description and exits without storing tokens. |
| `SilverfinAuthorizer.refreshPartner` | should store the new API key | Verifies that when valid stored credentials exist the refresh endpoint is called and the new API key is persisted. |
| `SilverfinAuthorizer.refreshPartner` | should raise an error when there are no previous tokens | Verifies that when no partner credentials are stored an error is logged, no refresh request is made, and the process exits. |
| `SilverfinAuthorizer.refreshPartner` | should handle response errors | Verifies that an HTTP error during API key refresh logs the status and exits without storing the new key. |

---

### `tests/lib/cli/changelogReader.spec.js`
Source: `lib/cli/changelogReader.js`

| Function | Test | Description |
|---|---|---|
| `ChangelogReader.fetchChanges` | should return undefined when changelog file doesn't exist (404 response) | Verifies that a 404 response from GitHub causes `undefined` to be returned and a debug message to be logged. |
| `ChangelogReader.fetchChanges` | should return undefined when API call fails | Verifies that a network error causes `undefined` to be returned and a debug message to be logged. |
| `ChangelogReader.fetchChanges` | should return undefined when response status is not 200 | Verifies that any non-200 status causes `undefined` to be returned and a debug message to be logged. |
| `ChangelogReader.fetchChanges` | should return changelog content when changelog file exists and has new versions | Verifies that relevant version sections between the current and target version are extracted and returned. |
| `ChangelogReader.fetchChanges` | should return only versions between user version and update version | Verifies that versions above the target or at/below the current version are excluded from the returned content. |
| `ChangelogReader.fetchChanges` | should return version content when no new versions are found (same version) | Verifies that when current and target versions are identical the content for that single version is returned. |
| `ChangelogReader.fetchChanges` | should return undefined when update version is not found in changelog | Verifies that an empty string is returned and a debug message is logged when the target version has no entry in the changelog. |
| `ChangelogReader.fetchChanges` | should handle changelog with incorrect format gracefully | Verifies that when the target version header is malformed (missing brackets) an empty string is returned with a debug message. |
| `ChangelogReader.fetchChanges` | should handle changelog with malformed version sections | Verifies that malformed version headers within the changelog are handled without throwing and the valid sections are still returned. |
| `ChangelogReader.fetchChanges` | should handle empty changelog content | Verifies that a changelog with no version sections returns an empty string. |
| `ChangelogReader.fetchChanges` | should handle changelog with only header and no version sections | Verifies that a changelog body with no version headers returns an empty string. |
| `ChangelogReader.fetchChanges` | should return content in correct order (newest to oldest) | Verifies that the returned content preserves the newest-first ordering from the source changelog. |

---

### `tests/lib/cli/cliUpdater.spec.js`
Source: `lib/cli/cliUpdater.js`

| Function | Test | Description |
|---|---|---|
| `CliUpdater.checkVersions` | should not display update message when latest version equals current version | Verifies that no "new version available" message is logged when the latest npm version matches the installed version. |
| `CliUpdater.checkVersions` | should display an update message when a newer version is available | Verifies that a "new version available" message is logged when the latest npm version is higher than the installed version. |
| `CliUpdater.checkVersions` | should not display any message when API call fails | Verifies that a failed version check is silently ignored and only a debug message is logged. |
| `CliUpdater.performUpdate` | should run the update command and show a success message | Verifies that the npm install command is executed, the new version is read back, and a success message is logged. |
| `CliUpdater.performUpdate` | should handle update failure and show error message | Verifies that when the npm install command fails an error message is logged. |

---

### `tests/lib/cli/cwdValidator.spec.js`
Source: `lib/cli/cwdValidator.js`

| Function | Test | Description |
|---|---|---|
| `CwdValidator.run` | should not display a warning if .git directory exists | Verifies that no warning is logged when the current directory contains a `.git` folder, indicating a repo root. |
| `CwdValidator.run` | should warn about known directories | Verifies that a warning is logged when the current directory is a known template subdirectory (e.g. `reconciliation_texts/handle`). |
| `CwdValidator.run` | should display a warning if .git directory does not exist | Verifies that a general warning about the working directory is logged when no `.git` folder is found. |

---

### `tests/lib/cli/utils.test.js`
Source: `lib/cli/utils.js`

| Function | Test | Description |
|---|---|---|
| `loadDefaultFirmId` | should return firmId from firmCredentials config when available | Verifies that the stored default firm ID is returned when one is configured. |
| `loadDefaultFirmId` | should fall back to SF_FIRM_ID env var when no stored config | Verifies that the `SF_FIRM_ID` environment variable is used as a fallback when no stored ID exists. |
| `loadDefaultFirmId` | should return undefined when neither config nor env var is set | Verifies that `undefined` is returned when neither a stored ID nor the env var is present. |
| `loadDefaultFirmId` | should prefer stored config over env var | Verifies that the stored config value takes precedence over the `SF_FIRM_ID` env var. |
| `checkDefaultFirm` | should log info when firmUsed matches firmIdDefault | Verifies that an info message containing the firm ID is logged when the used firm matches the default. |
| `checkDefaultFirm` | should NOT log when firmUsed does not match firmIdDefault | Verifies that nothing is logged when the used firm differs from the default. |
| `formatOption` | should convert camelCase to kebab-case with leading dash on uppercase | Verifies that `listAll` is converted to `list-all`. |
| `formatOption` | should handle single word with no uppercase | Verifies that a single lowercase word is returned unchanged. |
| `formatOption` | should convert multiple uppercase letters | Verifies that `importReconciliationText` is converted to `import-reconciliation-text`. |
| `checkUniqueOption` | should return true when exactly one unique option is used | Verifies that `true` is returned and no error is logged when exactly one of the mutually exclusive options is set. |
| `checkUniqueOption` | should call process.exit(1) when none of the unique options are used | Verifies that an error is logged and `process.exit(1)` is called when none of the required options are present. |
| `checkUniqueOption` | should call process.exit(1) when more than one unique option is used | Verifies that an error about incompatible options is logged and `process.exit(1)` is called when multiple exclusive options are set. |
| `checkUniqueOption` | should format option names as kebab-case in error message | Verifies that camelCase option names are converted to kebab-case in the error message. |
| `checkRequiredFirmOrPartner` | should return true when a required option with firm is used | Verifies that `true` is returned without error when a firm ID is provided alongside a required option. |
| `checkRequiredFirmOrPartner` | should call process.exit(1) when required option is used but neither firm nor partner is set | Verifies that an error is logged and `process.exit(1)` is called when a firm-requiring option is used without a firm or partner. |
| `checkRequiredFirmOrPartner` | should return true when no required options are used (not triggered) | Verifies that `true` is returned without error when none of the declared required options are present. |
| `checkRequiredFirmOrPartner` | should return true when partner is set and partner is supported | Verifies that `true` is returned when the partner option is present alongside a required option. |
| `getCommandSettings` | should return firm type and firm envId when partner is not set | Verifies that `{ type: "firm", envId }` is returned when only the firm option is set. |
| `getCommandSettings` | should return partner type and partner envId when partner is set | Verifies that `{ type: "partner", envId }` is returned when the partner option is set. |
| `checkPartnerSupport` | should call process.exit(1) when both partner and all are set | Verifies that an error is logged and `process.exit(1)` is called when both `--partner` and `--all` flags are used together. |
| `checkPartnerSupport` | should not call process.exit when only partner is set (without all) | Verifies that no error is raised when only the partner flag is set. |
| `checkPartnerSupport` | should not call process.exit when only all is set (without partner) | Verifies that no error is raised when only the all flag is set. |
| `logCurrentHost` | should NOT log when current host is the default host | Verifies that no info message is logged when the current host matches the default live host. |
| `logCurrentHost` | should log info with host details when host differs from default | Verifies that an info message containing the non-default host URL is logged. |

---

### `tests/lib/templates/accountTemplates.test.js`
Source: `lib/templates/accountTemplate.js`

| Function | Test | Description |
|---|---|---|
| `AccountTemplate.save` | should return false if name_nl is missing | Verifies that `save` returns `false` immediately when the template has no `name_nl`. |
| `AccountTemplate.save` | should return false if the liquid code is missing | Verifies that `save` returns `false` when the template has no liquid text. |
| `AccountTemplate.save` | should return false if the template handle is invalid | Verifies that `save` returns `false` when `checkValidName` rejects the `name_nl`. |
| `AccountTemplate.save` | should create the necessary files and store template's relevant details | Verifies that the template folder, `main.liquid`, text-part files, YAML test stub, and `config.json` are all created with the correct content. |
| `AccountTemplate.save` | should fetch an existing template's config and update with new details | Verifies that when a `config.json` already exists the existing firm IDs are preserved while the new ID and updated fields are merged in. |
| `AccountTemplate.save` | should replace existing liquid files if the template already exists | Verifies that `main.liquid` and text-part files are overwritten with the API response content on re-import. |
| `AccountTemplate.save` | should not replace existing liquid test files if the template already exists | Verifies that an existing YAML test file is left unchanged when re-importing the template. |
| `AccountTemplate.save` | should not replace or delete unspecified text_parts | Verifies that text-part files not included in the current API response are preserved on disk. |
| `AccountTemplate.save` | should not overwrite existing YAML test files when importing a template | Verifies that a YAML file with existing test content is not replaced with the default stub. |
| `AccountTemplate.read` | should read and process the account template correctly | Verifies that `read` assembles the correct object from `config.json`, `main.liquid`, and text-part files. |
| `AccountTemplate.read` | should create liquid test file if it's missing | Verifies that `read` creates a default YAML stub when the test file does not yet exist. |

---

### `tests/lib/templates/exportFiles.test.js`
Source: `lib/templates/exportFile.js`

| Function | Test | Description |
|---|---|---|
| `ExportFile.save` | should return false if the template name_nl is missing | Verifies that `save` returns `false` immediately when `name_nl` is absent. |
| `ExportFile.save` | should return false if there is no liquid code | Verifies that `save` returns `false` when the template has no liquid text. |
| `ExportFile.save` | should return false if the template name_nl is invalid | Verifies that `save` returns `false` when `checkValidName` rejects the `name_nl`. |
| `ExportFile.save` | should create the necessary files and store template's relevant details | Verifies that the folder, `main.liquid`, text-part files, and `config.json` are created with correct content. |
| `ExportFile.save` | should fetch an existing template's config and update with new details | Verifies that existing firm IDs in `config.json` are preserved while new fields are merged in. |
| `ExportFile.save` | should not replace or delete unspecified text_parts | Verifies that text-part files not present in the current API response remain on disk after save. |

---

### `tests/lib/templates/reconciliationTexts.test.js`
Source: `lib/templates/reconciliationText.js`

| Function | Test | Description |
|---|---|---|
| `ReconciliationText.save` | should return false if the template handle is missing | Verifies that `save` returns `false` and logs a warning when the template object has no handle. |
| `ReconciliationText.save` | should return false if the liquid code is missing | Verifies that `save` returns `false` when the template has no liquid text. |
| `ReconciliationText.save` | should return false if the template handle is invalid | Verifies that `save` returns `false` when `checkValidName` rejects the handle. |
| `ReconciliationText.save` | should create the necessary files and store template's relevant details | Verifies that `main.liquid`, text-part files, YAML test file, README, and `config.json` are created with correct content. |
| `ReconciliationText.save` | should fetch an existing template's config and update with new details | Verifies that existing firm IDs are preserved while the new ID and updated fields are merged into the config. |
| `ReconciliationText.save` | should replace existing liquid files if the template already exists | Verifies that `main.liquid` and text-part files are overwritten with fresh API content on re-import. |
| `ReconciliationText.save` | should not replace existing liquid test files if the template already exists | Verifies that an existing YAML test file and README are left unchanged when re-importing the template. |
| `ReconciliationText.save` | should not replace or delete unspecified text_parts | Verifies that text-part files not in the current API response are preserved on disk. |
| `ReconciliationText.save` | should save template with all locale names | Verifies that all language-specific name fields are written correctly to `config.json`. |
| `ReconciliationText.save` | should preserve existing locale names when saving template | Verifies that existing locale name fields in `config.json` are not overwritten when the incoming template omits those fields. |
| `ReconciliationText.read` | should return false if the template handle is invalid | Verifies that `read` returns `false` when `checkValidName` rejects the handle. |
| `ReconciliationText.read` | should read and process the template correctly | Verifies that `read` returns the expected object assembled from config, main liquid, and text-part files. |
| `ReconciliationText.read` | should create main.liquid if it doesn't exist | Verifies that `read` creates a default `main.liquid` stub when the file is absent. |
| `ReconciliationText.read` | should create liquid test file if it's missing | Verifies that `read` creates a default YAML stub when the test file does not yet exist. |
| `ReconciliationText.read` | should warn and remove invalid reconciliation_type | Verifies that an unrecognised `reconciliation_type` is stripped from the result and a warning is logged. |
| `ReconciliationText.read` | should add missing handle and names to config | Verifies that missing `handle` and `name_nl` fields are defaulted to the directory name. |
| `ReconciliationText.read` | should handle templates with no text parts | Verifies that when `text_parts` is an empty object the result contains an empty array. |
| `ReconciliationText.read` | should handle empty text parts | Verifies that a text-part file with empty content is represented as `{ name, content: "" }` in the result. |
| `ReconciliationText.read` | should exclude downloadable_as_docx and show warning when externally_managed is false | Verifies that `downloadable_as_docx` is omitted from the result and a warning is logged when the template is not externally managed. |
| `ReconciliationText.read` | should include downloadable_as_docx when externally_managed is true | Verifies that `downloadable_as_docx` is included in the result when the template is externally managed. |
| `ReconciliationText.read` | should handle templates with custom locale names | Verifies that all locale name fields are correctly read and returned. |
| `ReconciliationText.read` | should add missing locale names to config with handle as fallback | Verifies that when locale name fields are absent the handle is used as the fallback value for `name_nl`. |

---

### `tests/lib/templates/sharedParts.test.js`
Source: `lib/templates/sharedPart.js`

| Function | Test | Description |
|---|---|---|
| `SharedPart.save` | should return false if the template name is invalid | Verifies that `save` returns `false` when `checkValidName` rejects the shared part name. |
| `SharedPart.save` | should create the necessary files and store template's relevant details | Verifies that the liquid file and `config.json` are created with the correct content. |
| `SharedPart.read` | should create the liquid file if it doesn't exist | Verifies that `read` creates a default liquid stub when the part's liquid file is absent. |

---

### `tests/lib/utils/apiUtils.test.js`
Source: `lib/utils/apiUtils.js`

| Function | Test | Description |
|---|---|---|
| `checkRequiredEnvVariables` | should not call process.exit when both env variables are present | Verifies that no error and no process exit occur when both `SF_API_CLIENT_ID` and `SF_API_SECRET` are set. |
| `checkRequiredEnvVariables` | should call process.exit(1) and log errors when SF_API_CLIENT_ID is missing | Verifies that an error is logged and `process.exit(1)` is called when `SF_API_CLIENT_ID` is absent. |
| `checkRequiredEnvVariables` | should call process.exit(1) and log errors when both env variables are missing | Verifies that an error is logged and `process.exit(1)` is called when both env vars are absent. |
| `responseSuccessHandler` | should log debug message when response has a status | Verifies that a debug message is logged for a valid HTTP response with a status code. |
| `responseSuccessHandler` | should not throw when response is undefined | Verifies that the handler does not throw and no debug message is logged for `undefined`. |
| `responseSuccessHandler` | should not throw when response has no status | Verifies that the handler does not throw and no debug message is logged when the response lacks a status field. |
| `responseErrorHandler` | should log error and return undefined for 404 response | Verifies that a 404 logs an error, does not exit the process, and returns `undefined`. |
| `responseErrorHandler` | should log error and return undefined for 400 response | Verifies that a 400 logs an error, does not exit the process, and returns `undefined`. |
| `responseErrorHandler` | should log error and call process.exit(1) for 422 response (then rethrows since exit is mocked) | Verifies that a 422 logs an error, calls `process.exit(1)`, and then rethrows. |
| `responseErrorHandler` | should log debug and NOT call process.exit for 401 response (rethrows after logging) | Verifies that a 401 logs a debug message and rethrows without exiting the process. |
| `responseErrorHandler` | should log error and call process.exit for 403 response (then rethrows since exit is mocked) | Verifies that a 403 logs an error, calls `process.exit(1)`, and then rethrows. |
| `responseErrorHandler` | should rethrow error when there is no response property (unhandled error) | Verifies that errors without an HTTP response (e.g. network errors) are rethrown without exiting. |
| `checkAuthorizePartners` | should call firmCredentials.getPartnerCredentials and return its result | Verifies that `checkAuthorizePartners` delegates to `firmCredentials.getPartnerCredentials` and returns its result. |

---

### `tests/lib/utils/checkLiquidTestDependencies.test.js`
Source: `lib/utils/fsUtils.js` (`checkLiquidTestDependencies`)

| Function | Test | Description |
|---|---|---|
| `checkLiquidTestDependencies` | should return empty array when no templates depend on the target handle | Verifies that an empty array is returned when no test YAML files reference the target handle. |
| `checkLiquidTestDependencies` | should find templates that reference target handle in data subtree as string values | Verifies that templates whose YAML test data contains the target handle as a value are returned. |
| `checkLiquidTestDependencies` | should find templates that reference target handle in data subtree as keys | Verifies that templates whose YAML test data uses the target handle as a mapping key are returned. |
| `checkLiquidTestDependencies` | should only scan data subtree, not context or expectation | Verifies that handles appearing only in the `context` or `expectation` sections are not treated as dependencies. |
| `checkLiquidTestDependencies` | should handle nested structures in data | Verifies that a deeply nested occurrence of the target handle in the data subtree is detected. |
| `checkLiquidTestDependencies` | should handle arrays in data | Verifies that a target handle that appears as an element in a YAML array within the data subtree is detected. |
| `checkLiquidTestDependencies` | should only check templates with liquid test files | Verifies that template directories without a tests folder are skipped. |
| `checkLiquidTestDependencies` | should handle multiple test cases | Verifies that a target handle referenced in a later test case within the same YAML file is still detected. |
| `checkLiquidTestDependencies` | should return unique handles even if target appears multiple times | Verifies that a handle is listed only once even when the target appears multiple times in one YAML file. |
| `checkLiquidTestDependencies` | should not include the target handle itself (self-reference) (first instance) | Verifies that when the target template's own test file references itself it is excluded from results. |
| `checkLiquidTestDependencies` | should not include the target handle itself (self-reference) (second instance) | Verifies the same self-reference exclusion in a second scenario alongside another dependent template. |
| `checkLiquidTestDependencies` | should handle parsing errors gracefully | Verifies that a YAML file with invalid syntax is skipped without throwing, and valid templates are still returned. |

---

### `tests/lib/utils/findTemplatesWithLiquidTests.test.js`
Source: `lib/utils/fsUtils.js` (`findTemplatesWithLiquidTests`)

| Function | Test | Description |
|---|---|---|
| `findTemplatesWithLiquidTests` | should return empty array when reconciliation_texts directory does not exist | Verifies that an empty array is returned when the `reconciliation_texts` directory is absent. |
| `findTemplatesWithLiquidTests` | should return empty array when no test files exist | Verifies that an empty array is returned when a template directory exists but has no YAML test files. |
| `findTemplatesWithLiquidTests` | should find templates with liquid test files | Verifies that handles for all templates with a matching `_liquid_test.yml` file are returned. |
| `findTemplatesWithLiquidTests` | should exclude variant files with TY suffix (e.g., _TY21, _TY23) | Verifies that YAML files with a `_TY\d+` suffix are ignored and only the base test file is counted. |
| `findTemplatesWithLiquidTests` | should exclude variant files with other uppercase suffix patterns | Verifies that files matching the `_[A-Z]+\d+_liquid_test.yml` variant pattern are excluded. |
| `findTemplatesWithLiquidTests` | should only search in reconciliation_texts, not account_templates | Verifies that account template directories are not scanned and only reconciliation handles are returned. |
| `findTemplatesWithLiquidTests` | should skip directories without tests folder | Verifies that template directories lacking a `tests` subdirectory are not included. |
| `findTemplatesWithLiquidTests` | should skip non-directory files in reconciliation_texts | Verifies that plain files inside `reconciliation_texts` do not cause errors and are ignored. |
| `findTemplatesWithLiquidTests` | should handle multiple templates with mixed main and variant files | Verifies that each template is counted only once regardless of how many variant files it has. |

---

### `tests/lib/utils/fsUtils.test.js`
Source: `lib/utils/fsUtils.js`

| Function | Test | Description |
|---|---|---|
| `createFolder` | should create a folder when it does not exist | Verifies that the directory is created on disk when it does not yet exist. |
| `createFolder` | should be a no-op when the folder already exists | Verifies that calling `createFolder` on an existing directory does not throw and leaves existing contents intact. |
| `createTemplateFolders` | should create main + text_parts + tests subdir when testFolder=true | Verifies that the template root, `text_parts`, and `tests` subdirectories are all created when `testFolder` is `true`. |
| `createTemplateFolders` | should create main + text_parts but NOT tests when testFolder=false | Verifies that the `tests` subdirectory is not created when `testFolder` is `false`. |
| `createTemplateFolders` | should default testFolder to true | Verifies that the `tests` subdirectory is created when the `testFolder` argument is omitted. |
| `createSharedPartFolders` | should create only the root folder for shared part | Verifies that only the shared-part root directory is created, without a `text_parts` subdirectory. |
| `createLiquidTestFiles` (YAML) | should write YAML file if it does not exist | Verifies that the YAML test file is created with the provided content when it does not yet exist. |
| `createLiquidTestFiles` (YAML) | should skip writing YAML file if it already exists | Verifies that an existing YAML test file is not overwritten. |
| `createLiquidTestFiles` (README) | should write README.md if it does not exist | Verifies that a `README.md` file is created in the tests directory when it does not yet exist. |
| `createLiquidTestFiles` (README) | should skip writing README.md if it already exists | Verifies that an existing `README.md` is not overwritten. |
| `createTemplateFiles` | should write main.liquid and text part files | Verifies that `main.liquid` and each named text-part file are written with the correct content. |
| `createTemplateFiles` | should skip text parts with empty name | Verifies that a text-part entry with an empty string key does not produce a file on disk. |
| `createLiquidFile` | should write a single liquid file at the given relative path | Verifies that the liquid file is created at the expected path with the provided content. |
| `writeConfig` | should write a config.json file with formatted JSON | Verifies that `config.json` is written to the correct directory with the provided object serialised as formatted JSON. |
| `readConfig` | should read and parse an existing config.json | Verifies that an existing `config.json` is parsed and returned correctly. |
| `readConfig` | should create config.json with defaults and return it when missing | Verifies that when no `config.json` exists a default one is created and returned. |
| `configExists` | should return true when config.json exists | Verifies that `true` is returned when the expected `config.json` is present on disk. |
| `configExists` | should return false when config.json does not exist | Verifies that `false` is returned when no `config.json` exists for the template. |
| `setTemplateId` | should set the template id for firm type | Verifies that the ID is stored under `config.id[envId]` when `type` is `"firm"`. |
| `setTemplateId` | should set the template id for partner type | Verifies that the ID is stored under `config.partner_id[envId]` when `type` is `"partner"`. |
| `setTemplateId` | should throw for invalid type | Verifies that an unknown type string causes `setTemplateId` to throw. |
| `getTemplateId` | should return firm template id | Verifies that the correct ID is returned from `config.id` for a firm type. |
| `getTemplateId` | should return partner template id | Verifies that the correct ID is returned from `config.partner_id` for a partner type. |
| `getTemplateId` | should return undefined when id is not set | Verifies that `undefined` is returned when no ID is stored for the given firm. |
| `getTemplateId` | should throw for invalid type | Verifies that an unknown type string causes `getTemplateId` to throw. |
| `findHandleByID` | should return the handle when a matching firm id is found | Verifies that the handle of the matching reconciliation text is returned when its config contains the target firm ID and numeric ID. |
| `findHandleByID` | should return undefined when no matching template is found | Verifies that `undefined` is returned when no local template's config matches the given ID. |
| `findHandleByID` | should return the name_nl for account templates when id matches | Verifies that `name_nl` (not `handle`) is used as the identifier for account templates. |
| `getAllTemplatesOfAType` | should return all template handles for reconciliationText when configs exist | Verifies that all directory names under `reconciliation_texts` with a `config.json` are returned. |
| `getAllTemplatesOfAType` | should return empty array when no templates folder exists | Verifies that an empty array is returned when the template type folder does not exist. |
| `getAllTemplatesOfAType` | should skip directories without config.json | Verifies that directories without a `config.json` are excluded from results. |
| `getAllTemplatesOfAType` | should throw for invalid template type | Verifies that an unsupported type string causes `getAllTemplatesOfAType` to throw. |
| `FOLDERS` | should have correct folder names for all template types | Verifies that the `FOLDERS` constant maps each template type key to the expected filesystem directory name. |
| `createConfigIfMissing` | should create a default config for reconciliationText when missing | Verifies that a default `config.json` with the correct `handle`, `id`, `partner_id`, and `reconciliation_type` fields is created. |
| `createConfigIfMissing` | should create a default config for sharedPart when missing | Verifies that a default `config.json` with the correct `name` field is created for a shared part. |
| `createConfigIfMissing` | should create a default config for exportFile when missing | Verifies that a default `config.json` with `name_nl` and `encoding` fields is created for an export file. |
| `createConfigIfMissing` | should create a default config for accountTemplate when missing | Verifies that a default `config.json` with `name_nl` and `account_range` fields is created for an account template. |
| `createConfigIfMissing` | should not overwrite an existing config | Verifies that calling `createConfigIfMissing` when a `config.json` already exists leaves the file unchanged. |

---

### `tests/lib/utils/liquidTestUtils.test.js`
Source: `lib/utils/liquidTestUtils.js`

| Function | Test | Description |
|---|---|---|
| `processCustom` | should sort by namespace first | Verifies that entries from different namespaces are ordered alphabetically by namespace. |
| `processCustom` | should sort by key within the same namespace | Verifies that entries sharing the same namespace are ordered alphabetically by key. |
| `processCustom` | should handle numeric suffixes correctly | Verifies that keys with numeric suffixes are sorted numerically (e.g. `item_2` before `item_10`). |
| `processCustom` | should handle mixed keys (with and without numeric suffixes) | Verifies that alphabetic keys and numeric-suffix keys within the same namespace are interleaved in the correct order. |
| `processCustom` | should handle values with field property | Verifies that when a value object has a `field` property the `field` value is used as the output value. |
| `processCustom` | should handle regular values without field property | Verifies that plain string values are used as-is in the output. |
| `processCustom` | should handle mixed value types (with and without field property) | Verifies that entries with `field`-wrapped values and plain values are both handled correctly in the same call. |
| `processCustom` | should handle complex sorting scenario with multiple namespaces and numeric keys | Verifies correct ordering across multiple namespaces each containing both numeric-suffix and plain keys. |
| `processCustom` | should handle empty array | Verifies that an empty input array produces an empty output object. |
| `processCustom` | should handle single item | Verifies that a single-element array produces the expected single-key object. |
| `processCustom` | should handle numeric suffixes with more than 10 items | Verifies that items numbered 1 through 14 are ordered sequentially and not lexicographically. |

---

### `tests/lib/utils/templateUtils.test.js`
Source: `lib/utils/templateUtils.js`

| Function | Test | Description |
|---|---|---|
| `TEMPLATES_NAME_ATTRIBUTE` | should have all 4 type keys | Verifies that each template type maps to the correct name attribute (`handle`, `name_nl`, or `name`). |
| `TEMPLATE_TYPE_NAMES` | should have all 4 type keys with human-readable values | Verifies that all four template types have a string entry in the human-readable names map. |
| `TEMPLATE_MAP_TYPES` | should map API type strings to internal type keys | Verifies that API-side type strings such as `"reconciliation"` and `"shared_part"` are correctly mapped to internal type keys. |
| `getTemplateName` | should return handle for reconciliationText | Verifies that `handle` is used as the template name for reconciliation texts. |
| `getTemplateName` | should return name_nl for accountTemplate | Verifies that `name_nl` is used as the template name for account templates. |
| `getTemplateName` | should return name_nl for exportFile | Verifies that `name_nl` is used as the template name for export files. |
| `getTemplateName` | should return name for sharedPart | Verifies that `name` is used as the template name for shared parts. |
| `checkValidName` | should return true for valid alphanumeric handle (reconciliationText) | Verifies that a handle containing only alphanumerics and underscores passes validation. |
| `checkValidName` | should return false for handle with spaces (reconciliationText) | Verifies that a handle containing spaces fails validation and a warning is logged. |
| `checkValidName` | should return false for handle with forward slash (accountTemplate) | Verifies that a name containing a forward slash fails validation. |
| `checkValidName` | should return false for handle with backslash (accountTemplate) | Verifies that a name containing a backslash fails validation. |
| `checkValidName` | should return true for valid name with spaces for accountTemplate (no slash) | Verifies that a name with spaces but no slashes passes validation for account templates. |
| `checkValidName` | should return false for handle with forward slash (exportFile) | Verifies that an export file name containing a forward slash fails validation. |
| `checkValidName` | should return true for empty string (reconciliationText) | Verifies that an empty string passes the reconciliation text regex (matches zero characters). |
| `checkValidName` | should return false for string with unicode characters (reconciliationText) | Verifies that a handle with non-ASCII characters fails validation and a warning is logged. |
| `checkValidName` | should return true for valid alphanumeric sharedPart name | Verifies that a shared part name with alphanumerics and underscores passes validation. |
| `filterParts` | should reduce text_parts array to {name: content} object with 2 parts | Verifies that an array of `{ name, content }` objects is transformed into a `{ name: content }` map. |
| `filterParts` | should return empty object for empty array | Verifies that an empty `text_parts` array produces an empty object. |
| `filterParts` | should include part with empty name as key | Verifies that a text part with an empty string name is included in the output with `""` as the key. |
| `missingLiquidCode` | should return false when template has text | Verifies that `false` is returned and no warning is logged when the template has non-empty liquid text. |
| `missingLiquidCode` | should return true and warn when template has no text | Verifies that `true` is returned and a warning is logged when `text` is `null`. |
| `missingLiquidCode` | should return true and warn when template text is empty string | Verifies that `true` is returned and a warning is logged when `text` is an empty string. |
| `missingLiquidCode` | should return true and not throw for null template | Verifies that passing `null` as the template returns `true` with a warning rather than throwing. |
| `missingNameNL` | should return false when template has name_nl | Verifies that `false` is returned when `name_nl` is present and non-empty. |
| `missingNameNL` | should return true and warn when name_nl is missing but name_en is present | Verifies that `true` is returned and a warning is logged when `name_nl` is null. |
| `missingNameNL` | should return true and warn when all names are missing | Verifies that `true` is returned and a warning is logged when both `name_nl` and `name_en` are empty. |
| `missingNameNL` | should return true and warn when template is empty object | Verifies that `true` is returned and a warning is logged when the template object has no name fields at all. |

---

### `tests/lib/utils/urlHandler.test.js`
Source: `lib/utils/urlHandler.js`

| Function | Test | Description |
|---|---|---|
| `UrlHandler` (constructor) | should create instance with valid url | Verifies that a `UrlHandler` instance is created with the correct `url` and a `null` `customFilename`. |
| `UrlHandler` (constructor) | should create instance with url and custom filename | Verifies that a `UrlHandler` instance is created with both `url` and `customFilename` set correctly. |
| `UrlHandler` (constructor) | should throw error when url is undefined | Verifies that constructing with `undefined` as the URL throws with the expected message. |
| `UrlHandler` (constructor) | should throw error when url is null | Verifies that constructing with `null` as the URL throws with the expected message. |
| `UrlHandler` (constructor) | should throw error when url is empty string | Verifies that constructing with an empty string as the URL throws with the expected message. |
| `UrlHandler` (constructor) | should throw error when url is not provided | Verifies that constructing with no argument throws with the expected message. |
| `UrlHandler.openFile` | should download file with Content-Disposition filename and open it | Verifies that the file is downloaded, saved under the filename from the Content-Disposition header, and opened. |
| `UrlHandler.openFile` | should download file with custom filename and inferred extension | Verifies that the custom filename is used with the extension inferred from the Content-Disposition header. |
| `UrlHandler.openFile` | should use timestamp filename when Content-Disposition is missing | Verifies that a timestamp-based filename is used when the response has no Content-Disposition header. |
| `UrlHandler.openFile` | should use .html extension when Content-Disposition is missing | Verifies that a `.html` extension is applied when the response headers provide no filename. |
| `UrlHandler.openFile` | should parse filename from standard Content-Disposition format | Verifies that `filename="..."` in the Content-Disposition header is parsed correctly. |
| `UrlHandler.openFile` | should parse filename from UTF-8 encoded Content-Disposition | Verifies that `filename*=UTF-8''...` percent-encoded filenames are decoded and used correctly. |
| `UrlHandler.openFile` | should parse filename without quotes | Verifies that an unquoted `filename=...` value in the Content-Disposition header is parsed correctly. |
| `UrlHandler.openFile` | should parse filename with special characters | Verifies that filenames containing hyphens, underscores, and digits are parsed correctly. |
| `UrlHandler.openFile` | should extract correct extension from Content-Disposition | Verifies that a variety of file extensions (pdf, xlsx, docx, txt, zip) are all preserved correctly in the saved filename. |
| `UrlHandler.openFile` | should generate unique filename when file already exists | Verifies that a `(1)` suffix is appended when the target filename already exists on disk. |
| `UrlHandler.openFile` | should increment counter for multiple existing files | Verifies that the counter increments until a free filename is found (e.g. `document (3).pdf`). |
| `UrlHandler.openFile` | should preserve extension when generating unique filename | Verifies that the extension remains after the base name when generating a numbered unique filename. |
| `UrlHandler.openFile` | should open file using 'open' package when not in WSL | Verifies that the `open` package is used to open the file in non-WSL environments. |
| `UrlHandler.openFile` | should open file using WSLHandler when in WSL | Verifies that `WSLHandler.open` is used instead of the `open` package in WSL environments. |
| `UrlHandler.openFile` | should log error when axios download fails | Verifies that a download failure invokes `errorHandler` and exits the process without writing or opening any file. |
| `UrlHandler.openFile` | should log error when file opening fails in non-WSL | Verifies that an error from the `open` package is caught and logged. |
| `UrlHandler.openFile` | should log error when WSLHandler.open fails | Verifies that a failure in `WSLHandler.open` is caught and logged. |
| `UrlHandler.openFile` | should handle ENOENT error from errorHandler | Verifies that an `ENOENT` error during download is passed to `errorHandler` and exits the process. |
| `UrlHandler.openFile` | should handle fs.mkdirSync failure gracefully | Verifies that a permission error during directory creation is passed to `errorHandler` and no file is written. |
| `UrlHandler.openFile` | should handle fs.writeFileSync failure gracefully | Verifies that a write error is passed to `errorHandler` and the process exits. |
| `UrlHandler.openFile` | should handle very long filenames | Verifies that a filename of over 200 characters is used as-is without truncation. |
| `UrlHandler.openFile` | should handle binary file data correctly | Verifies that binary buffer data is written to the file unchanged. |
| `UrlHandler.openFile` | should handle empty file content | Verifies that an empty buffer is saved and the file is still opened. |
| `UrlHandler.openFile` | should use correct temp directory path | Verifies that the file is saved under a `silverfin` subdirectory inside the OS temp directory. |
| `UrlHandler.openFile` | should handle URLs with query parameters | Verifies that the full URL including query parameters is passed to axios unchanged. |
| `UrlHandler.openFile` | should handle Content-Disposition with multiple parameters | Verifies that only the `filename` parameter is extracted when the Content-Disposition header contains additional fields. |

---

### `tests/lib/exportFileInstanceGenerator.test.js`
Source: `lib/exportFileInstanceGenerator.js`

| Function | Test | Description |
|---|---|---|
| `ExportFileInstanceGenerator` (constructor) | should create an instance with all required parameters | Verifies that all four constructor parameters are stored as instance properties. |
| `ExportFileInstanceGenerator` (constructor) | should throw when firmId is missing | Verifies that constructing without a `firmId` throws the expected error. |
| `ExportFileInstanceGenerator` (constructor) | should throw when companyId is missing | Verifies that constructing without a `companyId` throws the expected error. |
| `ExportFileInstanceGenerator` (constructor) | should throw when periodId is missing | Verifies that constructing without a `periodId` throws the expected error. |
| `ExportFileInstanceGenerator` (constructor) | should throw when exportFileId is missing | Verifies that constructing without an `exportFileId` throws the expected error. |
| `ExportFileInstanceGenerator.generateAndOpenFile` | should log error and return false when createExportFileInstance returns no id | Verifies that when the API returns no instance ID an error is logged and the function returns without polling. |
| `ExportFileInstanceGenerator.generateAndOpenFile` | should poll until state is created and open the download URL | Verifies that when the instance state is immediately `"created"` the download URL is opened and a success message is logged. |
| `ExportFileInstanceGenerator.generateAndOpenFile` | should log warning for validation errors after successful generation | Verifies that validation errors in a completed instance are logged as a warning. |
| `ExportFileInstanceGenerator.generateAndOpenFile` | should retry while state is pending and succeed on eventual created state | Verifies that the poller retries while the state is `"pending"` and succeeds once the state becomes `"created"`. |
| `ExportFileInstanceGenerator.generateAndOpenFile` | should log error when state is neither pending nor created | Verifies that an unexpected state (e.g. `"failed"`) causes an error to be logged. |
| `ExportFileInstanceGenerator.generateAndOpenFile` | should log error when no content_url is present in response | Verifies that when the completed instance has no `content_url` an error is logged. |

---

### `tests/lib/liquidTestGenerator.test.js`
Source: `lib/liquidTestGenerator.js`

| Function | Test | Description |
|---|---|---|
| `testGenerator` (template reading) | should read reconciliation template correctly | Verifies that `ReconciliationText.read` is called with the resolved handle and the YAML is exported with the correct period structure. |
| `testGenerator` (template reading) | should handle missing reconciliation template gracefully | Verifies that when the local template file is not found a warning is logged and the process exits. |
| `testGenerator` (template reading) | should read shared parts correctly | Verifies that `SharedPart.read` is called for each shared part referenced in the reconciliation liquid code. |
| `testGenerator` (template reading) | should handle missing shared part gracefully | Verifies that when a referenced shared part is not found locally a warning is logged without exiting the process. |
| `testGenerator` (period custom data) | should process period custom data correctly | Verifies that period-level custom data is included under the period key in the exported YAML. |
| `testGenerator` (period custom data) | should handle empty period custom data | Verifies that when no period custom data exists the `custom` key is absent from the period entry in the YAML. |
| `testGenerator` (error handling) | should exit with error code 1 for authorization failures | Verifies that when the firm is not authorised an error is logged and the process exits with code 1. |
| `testGenerator` (error handling) | should warn and exit for missing reconciliation template | Verifies that a missing local template causes a warning and process exit. |
| `testGenerator` (error handling) | should warn and return gracefully for missing shared parts | Verifies that a missing shared part logs a warning but does not exit the process. |
| `testGenerator` (period data) | should set current period correctly | Verifies that the fiscal year end date from the API is used as the period key in the exported YAML context and data. |
| `testGenerator` (period data) | should handle previous period correctly | Verifies that when a previous period is returned it is included as a `null` entry alongside the current period in the YAML data. |
| `testGenerator` (account template) | should read account template correctly | Verifies that account lookup, template detail fetch, and `AccountTemplate.read` are all called with the correct arguments. |
| `testGenerator` (account template) | should set current_account in context | Verifies that the account number is placed in the `context.current_account` field of the exported YAML. |
| `testGenerator` (account template) | should fetch account template custom and results | Verifies that custom data and results are fetched for the account and included in the correct YAML structure. |
| `testGenerator` (account template) | should use starred status from account response | Verifies that the starred status comes from the account response directly without querying the workflow. |
| `testGenerator` (account template) | should skip dependency resolution for account templates | Verifies that shared part resolution is not performed for account template test generation. |
| `testGenerator` (account template) | should handle missing account template association gracefully | Verifies that when the account has no associated template an error is logged and the process exits. |
| `testGenerator` (account template) | should handle missing account template file gracefully | Verifies that when the local account template file is absent a warning is logged and the process exits. |
| `testGenerator` (account template) | should handle account lookup errors gracefully | Verifies that an API error during account lookup causes an error to be logged and the process exits. |
| `testGenerator` (account template) | should process period custom data for account templates | Verifies that period custom data is included in the account template YAML under the correct period key. |
| `testGenerator` (account template) | should handle empty period custom data for account templates | Verifies that when no period custom data exists the `custom` key is absent in the account template YAML. |

---

### `tests/lib/liquidTestRunner.test.js`
Source: `lib/liquidTestRunner.js`

| Function | Test | Description |
|---|---|---|
| `checkAllTestsErrorsPresent` | should return false when all tests pass (reconciled null, empty results/rollforwards) | Verifies that `false` is returned when every test case has no reconciliation failure, no result mismatches, and no rollforward mismatches. |
| `checkAllTestsErrorsPresent` | should return true when reconciled is not null | Verifies that `true` is returned when any test case has a non-null `reconciled` field. |
| `checkAllTestsErrorsPresent` | should return true when results has entries | Verifies that `true` is returned when any test case has one or more result mismatches. |
| `checkAllTestsErrorsPresent` | should return true when rollforwards has entries | Verifies that `true` is returned when any test case has one or more rollforward mismatches. |
| `checkAllTestsErrorsPresent` | should return false for empty tests object | Verifies that `false` is returned for an object with no test cases. |
| `checkAllTestsErrorsPresent` | should return true as soon as one test has an error even if others pass | Verifies that a single failing test case causes `true` to be returned even when other cases pass. |
| `getHTML` | should call UrlHandler.openFile when openBrowser is true | Verifies that `UrlHandler` is instantiated and `openFile` is called with the composed filename when `openBrowser` is `true`. |
| `getHTML` | should NOT call UrlHandler when openBrowser is false | Verifies that no `UrlHandler` is created when `openBrowser` is `false`. |
| `runTests` | should exit with error for invalid templateType | Verifies that an invalid `templateType` causes an error to be logged and `process.exit(1)` to be called. |
| `runTests` | should return undefined when config is missing | Verifies that `undefined` is returned and an error is logged when the template's `config.json` does not exist. |
| `runTests` | should return undefined when YAML test file does not exist | Verifies that `undefined` is returned and an error is logged when the YAML test file path in the config does not exist on disk. |
| `runTests` | should run tests and return testRun result when YAML exists and API responds | Verifies that `createTestRun` and `readTestRun` are called and the completed test-run object is returned. |
| `runTests` | should log info and return false when YAML file is empty (single line) | Verifies that `undefined` is returned and an info message about no stored tests is logged when the YAML file contains only a comment. |
| `runTests` | should run tests for accountTemplate type | Verifies that `runTests` works end-to-end for the `accountTemplate` type and returns a completed test-run object. |
| `runTestsWithOutput` | should exit with error for invalid templateType | Verifies that an invalid `templateType` causes an error to be logged and `process.exit(1)` to be called. |
| `runTestsWithOutput` | should log ALL TESTS HAVE PASSED when completed with no errors | Verifies that a success message containing "ALL TESTS HAVE PASSED" is logged when all tests pass. |
| `runTestsWithOutput` | should log TESTS FAILED when completed with errors | Verifies that a "FAILED" message is logged when the test run reports failures. |
| `runTestsWithOutput` | should log internal_error message when status is internal_error | Verifies that an "Internal error" message is logged when the API returns `status: "internal_error"`. |
| `runTestsStatusOnly` | should exit for invalid templateType | Verifies that an invalid template type causes an error to be logged and `process.exit(1)` to be called. |
| `runTestsStatusOnly` | should return PASSED when all handles pass | Verifies that `"PASSED"` is returned and logged when all supplied handles have passing test runs. |
| `runTestsStatusOnly` | should return FAILED when a handle fails | Verifies that `"FAILED"` is returned and logged when a test run reports failures. |
| `runTestsStatusOnly` | should return FAILED when test result is null (runTests returned nothing) | Verifies that `"FAILED"` is returned when `runTests` returns nothing (e.g. missing config). |
| `runTestsStatusOnly` | should handle multiple handles and return FAILED if any fail | Verifies that `"FAILED"` is returned when at least one handle in a multi-handle run fails. |

---

### `tests/lib/toolkit.test.js`
Source: `index.js` (toolkit)

| Function | Test | Description |
|---|---|---|
| `publishReconciliationById` | should successfully update reconciliation by ID when matching template found | Verifies that `findHandleByID` resolves the handle, `ReconciliationText.read` builds the payload, `updateReconciliationText` is called, and `true` is returned. |
| `publishReconciliationById` | should return false when no template found with matching ID | Verifies that an error message is logged and `false` is returned when `findHandleByID` returns `undefined`. |
| `publishReconciliationById` | should handle partner type correctly | Verifies that partner updates include `version_significant_change: false` in the payload. |
| `publishReconciliationById` | should return false when template reading fails | Verifies that `undefined` is returned when `ReconciliationText.read` returns `null`. |
| `publishReconciliationById` | should return false when API call fails | Verifies that an error is logged and `false` is returned when `updateReconciliationText` returns `null`. |
| `publishReconciliationById` | should handle exceptions gracefully | Verifies that a thrown exception is passed to `errorHandler` without rethrowing. |
| `publishReconciliationById` | should use default message when none provided | Verifies that the default `"Updated with the Silverfin CLI"` version comment is used when no message is provided. |
| `publishExportFileById` | should successfully update export file by ID when matching template found | Verifies that the export file is updated via the API and `true` is returned. |
| `publishExportFileById` | should return false when no template found with matching ID | Verifies that an error is logged and `false` is returned when no local template matches the ID. |
| `publishExportFileById` | should return false when template reading fails | Verifies that `undefined` is returned when `ExportFile.read` returns `null`. |
| `publishExportFileById` | should return false when API call fails | Verifies that an error is logged and `false` is returned when the update API returns `null`. |
| `publishExportFileById` | should handle exceptions gracefully | Verifies that a thrown exception is passed to `errorHandler`. |
| `publishExportFileById` | should use default message when none provided | Verifies that the default version comment is used when no message argument is passed. |
| `publishAccountTemplateById` | should successfully update account template by ID when matching template found | Verifies that mapping ranges are filtered to the current env type, the update API is called, and `true` is returned. |
| `publishAccountTemplateById` | should return false when no template found with matching ID | Verifies that an error is logged and `false` is returned when no local template matches the ID. |
| `publishAccountTemplateById` | should handle partner type correctly | Verifies that for partner updates only partner mapping ranges are included and `version_significant_change: false` is set. |
| `publishAccountTemplateById` | should return false when template reading fails | Verifies that `undefined` is returned when `AccountTemplate.read` returns `null`. |
| `publishAccountTemplateById` | should return false when API call fails | Verifies that an error is logged and `false` is returned when the update API returns `null`. |
| `publishAccountTemplateById` | should handle exceptions gracefully | Verifies that a thrown exception is passed to `errorHandler`. |
| `publishAccountTemplateById` | should use default message when none provided | Verifies that the default version comment is used and firm-type mapping ranges are included. |
| `publishSharedPartById` | should successfully update shared part by ID when matching template found | Verifies the full update flow succeeds and returns `true`. |
| `publishSharedPartById` | should return false when no template found with matching ID | Verifies that an error is logged and `false` is returned when no local template matches the ID. |
| `publishSharedPartById` | should return false when template reading fails | Verifies that `undefined` is returned when `SharedPart.read` returns `null`. |
| `publishSharedPartById` | should return false when API call fails | Verifies that an error is logged and `false` is returned when the update API returns `null`. |
| `publishSharedPartById` | should handle exceptions gracefully | Verifies that a thrown exception is passed to `errorHandler`. |
| `publishSharedPartById` | should use default message when none provided | Verifies that the default version comment is used when no message is passed. |
| `fetchReconciliationById` | should save and log success when template is found | Verifies that the API is called, `ReconciliationText.save` is invoked, and a success message is logged. |
| `fetchReconciliationById` | should log error and exit when template not found | Verifies that an error is logged and the process exits when the API returns `null`. |
| `fetchReconciliationById` | should not log success when save returns false | Verifies that no success message is logged when `ReconciliationText.save` returns `false`. |
| `fetchReconciliationByHandle` | should use config id when config exists with id | Verifies that when a local config with a matching ID exists the fetch uses that ID directly. |
| `fetchReconciliationByHandle` | should search SF by handle when config has no id | Verifies that when no local ID is found the handle is looked up remotely via `findReconciliationTextByHandle`. |
| `fetchReconciliationByHandle` | should exit when template not found in SF | Verifies that an error is logged and the process exits when the remote look-up returns `null`. |
| `fetchAllReconciliations` | should save each template when array returned | Verifies that `ReconciliationText.save` is called once per template in the paginated response. |
| `fetchAllReconciliations` | should log error when page 1 returns empty array | Verifies that an appropriate error message is logged when the first page of results is empty. |
| `fetchExistingReconciliations` | should warn when no local templates exist | Verifies that a warning is logged when `getAllTemplatesOfAType` returns an empty array. |
| `fetchExistingReconciliations` | should call fetchReconciliationById for each template with an id | Verifies that each local template with a stored ID triggers a remote fetch. |
| `publishReconciliationByHandle` | should update reconciliation when config and id exist | Verifies the full update flow completes and returns `true`. |
| `publishReconciliationByHandle` | should return false when config does not exist | Verifies that `false` is returned and `missingReconciliationId` is called when no config is found. |
| `publishReconciliationByHandle` | should return false when id is not found in config | Verifies that `false` is returned when the config has no ID entry for the requested firm. |
| `publishAllReconciliations` | should call publishReconciliationByHandle for each template | Verifies that all local reconciliation text handles are iterated over. |
| `newReconciliation` | should create reconciliation and store new id on success | Verifies that the API is called, the new ID is stored, and a success message is logged. |
| `newReconciliation` | should warn and skip when reconciliation already exists | Verifies that when the handle already exists remotely a warning is logged and the create API is not called. |
| `newAllReconciliations` | should call newReconciliation for each local template | Verifies that each local reconciliation handle is iterated over for creation. |
| `fetchExportFileById` | should save and log success when template is found | Verifies that `ExportFile.save` is called with the API response and a success message is logged. |
| `fetchExportFileById` | should log error and exit when template not found | Verifies that an error is logged and the process exits when the API returns `null`. |
| `fetchAllExportFiles` | should save each template when array returned | Verifies that `ExportFile.save` is called for each export file in the paginated response. |
| `fetchAllExportFiles` | should log error when page 1 returns empty array | Verifies that an error message is logged when the first page returns no export files. |
| `publishExportFileByName` | should update export file when config and id exist | Verifies the full update flow completes and returns `true`. |
| `publishExportFileByName` | should return false when config does not exist | Verifies that `false` is returned when there is no local config. |
| `newExportFile` | should create export file and store new id on success | Verifies the full creation flow completes and the new ID is stored. |
| `newExportFile` | should warn and skip when export file already exists | Verifies that a warning is logged and the create API is not called when the name already exists remotely. |
| `fetchAccountTemplateById` | should save and log success when template is found | Verifies that `AccountTemplate.save` is called and a success message is logged. |
| `fetchAccountTemplateById` | should log error and exit when template not found | Verifies that an error is logged and the process exits when the API returns `null`. |
| `fetchAllAccountTemplates` | should save each template when array returned | Verifies that `AccountTemplate.save` is called for each account template in the response. |
| `fetchAllAccountTemplates` | should warn when page 1 returns empty array | Verifies that a warning is logged when the first page returns no account templates. |
| `publishAccountTemplateByName` | should update account template when config and id exist | Verifies the update flow completes and returns `true`. |
| `publishAccountTemplateByName` | should return false when config does not exist | Verifies that `false` is returned when there is no local config. |
| `newAccountTemplate` | should create account template and store new id on success | Verifies the full creation flow completes and the new ID is stored. |
| `newAccountTemplate` | should warn and skip when account template already exists | Verifies that a warning is logged and the create API is not called when the name already exists remotely. |
| `fetchSharedPartById` | should save and log success when template is found | Verifies that `SharedPart.save` is called with the API data and a success message is logged. |
| `fetchSharedPartById` | should log error and exit when template not found | Verifies that an error is logged and the process exits when `readSharedPartById` returns `null`. |
| `fetchAllSharedParts` | should fetch each shared part when list returned | Verifies that `readSharedPartById` is called for each shared part in the paginated list. |
| `fetchAllSharedParts` | should log error when page 1 returns empty data | Verifies that an error message is logged when the first page of shared parts is empty. |
| `publishSharedPartByName` | should update shared part when config and id exist | Verifies the full update flow completes and returns `true`. |
| `publishSharedPartByName` | should return false when config does not exist | Verifies that `false` is returned when there is no local config. |
| `newSharedPart` | should create shared part and store new id on success | Verifies the full creation flow completes and the new ID is stored. |
| `newSharedPart` | should warn and skip when shared part already exists | Verifies that a warning is logged and the create API is not called when the name already exists remotely. |
| `getTemplateId` | should update config and return true when reconciliation found | Verifies that the remote ID is written to the config and `true` is returned when the template is found. |
| `getTemplateId` | should warn and return false when template not found | Verifies that a warning is logged and `false` is returned when the remote look-up returns nothing. |
| `getTemplateId` | should update config for sharedPart type | Verifies that the shared part look-up path also writes the ID to config and returns `true`. |
| `getAllTemplatesId` | should call getTemplateId for each template of the type | Verifies that `getAllTemplatesOfAType` is iterated over and `findReconciliationTextByHandle` is called for each handle. |
| `updateFirmName` | should store firm name and return true when firm found | Verifies that the firm name is fetched and an info message with the firm details is logged. |
| `updateFirmName` | should warn and return false when firm not found | Verifies that a warning is logged and `false` is returned when the firm is not found. |
