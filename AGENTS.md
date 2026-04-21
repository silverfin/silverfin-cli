# Agent / contributor guide (silverfin-cli)

Short orientation for working in this repository. End-user setup, credentials, and template **repository** layout are documented in [README.md](README.md).

## Commands

- **Full test suite:** `npm test`
- **Lint:** `npm run lint`
- **Focused Jest run:** `npx jest path/to/test.js` (or a directory under `tests/`)

Before finishing a change that touches library or CLI behavior, run **lint and the full test suite**.

## Entry points

| Layer | Path | Role |
|--------|------|------|
| CLI executable | [bin/cli.js](bin/cli.js) | [Commander](https://github.com/tj/commander.js) program: defines subcommands, parses options, calls `index` exports and helpers (`liquidTestRunner`, `liquidTestGenerator`, etc.). |
| Programmatic API | [index.js](index.js) | `require('silverfin-cli')` surface: template fetch/publish/create helpers and related utilities. See **Public API** below. |
| Core libraries | [lib/](lib/) | `api/` (HTTP + auth), `templates/` (reconciliation, shared parts, export files, account templates), `cli/` (cwd checks, completions, updater, stats), `utils/` (fs, API helpers, errors, Liquid test helpers). |

## Public API (`index.js`)

The package `main` is [index.js](index.js). Downstream tools (e.g. the [Silverfin VS Code extension](https://github.com/silverfin/silverfin-vscode)) may depend on **named exports** on `module.exports`. Treat additions as safe; **removals or signature changes** are semver-sensitive—prefer deprecation when possible.

## Invariants / do not break

- **Global vs local install:** README recommends a **global** install; some flows (e.g. `update`) assume global usage. Local `node_modules` installs can behave differently.
- **Backward compatibility:** Keep the `index.js` export object stable for extension and automation consumers unless you are intentionally shipping a major version.
- **User template repos** follow the folder layout in README (`reconciliation_texts/`, `shared_parts/`, etc.). That is **not** the same as this package’s `lib/` tree—do not confuse the two.

## Auth and networking

- **OAuth / tokens / firm storage:** [lib/api/silverfinAuthorizer.js](lib/api/silverfinAuthorizer.js) (browser flow, refresh, partner keys).
- **HTTP client and API calls:** [lib/api/sfApi.js](lib/api/sfApi.js) (uses [lib/api/axiosFactory.js](lib/api/axiosFactory.js) for authenticated instances).
- **Stored credentials / host:** [lib/api/firmCredentials.js](lib/api/firmCredentials.js).

Environment variables and scopes: see [README.md](README.md) (e.g. `SF_API_CLIENT_ID`, `SF_API_SECRET`; host via `silverfin config --set-host`).

## Errors and logging

- **Shared helpers:** [lib/utils/errorUtils.js](lib/utils/errorUtils.js) — missing IDs/config, batch reconciliation summaries, `uncaughtErrors` / `errorHandler`.
- **CLI process handlers:** [lib/cli/utils.js](lib/cli/utils.js) (`handleUncaughtErrors`) wires `uncaughtRejection` / `uncaughtException` to `errorUtils.uncaughtErrors`.
- **User-facing messages:** [consola](https://github.com/unjs/consola) and [chalk](https://github.com/chalk/chalk) (e.g. suggested fix-it commands). Prefer extending `errorUtils` for consistent messaging rather than ad hoc `console.log` in many places.

## When in doubt

1. Run `npm run lint` and `npm test`.
2. Mirror patterns in the nearest existing command or module ([bin/cli.js](bin/cli.js) + matching code in [index.js](index.js) / [lib/](lib/)).
3. For structure and data flow, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
