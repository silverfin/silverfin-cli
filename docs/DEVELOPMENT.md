# Development

Commands and stack are in [CLAUDE.md](../CLAUDE.md); this covers the detail behind them.

## Tests

Suites mirror the source tree: `lib/utils/fsUtils.js` → `tests/lib/utils/fsUtils.test.js`, `bin/cli.js` commands → `tests/bin/cli/<command>.test.js`. Every exported function needs one. Global setup lives in `tests/setup.js`; [tests/TESTS.md](../tests/TESTS.md) catalogues what each suite already covers.

How to write one — which of the three harnesses to use, and how to mock `sfApi`, axios and `consola` — is in the `writing-tests` skill.

Test data lives in `fixtures/` — `api-responses/` for stubbed Silverfin payloads, `market-repo/` for a fake templates repo, `silverfin/` for credentials-file shapes. Prefer extending a fixture over inlining a large literal in a test.

## Environment

`node_modules` is root-owned in some checkouts, so `npm ci` and `npm install` fail with `EACCES`. Repair a single package with `npm pack` plus `tar` rather than reinstalling the tree.

## Releasing

Every PR to `main` must bump the version in `package.json` *and* `package-lock.json` and add a matching `## [<version>]` entry to `CHANGELOG.md`, or tick `- [x] Skip bumping the CLI version` in the PR body. [.github/workflows/cli_version.yml](../.github/workflows/cli_version.yml) enforces this. The `bumping-cli-version` skill has the full procedure.

`CHANGELOG.md` is also read at runtime by `lib/cli/changelogReader.js`, which extracts entries between two version headings to show users what changed on update — so the heading format is load-bearing beyond CI.
