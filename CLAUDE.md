# silverfin-cli

Command line tool for Silverfin template development: imports, updates, and creates reconciliation texts, account templates, export files and shared parts against the Silverfin API, and runs liquid tests.

## Commands

```bash
npm test              # full suite
npx jest <path>       # single suite
npm run lint          # eslint
```

Run `npm run lint && npm test` after code changes.

## Stack

Node.js, CommonJS, Commander (CLI), axios (HTTP), Jest (tests), yaml, chokidar, consola.

## Structure

```
bin/cli.js       command definitions, option parsing, input validation
index.js         orchestration: API call + file write, per template type
lib/api/         HTTP to Silverfin, OAuth, credentials
lib/templates/   serialise/deserialise a template to and from disk
lib/cli/         stats, dev mode, updater, spinner, command validation
lib/utils/       filesystem, parsing, errors, shared helpers
tests/           Jest suites, mirroring the source tree
fixtures/        test data
resources/       shipped assets: shell completion, liquid-test README
```

Layers run top to bottom. Code that skips one is wrong: `bin/cli.js` must not call the API directly, and `lib/api/` must not touch the filesystem.

## Further Reading

**IMPORTANT: Read the relevant docs below before starting any task.**

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — what each file is for, where a method belongs, naming conventions, review checklist. Read before adding, moving, or renaming anything.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — test conventions, fixtures, environment gotchas, `CHANGELOG.md` format. Read before writing tests or touching the release path.
- [tests/TESTS.md](tests/TESTS.md) — per-suite catalogue of what is already covered.
