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
