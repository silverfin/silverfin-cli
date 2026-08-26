---
name: review-pr
description: Use when reviewing an open pull request on the current branch - including "review this PR", "review the PR comments", "triage the bot comments", "what did CodeRabbit/Copilot miss", and when existing review comments need classifying as valid, stale or false positive before net-new findings are posted.
---

# /review-pr

Perform a layered PR review that builds on existing bot comments, then adds net-new findings via 7 parallel sub-agent finders.

---

## Conventions

### Severity rubric
- **🔴 Critical** — data loss or crash in normal use
- **🟠 Major** — crash or silent wrong behavior under a realistic edge case
- **🟡 Minor** — silent wrong behavior that's unlikely but possible
- **💡 Suggestion** — style, cleanup, or optional improvement

### When to post vs summarize
| Situation | Action |
|---|---|
| Net-new, actionable, not already raised | Post inline comment |
| Bot comment is a false positive | Reply to that thread |
| Bot comment is stale — Critical/Major open thread | Reply to that thread |
| Bot comment is stale — Minor/Suggestion | Summary only, no reply |
| Valid bot finding still open, no new angle | Summary only — don't duplicate inline |
| Same root cause AND same triggering condition as existing | Don't post |
| Bug on unchanged line (can't post inline) | Post as general PR comment via /reviews |

### Comment format
- Net-new inline: severity emoji + label, one-sentence description, concrete fix snippet for Major/Critical
- Reply to false positive: `**Note:** <why this doesn't apply>`
- Reply to stale: `**Stale:** This was fixed. No action needed.`

---

## Step 0 — Load learnings from previous reviews

Check for learnings in this order:
1. `.claude/review-learnings.md` in the project root (shared; commit if the team wants shared learnings, otherwise add to `.gitignore`)
2. `~/.claude/review-learnings.md` (personal fallback)

Read whichever exists (prefer project-local). Use the contents to:
- Recognise known false positive patterns for this repo and skip them in Step 5
- Prioritise finders that have historically found real bugs here
- Note any repo-specific quirks that affect classification

---

## Step 1 — Detect the PR

```bash
gh pr view --json number,title,headRefName,baseRefName,headRefOid,url
```

Extract `{pr_number}`, `{head_sha}` (= `headRefOid`), `{headRefName}`.

```bash
gh repo view --json nameWithOwner --jq '.nameWithOwner'
```

This gives `{owner}/{repo}` reliably. Stop if no open PR on the current branch.

---

## Step 2 — Establish diff scope

```bash
gh pr diff {pr_number} --name-only
```

Store as `{changed_files}`. Track count of skipped comments for the summary.

Get commit count:
```bash
gh pr view {pr_number} --json commits --jq '.commits | length'
```

---

## Step 3 — Fetch existing bot comments

Use `--paginate` to ensure all comments are fetched on large PRs:

```bash
gh api --paginate repos/{owner}/{repo}/pulls/{pr_number}/comments --jq '
  [.[] | select(
    .in_reply_to_id == null
    and (.user.login | test("\\[bot\\]$"; "i"))
  )]
'
# If --paginate + --jq produces duplicate/malformed output on very large PRs, fall back to:
# gh api --paginate repos/{owner}/{repo}/pulls/{pr_number}/comments | jq -s 'add | [.[] | select(.in_reply_to_id == null and (.user.login | test("\\[bot\\]$"; "i")))]'
```

After fetching, split into three buckets:
- **In scope** — `path` is in `{changed_files}`
- **Unpositioned** — `path` is null (file-level or outdated diff hunk); classify using comment body + rg across `{changed_files}`
- **Out of scope** — `path` is set but not in `{changed_files}`; count but do not process

If fetching a specific comment by ID later returns 404 (deleted or outdated), skip it and record it as inaccessible in the summary.

Also fetch review-level summaries:
```bash
gh api --paginate repos/{owner}/{repo}/pulls/{pr_number}/reviews \
  --jq '[.[] | select(.body != "" and (.user.login | test("\\[bot\\]$"; "i")))]'
```

---

## Step 4 — Classify each bot comment

For each bot root comment in scope or unpositioned:

**1. Determine severity from the comment body.**
Parse 🔴/🟠/🟡/💡 or text labels (`Critical`, `Major`, `Minor`, `Suggestion`). If absent, treat as Minor.

**2. Read the relevant code at HEAD.**

The approach depends on whether `path` is set:

- **`path` is null (unpositioned):** Do not call `git show`. Instead search across `{changed_files}` for symbols or behaviors mentioned in the comment body:
  ```bash
  rg "{symbol_from_comment}" --type js $(gh pr diff {pr_number} --name-only)
  ```
  Classify from that context only.

- **`path` is set:** First verify the local branch is current:
  ```bash
  git rev-parse HEAD
  ```
  This must equal `{head_sha}`. If it does, read from the workspace (use `sed` to extract ±20 lines around the comment line rather than loading the full file):
  ```bash
  git show HEAD:{path} | sed -n "$((line-20)),$((line+20))p"
  ```
  Where `line` is the comment's `line` value. Use `$((1 > line-20 ? 1 : line-20))` to clamp the start to line 1.
  Otherwise fall back to the GitHub API:
  ```bash
  gh api "repos/{owner}/{repo}/contents/{path}?ref={head_sha}" \
    --jq '.content' | base64 --decode
  ```
  If `line` is null on an in-scope comment: read the full file then search for the symbol mentioned in the comment body. Classify from current code.

  If `line` is set: read ±20 lines around `{line}`.

Do not judge a comment without reading the current code first.

**3. Check reply threads for context:**
```bash
gh api --paginate repos/{owner}/{repo}/pulls/{pr_number}/comments \
  --jq '[.[] | select(.in_reply_to_id == {comment_id})]'
```
A human reply does not mean the issue is resolved. Only the code at HEAD determines that.

**4. Classify:**
- **Still valid** — issue exists in current code at HEAD
- **Stale** — was real, now fixed
- **False positive** — never applied accurately to the code

**5. Act:**

| Classification | Severity | Action |
|---|---|---|
| Still valid | Any | Note for summary only — do not re-post inline |
| False positive | Any | Reply: `**Note:** <why this doesn't apply>` |
| Stale | Critical / Major | Reply: `**Stale:** This was fixed. No action needed.` |
| Stale | Minor / Suggestion | Summary only — no reply |

If a comment is stale or a false positive AND also unclear, address both concerns in one reply.

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments \
  -X POST \
  -f body="{reply}" \
  -F in_reply_to={comment_id}
```

---

## Step 5 — Full diff review via 7 parallel finders

Fetch the diff:
```bash
gh pr diff {pr_number}
```

Check CI status and identify failing fundamentals:
```bash
# Try structured output; fall back to plain text if --json fields are unsupported:
gh pr checks {pr_number} --json name,state,bucket \
  --jq '[.[] | select(.bucket == "fail")]' 2>/dev/null \
  || gh pr checks {pr_number} | grep -E "(fail|✗|X)"
```
Treat checks with names matching `test`, `lint`, `build`, `check-cli-version`, or any required status check as fundamentals. If any fundamental is failing, skip style nits entirely.

Spawn 7 parallel sub-agents, each receiving the full diff independently. Each agent must return **only a raw JSON array, no prose**:

```json
[
  {
    "file": "bin/cli.js",
    "line": 42,
    "severity": "Critical|Major|Minor|Suggestion",
    "description": "One sentence describing the problem.",
    "fix_snippet": "corrected code here, or null"
  }
]
```

Return `[]` if no findings. Collect all 7 results, then write out the complete merged raw list before any deduplication or filtering. This externalises all findings first and prevents quietly suppressing duplicates noticed mid-run.

### Finder 1 — Correctness & crashes
Look for: null/undefined dereferences, missing error handling on async operations, incorrect assumptions about response/data shape, off-by-one errors, wrong conditionals, incorrect return values used by callers, unhandled promise rejections.

### Finder 2 — Removed or changed behavior
For every deleted or modified line: was something relying on the old behavior? Look for: changed function signatures with callers elsewhere in the codebase, removed validations, altered default values, renamed or removed exports.

To find callers of changed symbols:
```bash
rg "{function_name|export_name}" --type js -l
```

### Finder 3 — Cross-file & architecture
Look for: new `lib/` modules without corresponding tests, patterns inconsistent with analogous existing implementations.

Explicitly compare to these existing analogues in silverfin-cli:
- `lib/liquidTestRunner.js` — runner pattern
- `lib/exportFileInstanceGenerator.js` — generator/loop pattern
- `lib/api/sfApi.js` — API call conventions and error handling

### Finder 4 — Security & data integrity
Look for: command injection via unsanitised shell args, path traversal, credentials or tokens in logs, unsafe use of `eval` or dynamic requires, writing user-controlled data to disk without validation, operations that silently overwrite without confirmation.

### Finder 5 — Edge cases & input validation
Look for: missing guards on empty arrays or empty strings, missing guards on null/undefined API responses, assumptions that optional fields are always present, no handling of network timeouts or partial responses, missing file-exists checks before reading.

### Finder 6 — Error handling & CI correctness
Look for: async loops that complete with exit code 0 even when items fail, `process.exit` vs `process.exitCode` used incorrectly, long-running operations that only warn instead of exiting on failure, error messages swallowed without surfacing to the user, missing non-zero exit on partial failure.

### Finder 7 — Silverfin-cli specifics
| Check | Signal to look for |
|---|---|
| New CLI command → CHANGELOG.md updated? | New `program.command(...)` with no CHANGELOG entry |
| `check-cli-version` CI failing? | Almost always means CHANGELOG.md needs a new version entry — flag as Major |
| New `lib/` module → unit tests added? | New file in `lib/` with no corresponding `*.test.js` |
| New feature → mirrors an existing one? | Compare to `liquidTestRunner.js`, `exportFileInstanceGenerator.js` |
| `sfApi` call → 404/error handler? | `.get()`/`.post()` result used without null/error check |
| Async loop → exit code on failure? | `for` loop over API calls, no `process.exitCode = 1` on error |
| CLI arg used as number/boolean → coerced? | Commander passes all args as strings; check `.option()` definitions |
| Commander optional-value arg `[value]`? | `--flag` with no value sets option to `true` (boolean); check callers handle `typeof option === 'boolean'` |
| Long operation → exits on failure, not just warns? | `console.warn` without subsequent `process.exit(1)` |

---

## Step 6 — Verify findings before posting

For each finding in the merged raw list:

1. Check the diff context first — changed lines are already available. Only fetch the full file from HEAD if the finding concerns an unchanged line or requires broader context beyond the diff hunk.

2. For questions about framework or library behavior (e.g. how Commander handles a flag, what an API returns), grep existing codebase usage or read the relevant library source. Do not run test code to verify.

3. Classify as:
   - **CONFIRMED** — issue clearly present in current code
   - **PLAUSIBLE** — likely an issue but needs runtime context to be certain
   - **REFUTED** — finding doesn't hold on current code

Post only CONFIRMED findings inline. Include PLAUSIBLE in the summary. Discard REFUTED.

**Dedup check**: skip a finding if any existing bot comment already covers the same root cause AND the same triggering condition. "Same topic" is not sufficient — a different failure mode or different trigger is a distinct finding worth posting.

---

## Step 7 — Post findings

For findings on added/modified lines:
```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments \
  -X POST \
  -f body="{comment}" \
  -f path="{file}" \
  -f commit_id="{head_sha}" \
  -f side="RIGHT" \
  -F line={line}
```

For findings on deleted lines (removed guards, dropped validations), use `side="LEFT"`. Line numbers on the LEFT side refer to the base (pre-change) side of the diff:
```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments \
  -X POST \
  -f body="{comment}" \
  -f path="{file}" \
  -f commit_id="{head_sha}" \
  -f side="LEFT" \
  -F line={line}
```

For multi-line findings:
```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments \
  -X POST \
  -f body="{comment}" \
  -f path="{file}" \
  -f commit_id="{head_sha}" \
  -f start_side="RIGHT" \
  -F start_line={start} \
  -f side="RIGHT" \
  -F line={end}
```

For findings on unchanged lines (posts as a top-level review comment, not inline):
```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews \
  -X POST \
  -f body="{comment — include file name and line number in the text}" \
  -f event="COMMENT"
```

---

## Step 8 — Required summary

Print to terminal after all comments are posted:

```
## PR Review Summary — #{pr_number}

### 1. Scope
- Files changed: {n} — {list}
- Commits: {n}
- Bot comments out of scope (not in diff): {n}
- Bot comments unpositioned (path: null): {n}
- Bot comments inaccessible (404): {n}

### 2. Existing bot comments
| Comment (truncated) | File | Classification | Action |
|---|---|---|---|
| "..." | foo.js:42 | Still valid | — |
| "..." | bar.js:10 | Stale | Replied |
| "..." | baz.js:5 | False positive | Replied |

### 3. Net-new comments posted
- {file}:{line} — {description} [{severity}]

### 4. Still open (valid bot findings not yet fixed)
- {file}:{line} — {description} [originally raised by {bot}]

### 5. Plausible (not posted — needs runtime verification)
- {file}:{line} — {description}

### 6. Blockers vs nice-to-haves
**Blockers:** ...
**Nice-to-haves:** ...

### 7. Gaps (if found)
- Tests: ...
- CHANGELOG: ...
- CI: ...
```

---

## Step 9 — Save learnings

Write to the same learnings file read in Step 0. If creating the file for the first time, write this header first:

```markdown
# Review Learnings
```

Then append an entry:

```markdown
## {YYYY-MM-DD} — PR #{pr_number} ({owner}/{repo})
### False positives avoided
- {pattern} — {why it doesn't apply to this codebase}
### Confirmed patterns
- {pattern} — {what made it a real bug}
### Repo quirks
- {anything unexpected about how this codebase works}
```

Only append entries that are genuinely useful for future reviews. Skip this step if nothing notable was found. If the file grows beyond ~50 lines per repo section, merge duplicate patterns before appending.
