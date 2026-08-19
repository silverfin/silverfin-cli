---
name: bumping-cli-version
description: Use when preparing a pull request, committing a user-facing change, releasing, or bumping the version - and whenever package.json, package-lock.json or CHANGELOG.md is about to be edited. Also use when the "CLI version check" GitHub action fails.
---

# Bumping the CLI version

Every PR to `main` runs [.github/workflows/cli_version.yml](../../../.github/workflows/cli_version.yml), which fails unless the version was bumped correctly or the bump was explicitly skipped. There is no partial credit — miss one of the three and CI is red.

## Does this change need a bump?

Bump when the change affects what a user of the installed CLI gets: a command, its output, a fix, a dependency update.

Skip only for changes with no effect on the published package — docs, tests, CI config, comments. To skip, the PR body must contain the checkbox ticked exactly:

```
- [x] Skip bumping the CLI version
```

That string is matched literally against the PR body. Ticking it in a commit message or a comment does nothing.

## The three edits

All three, or CI fails.

1. **`package.json`** — `version` strictly greater than the version on `main`. Equal is a failure, not a pass.
2. **`package-lock.json`** — the top-level `version` set to the *same* string. The workflow compares them directly. `npm version` normally handles both; if the lockfile is stale, edit it rather than reinstalling — see the environment note in [docs/DEVELOPMENT.md](../../../docs/DEVELOPMENT.md).
3. **`CHANGELOG.md`** — a new entry at the top of the list whose heading contains the literal `## [<version>]`.

Verify before pushing:

```bash
jq -r .version package.json package-lock.json    # must print the same string twice
grep -F "## [$(jq -r .version package.json)]" CHANGELOG.md
git fetch origin main && git show origin/main:package.json | jq -r .version   # must be lower
```

## Changelog entry format

Match the existing entries — heading, then one line of plain description, no bullet:

```markdown
## [1.56.2] (11/08/2026)
Add workflow statistics to the stats command.
```

Date is `DD/MM/YYYY`. Write what changed for the user, not what changed in the code.

`lib/cli/changelogReader.js` parses this file at runtime to show users what changed when they update, so the heading format is load-bearing. Do not reformat old entries, add sub-bullets under a version, or introduce `### ` levels.

## Which number

- **Patch** (`1.56.1` → `1.56.2`) — bug fix, dependency bump, no interface change.
- **Minor** (`1.56.1` → `1.57.0`) — new command, new option, new capability.
- **Major** — a breaking change to an existing command or its output. Ask before taking one; it is a release decision, not a code decision.

## Red flags

- Bumping `package.json` alone and assuming `npm install` will fix the lockfile — it fails with `EACCES` in this checkout
- A changelog entry written from the diff ("refactored `fsUtils`") rather than from the user's view
- Reformatting or re-dating existing changelog entries
- Assuming the skip checkbox applies because the change "feels internal" — if it ships in the package, it needs a bump
