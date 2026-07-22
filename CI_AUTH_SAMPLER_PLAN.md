# CI Auth + Liquid Sampler — consolidated findings & implementation plan

Single source of truth, merged from three sessions (CI split-auth handoff `5121bb47`,
the sampler-results session, and the memory `project_ci_auth_final_design`). Supersedes
`HANDOFF_ci_sampler.md`.

Status as of **2026-07-01**: both designs validated end-to-end in the `be_market` TEST
harness. Remaining work is (a) resolve the open questions, (b) productionise, (c) port the
proven workflows into the shared `bso_github_actions` repo.

**Status as of 2026-07-22 (see §10 for full detail): production build is live/near-live in
two pilots (`nl_market`, `lu_market`), plus a v2 of the compact-diff format (`silverfin-cli#265`)
being feedback-tested against both before merge. This is now the fastest-moving section — read
§10 first if you're picking this back up.**

---

## 0. TL;DR

Two CI use cases, **two deliberately different auth solutions** (not one shared mechanism):

| | Liquid **tests** | Liquid **sampler** |
|---|---|---|
| Problem | write-contention: per-user OAuth refresh token rotates on every refresh; 8 people racing invalidates it | single-version staging: read-only impossible; ~30–60 min runs; one run per partner |
| Solution | **decouple auth**: `*/10` cron is the sole token writer; test jobs run **read-only + parallel** (refreshToken stripped) → physically can't poison | **serialize**: `concurrency: { group, queue: max }`, own `PARTNER_CONFIG_JSON` secret, sole writer does load→run→write-back |
| Queue? | No — read-only, worst case re-run a job | Yes — FIFO, never cancel |
| Status | **M2 fully validated** | **M3 fully validated on staging** |

---

## 1. Liquid tests (M2) — DONE, validated

**Design.** Firm OAuth refresh tokens rotate on every refresh, so concurrent refreshes
poison each other. Fix = separate the *writer* from the *readers*:

- **Sole writer:** a `*/10` cron in each market caller refreshes tokens and is the only job
  that writes the config secret. (`bso_github_actions/refresh_token.yml` reusable, adopting
  PR #21's partner loop.) Cadence `*/10` chosen over `*/5`/`*/15`: TTL = 2h, GitHub scheduler
  lag measured up to **118 min**.
- **Readers:** test jobs strip `refreshToken` via `jq` and run read-only + parallel (PR #27).
  A 401 sends an empty refresh token → Silverfin rejects → no rotation → no poison.
- **Merge order:** PR #27 (read-only) merges FIRST, then the read-only/cron change rebases on top.

**Validated** in `be_market` via inlined `refresh_token_TEST.yml` + `run_tests_TEST.yml`
(CONFIG_JSON_TEST refreshed for firm 1355):
- refresh-writes-secret ✅
- read-only stripped config ✅
- 5× concurrency, no cancel ✅
- multi-handle long job ✅
- **mid-flight refresh survival** ✅ (held access token kept working ~76 s after a rotation) → no-poison confirmed

---

## 2. Liquid sampler (M3) — validated on staging, this is the active work

### 2.1 What the sampler is
CLI `run-sampler` (silverfin-cli PR #236) posts partner templates to the `liquid_sampler`
backend, which runs them across sample company files and returns a downloadable diff artifact.
It is a **human-review artifact, not a pass/fail gate** (see 2.4e).

### 2.2 Auth & environment (all confirmed on staging)
- Backend lives on **staging only** — `bso-staging-beta.staging.getsilverfin.com`.
  Prod test partner 84 returned **HTTP 503** → sampler backend is NOT on production.
- **Partner-scoped, single auth per run.** `createSamplerRun(partnerId, …)` uses the partner
  api_key from stored partner credentials. One `-p` = one partner = one auth.
- **`--firm-ids` is MANDATORY** — empty → `422 {"firm_ids":["can't be blank"]}`. Not stored in
  the repo; the workflow must supply them (currently hard-coded `469 106 1592`; source from a
  repo variable/config for production).
- **Staging sits behind an HTTP Basic gateway** → needs `SF_BASIC_AUTH` (base64). The CLI
  auto-detects staging (`/staging\.getsilverfin/`) and only then adds `Authorization: Basic …`.
  Off staging it's a no-op. (This is the `fix-staging-oauth-basic-auth` branch / PR #257.)
- **Host** comes from `firmCredentials.getHost()`, overridable by `SF_HOST` env var.
- Partner api_key is a single rotate-on-401 credential (can't be stripped like firm tokens) →
  it lives in its OWN `PARTNER_CONFIG_JSON` secret; the serialized sampler job is sole writer
  (load → run → write-back). Firm `CONFIG_JSON` is never touched.

### 2.3 Concurrency / queue design
- `concurrency: { group: sampler-staging, queue: max }` → FIFO, **nothing cancelled**.
- Aligns with a **server-side** constraint: the backend enforces one run per partner; a 2nd
  overlapping run gets `422 {"base":["A sampler run is already in progress for this partner"]}`.
- `queue: max` is a **GitHub beta** sub-key. Only the sampler depends on it and **no token
  safety rides on it**. Fallback: `queue: single` (1 running + 1 pending) or plain
  `cancel-in-progress: false`.
- **Never cancel an in-flight sampler job.** Cancelling kills the CLI but NOT the backend run —
  it keeps running (~30 min) and BLOCKS the partner (422) until it clears. There is no CLI
  cancel for a backend run.

### 2.4 Backend behavior learnings (important for the production job)
- (a) One sampler run per partner at a time (422 as above) — server-side.
- (b) Cancelling CI ≠ cancelling backend; leaves partner blocked.
- (c) A run can leave a stale in-progress state for a while; no CLI cancel exists.
- (d) `run-sampler` **exits 0 even on 422/failed** → the harness must grep output (ours does).
- (e) **Broken export does NOT fail the run.** Break-detection test (2026-07-01): broke `vkt_1`
  (removed an include) + `liquidation_reserve` (deleted 144 lines), sampled both → run reported
  "completed successfully", job GREEN, despite the breaks. Per-template errors/diffs live INSIDE
  the result artifact. **Grepping for "completed successfully" is NOT a quality gate.**

### 2.5 This session's additions — result accessibility (DONE, validated)
Goal: make the run's results reachable in **one click**, no HTML pasting, no manual command.

**CLI** — branch `silverfin-cli@agustin-bso-sampler-easy-results` (pushed):
- Always logs `Sampler report: <result_url>` on completion (was swallowed — old code only
  `openFile()`'d it, so in CI the URL vanished). `lib/liquidSamplerRunner.js`.
- Only download+open locally when **not** in CI; added `--no-open`. Constructor takes
  `{ openReport }`, defaulting to `!process.env.CI`.
- **Spinner suppressed in CI** — static poll line instead of the animated spinner, which had
  flooded a captured log with ~23 min of frames (thousands of lines). `bin/cli.js` passes
  `openReport: options.open && !process.env.CI`.
- Unit test `tests/lib/liquidSamplerRunner.test.js` (5/5 pass).

**Workflow** — `be_market@test-ci-auth-revalidate:.github/workflows/run_sampler_TEST.yml`:
- Installs the CLI from `#agustin-bso-sampler-easy-results`.
- On completion, extracts the URL and writes a clickable **📊 Open sampler report** link to
  `$GITHUB_STEP_SUMMARY`. Extraction:
  `grep -oE 'Sampler report: https?://[^[:space:]]+'` (anchors on the line regardless of
  consola's `[success]`/`✔` prefix; the presigned URL has no `)` so it's markdown-safe).

**Verified** run `28514806782` (2026-07-01, GREEN, 32m43s):
- Installed the right branch ✅; staging host + auth ✅; spinner gone ✅;
  `[success] Sampler report: https://storage.googleapis.com/…` printed ✅; verdict `completed` ✅.
- **`result_url` is a presigned GCS link to `results.zip`** (`content-type: application/zip`,
  `filename="results.zip"`), NOT a rendered HTML page — clicking downloads a zip. Long/far-future
  `Expires`, so the summary link stays valid well after the run.

### 2.6 Multi-partner changesets (design note, from this session)
A changed template can be mapped to **several** partners (its `config.json` `partner_id` map has
multiple keys). One `run-sampler` call handles exactly one partner and **hard-fails
(`process.exit(1)`) on the first template with no entry for that `-p`** — it does not skip.
So for a changeset spanning partners: **group changed templates by partner, run once per partner**
(matrix), each with its own stored partner credentials. Recommended to do the grouping in the
workflow, keeping the CLI single-partner.

### 2.7 The result artifact + LLM-assisted review WITHOUT context blowup (this session)
**Decision (2026-07-01): the sampler is a human-review artifact, not a pass/fail gate** (consistent
with 2.4e). The reviewer inspects the diff, optionally with LLM help.

**`results.zip` contents** (inspected a real one):
```
results/
  liquid_comparison_report.html   # the diff SUMMARY (1.9 KB when 0 changed; 1.84 MB at 32 changed)
  sample_entry_ids.yml            # the sampled entries
  output/{account,reconciliation}_entries/<id>/{before,after}/{rendered_text.md,*.liquid,*.json,*.html}  # 154 MB raw
```
The HTML report inlines full diff tables **with unchanged context rows + ~5 lines of markup per
line** → at 32 changed templates it is **1.84 MB ≈ 470K tokens**. Pasting it into a chat is what
blew up the earlier session. **Humans open the HTML in a browser; LLMs must get an extracted view.**

**Measured reduction (on the 32-changed / 230-sample run):**

| Representation | Size | ~Tokens | Method |
|---|---|---|---|
| Raw report HTML | 1.84 MB | ~470K | 💥 never send to an LLM |
| Compact diff (+/- lines only, tags stripped) | 363 KB | ~93K | drop unchanged rows + HTML markup |
| Normalized + deduped | 180 KB | ~45K | strip per-company ids/values → 32 items → 19 patterns |
| `named_results` only (root-cause data) | 3.6 KB | ~900 | just the data diff (the `"" → null`) |

Only two files ever change per entry: `named_results` (data) and `rendered_text.md` (rendered
effect). `named_results` is the compact root cause (e.g. `"street_var": "" → null`);
`rendered_text.md` is the large downstream noise (rendered widgets: `<input>`, `<select>` with
30+ options, etc.).

**Recommended review pipeline (tiered + chunked, keeps every LLM call small):**
1. Never feed raw HTML to an LLM.
2. **Tier 1 — data diff (`named_results`, ~900 tokens):** answers "is this intended?" directly.
3. **Tier 2 — normalized+deduped rendered diff:** for rendered-effect review (e.g.
   liquidation_reserve's table, which only appears in `rendered_text.md`). Because normalization
   collapses N companies into a handful of **patterns**, feed **one pattern per LLM call**
   (map-reduce) — cost stays ~constant no matter how many entries are sampled.
4. Prototype extractor (no deps, HTML → compact/normalized/JSON):
   `scratchpad/compact_sampler.js`. Candidate to productionise as a CLI subcommand
   (e.g. `run-sampler --id <id> --compact`) or a workflow step that posts the compact diff.

---

## 3. Open / unanswered questions (resolve before "for real")

1. ~~**Gate vs review artifact?**~~ **RESOLVED (2026-07-01): review artifact, not a gate.** The
   reviewer checks the diff (LLM-assisted). No auto-fail on diffs. See 2.7.
2. ~~**What's inside `results.zip`?**~~ **RESOLVED: inspected — see 2.7** (HTML summary +
   per-entry before/after output). Review-without-blowup strategy defined.
3. ~~**`SF_BASIC_AUTH` as a GitHub secret.**~~ **RESOLVED: accepted, already configured as a secret.**
4. ~~**`firm_ids` source.**~~ **RESOLVED (see §6 D5): per-partner repo Variables + dispatch inputs.**
5. ~~**Which templates to sample.**~~ **RESOLVED (see §6 D2–D4): changed liquid content → template →
   in-scope partner grouping.**
6. **`queue: max` availability.** Beta key; confirm the target repo accepts it, else fall back to
   `queue: single`. (Design relies on it — §6 D8.)
7. **CLI release train.** `agustin-bso-sampler-easy-results` = #236 (run-sampler) + #257
   (basic-auth) + result-URL surfacing + spinner fix. Needs #236 merged and a CLI release/tag
   before production workflows can install from a stable ref instead of a branch.
8. **Port to shared repo.** Everything currently lives in `be_market` TEST files per
   [[feedback_shared_workflows]]; porting into `bso_github_actions` must be coordinated with the
   other 3 teams.

---

## 4. Implementation plan ("for real")

**Phase A — unblock (decisions + CLI):**
- A1. ~~Q1/Q2~~ RESOLVED (review artifact; zip inspected — see 2.7). Remaining decisions: Q3
  (`SF_BASIC_AUTH` secret), Q6 (`queue: max`).
- A2. Land CLI: merge PR #236; fold in basic-auth (#257 if not already on main) + the result-URL
  surfacing/spinner changes from `agustin-bso-sampler-easy-results`; optionally add the compact-diff
  extractor (2.7) as `run-sampler --compact`; cut a release/tag.

**Phase B — productionise the sampler workflow (still in `be_market`, off the TEST harness):**
- B1. Trigger: on PR (approval/label) → derive changed handles from the diff; group by partner (2.6).
- B2. Matrix over partners; each job: load `PARTNER_CONFIG_JSON` → `run-sampler -p <partner>
  -h <handles> --firm-ids <from var>` → write-back secret → summary link (already built).
- B3. `concurrency: { group: sampler-<partner>, queue: max }`; never cancel. Handle the
  "already in progress" 422 clearly (surface / optional poll-and-wait).
- B4. Review-only (Q1 resolved): surface the report link (done) + optionally attach the compact
  diff (2.7) to the PR / step summary so a reviewer (or an LLM, one pattern per call) can check it
  without downloading 154 MB or blowing up context. No auto-fail on diffs.
- B5. `firm_ids` from a repo variable (Q4). `SF_BASIC_AUTH` secret per Q3.

**Phase C — port to `bso_github_actions` (shared):**
- C1. Move the proven `refresh_token.yml` (sole writer, `*/10` cron) + read-only test runner +
  sampler workflow into the shared reusable repo. `secrets.*`/`vars.*`/`github.repository`
  resolve to the caller, so lifting works without rewiring.
- C2. Coordinate with the other 3 teams; roll out per market caller.

**Phase D — teardown the TEST harness (see 5).**

---

## 5. Artifacts inventory (test scaffolding to remove at Phase D)

**silverfin-cli branches:**
- `agustin-bso-sampler` — PR #236 (`run-sampler`), still open.
- `test-ci-sampler` — #236 + basic-auth #257 (OLD sampler code, no URL surfacing).
- `agustin-bso-sampler-easy-results` — **current**: #236 + basic-auth + result-URL surfacing +
  spinner fix + unit test. (pushed)
- `fix-staging-oauth-basic-auth` — the basic-auth fix (#257).

**be_market:**
- Draft PR **#2993** / branch `test-ci-auth-revalidate` ("[TEST HARNESS — do not merge]").
- Label `run-sampler-test` gates the sampler job (fires on the `labeled` event; re-add to re-run).
- TEST workflows: `run_sampler_TEST.yml`, `refresh_token_TEST.yml`, `run_tests_TEST.yml`.
- Secrets: `CONFIG_JSON_TEST` (firm, may expire — refresh before validating),
  `PARTNER_CONFIG_JSON_TEST` (partner api_key, sole writer = sampler job).
- Test partner env: staging partner `1` (gated); prod test partner `84` (503 — sampler not on prod).

**Re-trigger the sampler test run:**
```
gh pr edit 2993 --repo silverfin/be_market --remove-label run-sampler-test
gh pr edit 2993 --repo silverfin/be_market --add-label run-sampler-test
```

**Related memory:** `project_ci_auth_final_design`, [[feedback_shared_workflows]].
Original plan: `~/.cursor/plans/ci_auth_final_solution.plan.md`.

---

## 6. Production sampler workflow — locked design (grilled 2026-07-01)

Build/validate in `be_market` (caller) first per [[feedback_shared_workflows]]; port to
`bso_github_actions` later. One run per touched in-scope partner, in parallel (mixed PR → 2 runs).

- **D1 — Partner scope.** Configurable per-team **in-scope list**; be_market = `{1, 3}`. Partner
  84 (test) and any id not in the list are ALWAYS dropped.
- **D2 — Classification.** For each touched template: `keys(config.partner_id) ∩ in-scope`.
  Exactly one → that partner's group. Zero or >1 in-scope → **skip + log** (multi-partner is rare:
  `[1,3]`→skip, `[1,84]`→1, `[none]`/`[84]`→skip).
- **D3 — Sample scope (v1).** Changed **reconciliation_texts (`-h`) + account_templates (`-at`)**
  only. Shared parts deferred to **v2** (expand via `used_in` to dependent handles, same partner).
- **D4 — "Touched" filter.** **Liquid content only** — `main.liquid` / `text_parts/*.liquid`.
  `config.json`-only and `tests/`-only changes do NOT trigger.
- **D5 — firm_ids.** Per-partner GitHub **repo Variables** (`vars.SAMPLER_FIRM_IDS_1` /
  `_3`) as the automatic default; `workflow_dispatch` inputs for manual override.
- **D6 — Trigger.** ~~v1 (first release, decided 2026-07-10): `workflow_dispatch` ONLY~~
  **SUPERSEDED (grilled 2026-07-15, §8/Q14): auto-trigger on `pull_request_review` (`submitted`,
  `state == approved`) ships in THIS build**, not deferred to a later v2. `workflow_dispatch` is
  kept alongside it as a manual escape hatch (retry, debugging, `firm_ids_override`), per §8/Q14.
  Accepted trade-off: this reintroduces the exact risk D6 originally avoided — an expensive
  30–60 min, partner-blocking run now fires automatically on every approval, before the mechanism
  has been proven — flagged explicitly during grilling and kept anyway as a deliberate choice for
  this test round. Multi-approval double-fire (a PR needing 2+ approvals triggers twice) is
  accepted as-is, no dedup guard — rare, and `queue: max` (see D8) absorbs it harmlessly.
- **D7 — Auth.** `SF_BASIC_AUTH` secret (done). **Partner 3 staging creds + templates = hard
  prerequisite** to validate before enabling the partner-3 group → ship partner 1 live, partner 3
  gated until confirmed.
  - ~~CONFIRMED (2026-07-10): partner api_key has NO timer TTL~~ **CORRECTED (2026-07-15): the
    partner api_key DOES expire — TTL is 24h.** The "no TTL" claim below was wrong and this
    contradicts the "sampler needs no cron" conclusion it drove; superseded by §8's decision.
  - **RESOLVED (2026-07-15, via backend-code explanation from a colleague, not yet independently
    empirically reproduced): the 24h cutoff is SOFT, but only until a new DB snapshot lands.**
    - **24h expiry alone (no snapshot): self-heals, not a manual action.** Every normal endpoint
      rejects a token older than 24h, but `POST /partner/v1/refresh_api_key` skips the
      `api_key_updated_at` window entirely — it authenticates on **digest match alone**. An
      already-expired-but-still-known token can still call refresh and mint a fresh one,
      indefinitely, as long as the `api_key_digest` row still matches. This is exactly what the
      CLI's `config --refresh-partner-token` (and the sampler's own on-401 refresh) relies on — so
      the "no ongoing manual work" / "no keep-alive cron needed" conclusion holds for this case.
    - **A new DB snapshot overwriting staging: dead, and unrecoverable via the token.** The
      snapshot replaces the `partner_users` row (including `api_key_digest`) with whatever was in
      the snapshot source. The key the CI secret holds was hashed against the *old* row, so its
      digest matches nothing afterward — even `/refresh_api_key` then 401s. There is no self-heal;
      a human must regenerate manually in a Rails console (`PartnerUser#refresh_api_key`) and redo
      the local `authorize-partner` + `gh secret set` bootstrap (same one-time steps used to set up
      `PARTNER_CONFIG_JSON_11` originally).
    - **Operational takeaway:** if a sampler run ever 401s on partner auth, check whether staging
      was just refreshed from a new snapshot before assuming anything else is wrong — that's the
      one failure mode this design cannot self-heal, and CI will just fail cleanly (per the
      write-back gating in §8/Q6) rather than silently corrupt anything.
  - Sampler auth = load `PARTNER_CONFIG_JSON_<partner>` (per-partner secret, §8/Q4) → run → write
    the key back **only if a 401 rotated it mid-run**, detected by diffing the on-disk token value
    before/after the run (§8/Q6) rather than log-scraping. Sampler stays **sole writer** of its OWN
    per-partner secret. `refreshPartner` is rotate-on-refresh (`POST refresh_api_key?api_key=<cur>`
    invalidates the old key), which is *why* proactive refresh must never touch the sampler's key.
  - **PR #21 (`bso_github_actions`, `automatic_partner_credentials_refresh`) is NOT the sampler's
    auth path.** It folds partner refresh into the shared `check_auth.yml` `*/10` cron writing the
    shared `CONFIG_JSON`. For the sampler that would rotate the key 3–6× during a 30–60 min run →
    mid-run 401s. #21 is the "decouple/cron" pattern for *short* partner calls; the sampler is the
    "serialize/own-secret" pattern. They stay isolated because #21 uses `CONFIG_JSON` and the
    sampler uses a separate `PARTNER_CONFIG_JSON`. #21's CLI dep (`--refresh-partner-token`) is
    already on **main**; #21's own remaining prereq is adding partner IDs to `CONFIG_JSON`.
  - **Steady-state ("does this need any ongoing manual work?", resolved 2026-07-10): NO.**
    `SF_BASIC_AUTH` is permanent (beta is confirmed permanent; alpha reuses the same value). The
    partner key has no TTL and self-heals via write-back, so there is no routine per-run or
    per-week/month manual step. Write-back authenticates as `REPO_ACCESS_TOKEN`, a **1-year PAT**
    (set 2026-06-22, expires ~2027-06-22) — but **DECIDED: keep using it as-is, no GitHub App swap.**
    Reason: it's shared infrastructure used by other workflows too, so if it ever lapses, those other
    consumers break first and it gets refreshed immediately as a matter of course — it won't sit
    silently expired for a year unnoticed. The dedicated-App-token idea solved a problem (silent,
    isolated expiry) that doesn't actually exist here given the token is already load-bearing
    elsewhere and therefore self-alerting.
- **D8 — Concurrency.** Per-partner group `sampler-${{ github.repository }}-<partner>` with
  `queue: max`, **never cancel**. ~~fallback `queue: single`~~ **SUPERSEDED (§8/Q13, Q15): `queue:
  max` is required, not a nice-to-have**, now that D6's auto-trigger-on-approval makes 2+
  concurrent/queued runs for the same partner a normal occurrence (multiple approvals close
  together), not a rare manual double-dispatch — `queue: single`'s "cancel anything beyond 1
  pending" would silently drop a legitimately-approved PR's run.
  - **Lives inside the reusable workflow itself** (`bso_github_actions/run_sampler.yml`'s own
    top-level `concurrency:`, using `inputs.partner` — `github.repository` inside a called
    reusable workflow resolves to the *caller's* repo), not the wrapper — so every future adopter
    gets it for free with no way to forget it (§8/Q8; same lesson as §7.5's adopter-checklist gap).
  - **Confirmed real GitHub limitation (§8/Q10, user-caught): concurrency groups do NOT span
    repositories.** Two market repos sharing the same partner id (a real, known case, not
    hypothetical) can still race past this. Mitigated at the application layer instead: the
    reusable workflow polls-and-retries on the backend's own `"A sampler run is already in
    progress for this partner"` 422 (bounded, ~90 min to match worst-case run length) rather than
    failing immediately — treats the backend's server-side one-run-per-partner constraint as the
    true cross-repo mutex, since GitHub Actions can't provide one (§8/Q8).
- **D9 — Result surfacing (v1).** Each partner job posts a **PR comment** (changed counts + report
  link) and uploads **`results.zip` as a workflow artifact**.
  - **DECIDED (2026-07-10): include the compact diff in v1.** `--compact` is **deterministic zip
    parsing — runs in seconds**, so it goes **inline in the same job**, after the run completes and
    the zip downloads. Post **ONE** PR comment containing link **+** compact diff together — never
    post the link early, so the reviewer never sees a "link but no summary yet" half-state.
  - The **LLM prose summary (other team's skill)** is the only genuinely-async part. It appends to
    the same comment under a clearly-labeled `🤖 AI summary` section when ready — so it reads as
    "more is coming," not "broken." Deterministic compact ≠ LLM summary: only the latter is async.
  - **BUILT + VALIDATED LIVE (2026-07-10):** `run-sampler --compact` shipped on
    `agustin-bso-sampler-easy-results` (`lib/liquidSamplerCompact.js` + wiring in
    `liquidSamplerRunner`/`bin/cli.js`, `adm-zip` dep, unit+E2E tests). Selectively extracts only
    `sample_entry_ids.yml` + every `registers.json` from the result zip (skips the ~150 MB rendered
    output), diffs `named_results` before/after, groups by template handle, dedupes identical
    changes with counts, prints between `<!-- SAMPLER_COMPACT_START/END -->` markers. Verified twice:
    against a real downloaded `results.zip` locally (228 entries → 22 changed → ~7 KB output), and
    **live in `be_market` run `29084202045`** (alpha staging, partner 1, `vkt_1` + `liquidation_reserve`,
    230 sampled entries) — produced `**1** template(s) changed across **24** entries` with deduped
    `city_var`/`street_var`/`number_var`/`rpr_value` changes, run GREEN in 33m54s including write-back.
    The `run_sampler_TEST.yml` harness now also carries a **TEST-only `SF_HOST` override to alpha**
    (production stays beta — the sampler backend just isn't up on beta yet) and reads `firm_ids` from
    an optional dispatch input falling back to a `SAMPLER_FIRM_IDS_1` repo Variable (D5 shape).

**Job shape (per partner):** load partner creds → `run-sampler -p <partner> -h <handles…>
-at <names…> --firm-ids <vars>` → PR comment + upload artifact. CLI installed from
`silverfin-cli#agustin-bso-sampler-easy-results` until #236 merges + a release (Q7).

**Still open after grilling:** Q6 (`queue: max` beta accepted?), Q7 (CLI release), Q8 (port to
shared repo), + the D7 partner-3 staging validation prerequisite.

---

## 7. `push_to_review_firm.yml` auth-poisoning incident + fix (2026-07-14/15) — LIVE-VALIDATED

### 7.1 Incident
`bso_github_actions` PR #24 (merged) added `push_to_review_firm.yml`: a reusable workflow, wrapped
in `be_market`, triggered by a Jira Automation `repository_dispatch` so a PM can push a dev PR's
templates to their review firm. Almost every dispatch targets firm **400583**. Its own PR
description states it's *"Reader-only on CONFIG_JSON... relies on the existing refresher."*

Two `be_market` failures 2026-07-14, ~1h20m apart:
- run `29314984998` (push_to_review_firm, 07:34) — failed at "Find open PRs" (unrelated: dev
  ticket key `BE-13884` matched no open PR branch — separate bug, still open).
- run `29318715898` (`run-tests / check-auth / refresh-tokens`, 08:55) — `invalid_grant` refreshing
  firm 400583 specifically (`invalid, expired, revoked... or issued to another client`). Firms 1355
  and 14400 refreshed fine in the same run.

Manual re-authorization of firm 400583 applied 2026-07-15 as an immediate (non-durable) fix.

### 7.2 Root cause
The "reader-only" claim is true of the workflow script but not of the CLI it shells out to:
- `lib/api/axiosFactory.js` (`#addFirmTokenRefresher`) transparently refreshes the access token on
  **any** 401, for **any** command — not just `config --refresh-token`.
- `firmCredentials.storeNewTokenPair` writes the refreshed pair **only to the local
  `~/.silverfin/config.json`** on the runner — no path back to the GitHub secret exists in the CLI.
- `push_to_review_firm.yml` is chatty against one firm (per-template `update-*` calls + a full
  `add-shared-part --all` sweep over ~80 templates per run) and dispatched at unpredictable times,
  fully decoupled from `check_auth.yml`'s refresh cadence (which today only fires when
  `run_tests.yml` fires — **no dedicated cron exists in production**, unlike what §1 intended).
- So: whenever a run's access token happens to be near/at its 2h expiry, the interceptor silently
  refreshes it — rotating the refresh token server-side — and the rotated pair dies with the
  ephemeral runner. `CONFIG_JSON` still holds the now-already-consumed refresh token. The next thing
  to use it (`check_auth.yml`'s explicit refresh, the sole writer) gets `invalid_grant`.

**Why now, not before:** nothing pre-PR#24 hit firm 400583 with frequent, chatty, live traffic
outside `check_auth.yml`'s own refresh call. PR #24 introduced the first consumer both frequent
enough and decoupled enough from the refresh cadence to land on a stale-token window and silently
corrupt the shared secret.

**Related gap found:** production `test-templates` (`bso_github_actions/run_tests.yml`) also loads
the *live* `CONFIG_JSON` (no stripping) — the read-only/stripped M2 design (§1) was only ever
ported into the `be_market` TEST harness, never into the shared repo. Same theoretical exposure,
just not yet exercised hard enough against one firm to manifest.

### 7.3 Fix, decided via grilling (2026-07-15)
- **Stripped read-only for `push_to_review_firm`** (same M2 mechanism as §1's tests, applied to a
  new consumer type), not the sampler's write-back pattern — a push run is short (~1 min even for
  the big sweep), so the risk is a *stale* token at start, not expiry mid-run. A stale token now
  fails cleanly (empty refresh token → Silverfin rejects → nothing rotates) instead of silently
  poisoning `CONFIG_JSON`. Trade-off accepted: occasional PM retry instead of a systemic secret
  corruption.
- **Add a `be_market`-local scheduled wrapper** (`on: schedule` → `uses:
  .../check_auth.yml@main`, mirroring `push_to_review_firm.yml`'s own wrapper pattern) to shrink the
  staleness window that produces that occasional retry. Correction from earlier in the grilling
  session: this does **not** require editing the shared `bso_github_actions` repo or coordinating
  with the other 3 teams — a `schedule:` trigger only fires in the repo containing the workflow
  file, so it's a `be_market`-only addition, same low blast radius as the strip fix. Cost confirmed
  negligible: `be_market`'s `CONFIG_JSON` has 8 firms, full refresh loop ≈ 8s.
- **No dead-man's-switch monitor** for silently-dropped cron ticks (GitHub's own docs: `schedule`
  runs on a best-effort queue and "some queued jobs may be dropped" under load — a failure-only
  Slack alert wouldn't catch a tick that never ran at all). Decided not worth building — the
  stripped-read failure mode is already visible and cheap to retry.
- **Rollout timing:** other teams are about to start calling `push_to_review_firm.yml`. Decided:
  land the strip fix **this sprint** (not a hard blocker on their onboarding), and add a
  "`push_to_review_firm` adopter checklist" (strip step already in the shared file + each market
  adds its own cron wrapper + its own firm IDs) so future adopters don't reproduce this against a
  different firm in a different repo.

### 7.4 Live validation (2026-07-15) — DONE
Validated end-to-end rather than by code review alone, since `push_to_review_firm` mutates a real
firm (unlike the read-only test-runner M2 already validated in `run_tests_TEST.yml`).

**Setup:** branched `bso_github_actions@ci-auth-strip-refresh-token-test` (the `jq` strip added to
the "Load Silverfin credentials and set firm" step — same expression as `run_tests_TEST.yml`).
Pointed a throwaway `be_market` PR (#3028, closed + branch deleted after validation) at that branch
ref, targeting **firm 1355** (already firm-authorized, already has `2018_204_3_writedowns_provisions`
pushed to it).

**Results:**
- **Happy path** (run `29406438499`): valid token, strip in place → pushed clean
  (`[success] Reconciliation updated: 2018_204_3_writedowns_provisions`), PR comment posted
  correctly (`✅ All changed templates were pushed to review firm 1355`). Stripping doesn't break
  normal operation.
- **Forced-401 path** (run `29406540183`, via a test-only, never-merged commit on a
  `-force401` branch that overwrites the loaded access token): failed cleanly —
  `[error] Response Status: 400 (Bad Request)` / `Error refreshing credentials. Try running the
  authentication process again` — job exit 1, PR comment correctly shows `❌ update failed`. No
  silent success, no crash into an unreadable state.
- **No-poison confirmed:** immediately after the forced-401 run, triggered `run_tests.yml` for real
  (run `29406624257`) — `check-auth/refresh-tokens` refreshed **all 8 firms including 1355**
  successfully. Firm 1355's real refresh token in `CONFIG_JSON` was untouched by the forced-401 run,
  exactly as designed.

All throwaway artifacts cleaned up: PR #3028 closed + branch deleted, `-force401` branch deleted.
The clean `ci-auth-strip-refresh-token-test` branch (strip step only, no test-only debug code) is
**parked in `bso_github_actions`, not yet opened as a real PR** — candidate base for the actual fix.

### 7.5 Action items
- [ ] Open the real PR from `ci-auth-strip-refresh-token-test` against `bso_github_actions@main`.
- [ ] Add the `be_market`-local scheduled wrapper calling `check_auth.yml` (own PR, `be_market`-only).
- [ ] Port the same `jq` strip into production `test-templates` (§7.2's related gap).
- [ ] Write the `push_to_review_firm` adopter checklist (strip already-shared + per-market cron
  wrapper + per-market firm ids) before/alongside the other teams onboarding.
- [ ] Separately: fix the unrelated "Find open PRs" branch-matching bug (hit twice: `BE-13884` on
  2026-07-13 and 2026-07-14).

---

## 8. Production sampler GitHub Action — single-market test build (grilled 2026-07-15/16)

Concrete implementation decisions for the Phase C port (§4/§6), reached by grilling before
staging came back up. Builds directly on the locked D1–D9 design; entries below are additive,
cross-referenced from D6–D8 above where they supersede something.

**Architecture split (Q1):** the **wrapper** (`be_market`) owns checkout, diff, and D2/D3/D4
classification — these encode `be_market`-specific conventions (`config.json`'s `partner_id`
shape, the `main.liquid`/`text_parts/` layout) that shouldn't become a hard dependency for the
other 3 teams. The **reusable workflow** (`bso_github_actions`) is reduced to "given a partner +
handles + account templates + firm_ids, run the sampler and post the comment" — no git/diff logic,
no knowledge of the caller's repo layout. Also decided: **no "not ready for adoption" header
banner needed** — nothing auto-invokes a `workflow_call`-only reusable workflow, and since no
other market is wiring up its own wrapper yet, the visibility risk is accepted as moot for now.

**PR resolution + changed files (Q2, Q3):** mirrors an existing, near-identical precedent —
`bso_github_actions/check_dependencies.yml` already does "optional `pull_request_number` input,
resolve via `actions/github-script` (`pulls.get` for base/head sha, `pulls.listFiles` paginated for
changed paths), post a PR comment via a `<!-- marker -->` upsert." Adopted verbatim rather than the
`git diff origin/base...origin/head` approach `push_to_review_firm.yml` uses (that workflow needs
raw git diff only because it juggles *multiple* PRs matched by branch name — not our shape).
**Classification comment includes skipped templates with reasons** (not log-only), in one PR
comment per run (three-marker structure below), matching D9's "one comment, not a drip" house
style.

**Classification script (Q11, Q12):** confirmed by reading `lib/liquidSamplerRunner.js:187-201`
and `lib/utils/fsUtils.js:125-134` — both `-h` and `-at` values are the **directory name** under
`reconciliation_texts/`/`account_templates/` (the CLI does `path.join(FOLDERS[type], handle,
"config.json")` directly), not the `handle`/`name_en` fields inside `config.json` (display-only).
So classification only needs `partner_id` keys for routing, not those fields. **One combined
`run-sampler` call per partner** takes both `-h` and `-at` together (confirmed: both are options on
the same CLI command, §2.4a's one-run-per-partner constraint would make two separate calls per
partner actively harmful, not just redundant).

**Secrets — per-partner, not shared (Q4):** `PARTNER_CONFIG_JSON_1` / `PARTNER_CONFIG_JSON_3`,
mirroring D5's per-partner Variables. Reasoning: D8's per-partner concurrency groups deliberately
let partner-1 and partner-3 runs execute in parallel — a single shared secret would then have a
genuine read-modify-write race between them (same shape as the §7 incident: a "sole writer" claim
true per-partner but not globally). Dynamic per-partner secret/var lookup in the matrix job uses
expression indexing: `secrets[format('PARTNER_CONFIG_JSON_{0}', matrix.partner)]`,
`vars[format('SAMPLER_FIRM_IDS_{0}', matrix.partner)]`. `fail-fast: false` on the matrix is
load-bearing, not cosmetic — default fail-fast would cancel a still-running partner's job, and
cancelling doesn't cancel the backend run (§2.3), just orphans it.

**`firm_ids_override` scope:** a single dispatch input, applied uniformly to every partner in that
run (not per-partner overrides) — confirmed as the intended shape, not an oversight.

**Write-back gating (Q6):** the CLI has no reliable "a rotation happened" signal at default log
level (only a `consola.debug` line, silent unless `-v`) — confirmed via code read. Gates the write
on a **before/after diff of the on-disk token value**
(`jq -r '.partnerCredentials[$partner].token'`), not a log grep — deterministic, and avoids the
same class of fragility §7.2/commit `91f754f` already had to fix once (trusting CI-parsed stdout
that template- or format-dependent content could spoof).

**Result comments — three markers (Q9):** `<!-- silverfin-sampler-classify -->` (classification,
one per run), `<!-- silverfin-sampler-result-<partner> -->` (one per partner, independent so a
gated/absent partner-3 run never clobbers partner-1's comment). LLM prose summary integration
(D9's async append) is **explicitly out of scope for this build** — no marker-append contract
needs to be finalized now.

**Artifact upload (Q12):** full `results.zip` uploaded (not just the compact output) since the raw
per-entry output is occasionally needed for rendering-only regressions the compact
`named_results` diff can't see (§2.7's `liquidation_reserve` example). **Retention: 7 days** — the
presigned GCS report link (D9/§2.5) is the long-lived source of truth; the workflow artifact is
just a short-lived CI-native convenience copy.

**CLI install:** plain unpinned `npm install https://github.com/silverfin/silverfin-cli.git`,
matching every other production workflow's convention (none pin to a branch/SHA/tag) — no
branch-pointing needed since `agustin-bso-sampler-easy-results` merges to main before this is
actually run.

**Validation plan (all 4 required before considering this validated, blocked on staging as of
2026-07-15):**
1. Happy path — real partner-1 PR, approved, auto-fires, clean run, correct comment, write-back
   only if the token actually rotated.
2. Forced-401/rotation path, mirroring §7.4's methodology exactly: force a 401 mid-run, confirm (a)
   only `PARTNER_CONFIG_JSON_1` is written, (b) firm `CONFIG_JSON` is untouched, (c) a subsequent
   unrelated `run_tests.yml`/`check_auth.yml` run still refreshes all firms cleanly afterward — the
   explicit no-poison re-check §7.4 did for `push_to_review_firm`.
3. ~~The 24h TTL soft-vs-hard experiment~~ **DOWNGRADED to optional (D7 resolved 2026-07-15 via a
   backend-code explanation, not yet independently reproduced by us): 24h-alone self-heals through
   `refresh_api_key`'s digest-only check; only a new DB snapshot overwriting `partner_users` breaks
   it, unrecoverably via the token.** Worth confirming empirically only opportunistically (e.g. if a
   run naturally idles >24h between dispatches) — no longer worth deliberately engineering.
4. A genuine cross-repo-collision drill: trigger overlapping runs from two repos against the same
   partner, confirm the poll-and-wait (D8) actually works against a real 422.

**Still open going into implementation:** the exact `run_sampler.yml` / wrapper YAML files
themselves haven't been written yet — this section is the locked design to write them from, not
the files. Also still open: D7's partner-3 staging-creds prerequisite, and whether `queue: max` is
actually accepted on the target repos' GitHub plan (only matters once real testing starts).

---

## 9. Pilot switched to `lu_market`; §8 design built (2026-07-15)

Pilot repo changed from `be_market` to `lu_market` for the §8 production build (§6/§8's design is
repo-agnostic, so this is just a different caller). `lu_market` has a single partner (`11`) across
every template, so D2's zero/multi-partner skip path is real but currently untested by real data —
kept generic anyway in case a second partner is added later.

**Built (draft PRs, not yet mergeable/testable — staging is still being set up):**
- `bso_github_actions#30` — `run_sampler.yml`, the reusable workflow from §8: retry-on-cross-repo-422,
  token-diff-gated write-back, per-partner `concurrency: { group, queue: max }` inside the reusable
  workflow itself, `results.zip` as a 7-day artifact, per-partner PR comment.
- `lu_market#762` — the wrapper: `pull_request_review` (approved) auto-trigger + `workflow_dispatch`
  escape hatch, D1-D4 classification (Liquid-content-only, `config.json` `partner_id` ∩
  `SAMPLER_IN_SCOPE_PARTNERS`), classification PR comment, per-partner matrix (`fail-fast: false`)
  into the reusable workflow.
- `lu_market` repo variable `SAMPLER_IN_SCOPE_PARTNERS=11` set live (non-secret, safe to set ahead
  of staging).
- Both files pass `actionlint` (one expected false positive: `queue: max` isn't in actionlint's
  schema yet — same key already validated on staging in the `be_market` TEST harness).

**Not done yet (blocked on staging / real credentials, not on more building):**
- `PARTNER_CONFIG_JSON_11` secret (needs `silverfin authorize-partner -i 11 -k <api-key>` against a
  real partner-11 staging api_key).
- `SF_BASIC_AUTH` secret on `lu_market` (same value already used elsewhere, just needs copying in).
- `SAMPLER_FIRM_IDS_11` repo variable (needs real staging firm ids for partner 11).
- `silverfin-cli` PR #261 (`agustin-bso-sampler-easy-results`) merge to `main` — the reusable
  workflow's CLI install is intentionally unpinned, so it picks this up automatically once merged;
  until then a real run would still work but without `--compact` / clean CI output.
- The full §8 validation plan (4 items) — unchanged, still blocked on staging.

**Host: beta, not alpha (decided 2026-07-15).** lu_market's `PARTNER_CONFIG_JSON_11` will be set up
against `bso-staging-beta.staging.getsilverfin.com` — no `SF_HOST` override needed in `run_sampler.yml`
(it only reads whatever `.host` is stored in the secret; the TEST harness's alpha override was a
workaround for the backend not being live on beta yet, not a permanent requirement). Caveat: the last
real check (§2.5/§8, 2026-07-01) only confirmed the sampler backend live on alpha — worth a smoke test
against beta once it's up, in case beta still 503s the way prod did back then.

**Update (2026-07-15, later same day): beta confirmed live, manual smoke test PASSED.**
- Beta staging came up. Unauthenticated reachability check (no credentials needed) showed `401` +
  `WWW-Authenticate: Basic realm="traefik"` on the beta host — not a `503` — confirming the backend
  is up, before any partner credentials were touched.
- `PARTNER_CONFIG_JSON_11`, `SF_BASIC_AUTH`, and `SAMPLER_FIRM_IDS_11=1554` are all set on `lu_market`.
- Neither `bso_github_actions#30` nor `lu_market#762` is merged yet (`workflow_dispatch` only
  registers from a repo's default branch — confirmed via the Actions API — so neither is
  live/dispatchable pre-merge), and the author is deliberately holding `silverfin-cli#261` unmerged
  too. So GitHub's own secrets can't be exercised by a live Actions run yet (a secret's value is
  never retrievable outside of an Actions run — not via `gh secret list`/API, by design).
- Validated instead with a **manual local CLI run** against beta, using an isolated throwaway `HOME`
  (never touching the real `~/.silverfin/config.json`): `run-sampler -p 11 -h
  lux_aa_an_intangible_fa --firm-ids 1554 --compact` from inside the `lu_market` checkout, using the
  `agustin-bso-sampler-easy-results` (#261) CLI build. **Result: worked.** This confirms partner 11's
  api_key + `SF_BASIC_AUTH` + firm 1554 are all correctly wired against beta, and the beta backend
  genuinely runs the sampler end-to-end (not just network-reachable).
- **Bug found and fixed while pre-testing (not this run, a prior local dry-run of the reusable
  workflow's bash logic with a mocked CLI):** the `REPORT_URL` extraction's `grep -oE` found no match
  on a non-completed run, and under `set -eo pipefail` that aborted the whole step *before*
  `report_url`/`compact` outputs were set — silently dropping the PR comment (no `if: always()`) on
  every failed/timed-out run. Fixed with `\|\| true` in `bso_github_actions#30` (commit `47fd951`).
- **Still not validated:** the actual GitHub Actions path (reusable workflow + wrapper) end-to-end —
  this local run bypassed Actions entirely. Write-back gating, PR comment posting, per-partner
  concurrency queueing, and the cross-repo 422 collision drill (§8 validation items) all still need a
  real dispatched run, which needs at least `bso_github_actions#30` + `lu_market#762` merged (not
  `silverfin-cli#261`, which only affects `--compact`/report-URL polish, not core auth/run mechanics).

**Update (2026-07-15, later still): full GitHub Actions path LIVE-VALIDATED end-to-end, PASSED.**

Realized `workflow_dispatch`'s default-branch restriction doesn't apply to `pull_request`-family
events (including `pull_request_review`): those resolve the workflow file from a merge of base+head,
so they run whatever version exists **on the PR's own branch** — this is exactly why `be_market#2993`
could validate pre-merge via `pull_request: types: [labeled]`. Reusable-workflow `uses:` refs can also
point at any branch of the external repo, not just `@main`. Combined, this meant the whole pipeline
could be live-tested with **zero merges** to either repo:

- Branched off `lu_market@add-liquid-sampler-workflow`, pointed the wrapper's `uses:` at
  `bso_github_actions@sampler-production-workflow` (the draft PR branch, not `@main`) instead of
  editing the real PR, added a no-op comment to `lux_aa_an_intangible_fa` (partner 11) so
  classification had something real to detect. Opened as throwaway PR `lu_market#763`
  ("[TEST HARNESS — do not merge]"), mirroring `be_market#2993`'s pattern exactly.
- Self-approval is blocked by GitHub (same account as the PR author) — worked around by relaxing
  *only this throwaway branch's* trigger to also accept a self-submitted "commented" review
  (`pull_request_review`'s `state == 'commented'`), since GitHub does allow that on your own PR.
- **Three real bugs found and fixed by this live run, none caught by the earlier local script
  extraction tests** (which only exercised individual step scripts in isolation, not real job/env
  wiring):
  1. `SF_API_CLIENT_ID`/`SF_API_SECRET` were only step-scoped on "Run liquid sampler", not on
     "Install silverfin-cli" — the CLI checks for them at startup for *every* command, including a
     bare `-V` probe, so that step failed with "Missing API credentials" before ever reaching the
     real work. Fixed by hoisting both to job-level `env:` (`bso_github_actions` commit
     `06aaaf7`), matching this repo's existing `check_auth.yml`/`run_tests.yml` convention.
  2. The write-back step's `if: always()` meant a run that failed at "Load PARTNER_CONFIG_JSON" (a
     genuinely invalid secret, see next point) still ran, compared an empty before-token (that
     step was skipped) against whatever the after-token happened to parse to, read that as
     "rotated", and wrote the same invalid content straight back to the secret. No actual data
     loss (it wrote back exactly what it read), but wrong logic regardless — fixed by gating on
     `steps.before.outcome == 'success'` (commit `7dfa1a6`).
  3. **`PARTNER_CONFIG_JSON_11`'s original content (as set up earlier that day) turned out to be
     missing a valid `partnerCredentials.11.token` entry** — a real setup mistake, not a workflow
     bug. Recovered by reusing the exact `config.json` from the earlier-successful manual local
     smoke test (still on disk at `/tmp/sf-smoke-test/.silverfin/config.json`, proven working) and
     pushing that directly as the secret, instead of redoing `authorize-partner` from scratch.
  4. **Unconditional `--compact` in every `run-sampler` invocation is a hard dependency, not a
     nice-to-have**: before `silverfin-cli#261` was merged, the installed (unpinned, from `main`)
     CLI didn't recognize `--compact` at all, so every real run failed immediately with
     `error: unknown option '--compact'` — not "runs, just without the polish" as earlier assumed.
     Confirmed live, then re-validated clean immediately after the author merged `#261`.
- **After all four fixes + the #261 merge, a full live run passed end-to-end**
  (`lu_market` run `29438079460`, 36m1s): classify correctly detected partner 11 +
  `lux_aa_an_intangible_fa` → posted the classification comment → reusable workflow loaded
  `PARTNER_CONFIG_JSON_11` → ran the real sampler against beta (firm 1554) → completed successfully
  → wrote `Sampler report: <url>` → posted the compact diff (a real `ecdf_file_name` timestamp
  change in `lux_aa_settings`, unrelated noise from the live sample re-run, not our no-op edit —
  exactly the "review artifact, human judges intent" behavior by design) → downloaded and uploaded
  `results.zip` as a 7-day artifact (19.8 MB) → posted the result PR comment. Write-back correctly
  did **not** fire (token didn't rotate this run, confirmed via the secret's unchanged timestamp) —
  the no-op path is proven; the actual rotation-and-write-back path is logically sound (code
  reviewed, exercised locally in isolation) but has not fired on a genuine mid-run 401 yet.
- Cleaned up: `lu_market#763` closed, `test-sampler-live-harness` branch deleted (both remote and
  local). The real `lu_market#762`/`bso_github_actions#30` branches were never touched by any of the
  throwaway overrides (verified after cleanup).
- **Still not validated:** the cross-repo 422 collision drill (§8 validation item 4, needs two
  overlapping runs from different repos against the same partner) and a genuine token-rotation
  write-back (needs a real mid-run 401, not something to force deliberately). Both are edge cases,
  not core-path blockers — `bso_github_actions#30` and `lu_market#762` are otherwise validated and
  ready to merge for real.

---

## 10. Compact-diff v2 + three-repo rollout (2026-07-22)

Trigger for this session: reviewing `nl_market#894`'s real sampler run (a `[TEST HARNESS — do
not merge]` PR that deliberately breaks `general_settings`) surfaced that the `named_results`-only
compact diff (§2.7/§8-D9, shipped in #261) missed real signal and got unreadable fast — 78 KB /
~19.7K tokens on a 202-entry run, with no way to tell "template broke entirely" from "this one
field changed" at a glance.

### 10.1 What's actually inside `registers.json` (measured against a real zip, not assumed)
Beyond `named_results`, a real `registers.json` also carries: `results` (the un-keyed sibling
register — see 10.2), `dependencies`, `rollforward_params`, `required_keys_missing` (all real
signal, see 10.3), and `translations` / `default_values` / `currency_format` / `text_properties` /
`period_drops` (noise — `text_properties` embeds Ruby object memory addresses that differ every
render regardless of any real change; the rest are lazily-populated Liquid side effects, not a
reliable data signal, and one real entry showed ALL of them flip to `null` simultaneously — a
render-collapse artifact, not five independent findings). **Lesson for next time a
`registers.json` field looks interesting: check whether it's genuinely templated data (dedupes
well across companies, like `required_keys_missing`) or company-specific noise (fragments into
many near-identical one-off lines, like `dependencies`'s ledger IDs) before deciding how to
summarize it.**

### 10.2 `results` register — template-dependent semantics, not universally boolean
`results` is a plain array of stringified numbers, one array per entry (not keyed like
`named_results`). For reconciliation-check-style templates it's consistently `["0.0"]`/`["1.0"]` —
a triggered/not-triggered flag, best shown as a triggered-indicator count (e.g. `1/1 triggered`).
For other templates (e.g. some account entries) it holds raw values (`["996.08", "0.0", ...]`) —
counting "1"s there would be meaningless. Detected per-array at diff time (all-0/1 → flag-count
format, else → plain value diff), not assumed globally from one example.

### 10.3 New compact-diff tiers (`silverfin-cli#265`, branch `sampler-compact-diff-v2`)
- **`results` diffed alongside `named_results`** (10.2's heuristic).
- **"Output vanished" collapse detection**: when ≥3 `named_results`/`results` keys flip to
  `undefined` in a single entry, that's the render breaking, not N independent findings — grouped
  as one line per template (`ac_policies_BS — 3 entries collapsed`, sub-lines deduped by lost-key
  count with `[N×]`), not one line per lost key. Below the threshold (1-2 keys), stays in the
  normal per-key data diff — matches the pre-existing (§2.4e/§8) "broken export doesn't fail the
  run, shows up as a diff inside the artifact" behavior, just summarized instead of enumerated.
- **Scope/dependency tier** (`dependencies`/`rollforward_params`/`required_keys_missing`), kept
  separate from the data diff so a dependency change is never mistaken for a data regression.
  `dependencies` renders as **one sub-line per category** (ledgers/handles/account
  ranges/company.attributes) — packing them into one semicolon-separated line (the first cut of
  this feature) was unreadable and got explicit user feedback to fix.
- **Visual-only tier**: entries where `view.html` changed but the data diff found nothing — a
  rendering-only regression invisible to `named_results`/`results` (the exact gap §2.7 flagged but
  never built: "the compact `named_results` diff can't see rendering-only regressions"). Described
  **field-by-field**, anchored on Silverfin's `data-name` attribute on `<textarea>`/`<input>`/
  `<select>` tags (added/removed field, value change, placeholder change) — a lightweight
  regex-based extractor, not a full HTML parser, kept deliberately narrow. Real coverage measured
  on the PR #894 zip: 3 of 9 visual-only entries got a concrete field-level explanation; the other
  6 (table-wrapper/layout changes with no `data-name` anchor) fall back to an honest "compare the
  two `view.html` files directly" note rather than guessing. **Only surfaced when the data tier
  found nothing** — if `named_results` also changed, the visual diff would just be a noisier
  restatement of an already-explained finding.
- **Truncation + caps**: long values (paragraphs, notes) elided past ~100 chars; per-template/
  per-entry change lists capped (8 shown) with an explicit "+N more" disclosure — never a silent
  drop. This, more than any single tier, is what fixed the original size complaint.
- **Net effect, measured on the real PR #894 zip** (202 entries, 6 templates data-changed + 21
  collapsed + 9 visual-only): **78 KB → ~28-32 KB**, while covering strictly more signal than the
  v1 format did.
- **New `run-sampler --from-zip <path>`**: builds the compact diff from an already-downloaded
  `results.zip`, zero network/backend calls — lets you re-analyze a real result (or iterate on the
  compact-diff format itself, as this whole session did) without a 30-60 min re-run against the
  shared staging backend. Selective extraction now also grabs `view.html` (previously just
  `registers.json` + `sample_entry_ids.yml`) to feed the visual tier.
- **Known gap, not yet built**: `--compact`'s temp extraction dir is deleted immediately after
  printing, so a visual-only finding's printed file path isn't actually openable afterward without
  manually re-unzipping. A `--keep-extracted <dir>` flag would fix this; flagged, not built.

### 10.4 Presigned report-URL TTL — §2.5's claim was wrong
§2.5 claimed "Long/far-future `Expires`, so the summary link stays valid well after the run."
**Measured directly against a real `nl_market#894` comment this session: the `Expires` param
decoded to ~5 minutes after the run completed**, not long-lived at all — that earlier claim was
either specific to one historical run or simply mistaken. **Practical takeaway: don't design
around the report link being durable.** If it's expired, re-fetch fresh results via `run-sampler
--id <sampler-id>` (still works, re-authenticates) rather than assuming the printed/commented URL
is good indefinitely.

### 10.5 GitHub Actions mechanics learned this session (load-bearing, not incidental)
- **`npm install https://github.com/<org>/<repo>.git` with no `#ref` installs the DEFAULT branch,
  fresh, every run** (confirmed: no `actions/cache` anywhere in `bso_github_actions/run_sampler.yml`).
  This means merging to `silverfin-cli`'s `main` is the *entire* rollout mechanism for every repo
  using the reusable `run_sampler.yml` — no per-caller workflow change needed once merged.
- **To point at an unmerged branch instead** (for feedback-gathering before merge, exactly what
  this session did): append `#<branch-name>` to the git URL
  (`npm install .../silverfin-cli.git#sampler-compact-diff-v2`). Works whether or not there's an
  open PR against that branch — only branch existence matters. **Corollary risk**: if that branch
  gets deleted (e.g. auto-delete-on-merge) while a caller still points at it, the caller's next
  `npm install` fails outright. Revert callers back to tracking `main` *before/as part of* merging
  the source branch, not after.
- **Correction to the §9 "workflow file resolves from the PR branch" finding**: §9 found that
  `pull_request`-family events (including, it assumed, `pull_request_review`) resolve the workflow
  file from the PR branch itself, enabling zero-merge live testing. **Directly contradicted this
  session**: `nl_market`'s `run_sampler.yml` existed only on open PR #893's branch (not on
  `main`), and its `pull_request_review`-triggered runs simply never fired — confirming
  `pull_request_review` resolves the workflow file from the repo's **default branch only**,
  unlike whatever event(s) §9's zero-merge tests actually exercised (`pull_request: types:
  [labeled]`, per that section's own detail — not `pull_request_review`). **Practical
  consequence: there is no zero-merge live-test path for a `pull_request_review`-triggered
  workflow change** — activating/testing one for real requires actually merging it to the target
  repo's default branch.
- **The shared reusable workflow has no input to override just the CLI install source.** To test
  an experimental CLI branch in a caller without modifying `bso_github_actions` itself (per
  standing [[feedback_shared_workflows]] guidance — shared across 4 teams, fork/experiment in the
  caller first), the caller's job must be **fully inlined** (copy the reusable workflow's steps
  directly into the caller's own wrapper, translating every `inputs.X`/`secrets.X` reference to
  the caller's own `matrix`/`needs`/`secrets` expressions) — only the install line actually
  differs. Verbose (~270 lines duplicated per caller) but correct and reversible; revert to the
  single `uses:` block once the experiment concludes.
- **Repo-rename gotcha**: the local `bso_github_actions` checkout's `origin` remote still points
  at an old repo name (`silverfin/example_liquid_repository`) — pushes succeed via GitHub's
  redirect, but `gh pr create --repo <name>` needs the *current* slug. Check `git remote -v`
  before assuming a directory's name matches its actual repo.
- **`actionlint` false-positives on `queue: max`** (a real GitHub Actions BETA concurrency
  sub-key, not yet in actionlint's schema) — confirmed identical single warning against both the
  original shared workflow and every inlined copy. Known, not a real issue, don't chase it.
- **Git footgun, caught live**: a plain `git commit -m "..."` with no pathspec commits the
  **entire index**, including anything `git add`ed earlier for a *different* purpose — not just
  what you just staged in the current step. Caught this session when `CI_AUTH_SAMPLER_PLAN.md`
  (pre-staged from earlier, unrelated work) got swept into a commit meant to exclude it. Fix:
  `git commit -m "..." -- <explicit paths>` scopes the commit regardless of what else is staged,
  or `git reset <file>` to unstage first. Always check `git status --short` for a stray `A`/`AM`
  on a plain `git commit`.

### 10.6 Real bugs found (and where they actually lived)
Both found via CodeRabbit review on the inlined copies, both actually inherited from the shared
`bso_github_actions/run_sampler.yml` (or its accompanying wrapper boilerplate) — fixed at the true
source, not just patched per-copy:
1. **TOCTOU race (critical)**: the classify job's trigger `if:` gate validates the approval's
   `commit_id` against the PR's head SHA *at trigger time*, but "Get PR details" then re-fetches
   the PR's *live* head via the API — a commit pushed between approval and that step would get
   checked out and sampled, with real partner credentials, despite never having been approved.
   Fix: re-validate the freshly-fetched head against `context.payload.review.commit_id` on
   `pull_request_review` events, fail closed on mismatch. This is wrapper-side boilerplate
   (`nl_market`/`lu_market`'s own `classify` job, copied from a common template) — fixed
   identically in both; **lu_market's copy was live in production**, not just an open PR.
2. **Write-back validation gap (major)**: "Capture partner token after the run and write back if
   rotated" compares `AFTER_TOKEN` to `BEFORE_TOKEN` without validating `AFTER_TOKEN`'s shape
   first, unlike the earlier "Load" step (which does validate). If `config.json` ends up missing
   the token post-run (a partial/crashed CLI write), `jq -r` prints the literal string `"null"`,
   which differs from `BEFORE_TOKEN` and reads as "rotated" — triggering an unconditional `gh
   secret set` that overwrites the good secret with a broken config. Since the secret has no other
   writer, that's **unrecoverable** until manual re-authorization. This is the shared reusable
   workflow's *own* step — fixed at the source (`bso_github_actions#31`) as well as both inlined
   copies (`nl_market#893`, `lu_market#765`).

### 10.7 Two findings deliberately NOT auto-applied
Automated review tools flagged two more things on the same PRs; both were left alone with a
reply explaining why, rather than patched to match the suggestion:
1. **Multi-partner-changeset skip** — CodeRabbit called the classify script's "skip + log"
   behavior (when a template maps to zero or >1 in-scope partners) a bug, wanting it to fan out to
   every matching partner instead. **This is deliberate**, already decided in §6/D2: "Zero or >1
   in-scope → skip + log (multi-partner is rare)." Replied on `nl_market#893` explaining the
   documented reasoning instead of silently reversing a previously-validated decision.
2. **Dynamic `secrets[format(...)]` lookup** — flagged by zizmor (via CodeRabbit) as
   "overprovisioned-secrets": any non-literal `secrets[...]` index makes GitHub inject the *entire*
   secrets context into the runner, a real security concern. But this is inherent to §8/D-Q4's
   whole design (`secrets[format('PARTNER_CONFIG_JSON_{0}', matrix.partner)]`) — already merged
   and live in `lu_market` — and the suggested fix (static per-partner jobs, or a literal
   enumeration) fights the entire point of the workflow being data-driven per matched partner
   (the partner set isn't known at workflow-authoring time). Flagged as a genuine, pre-existing,
   **cross-repo** tradeoff (`nl_market`, `lu_market`, `be_market`, and the shared reusable
   workflow all share it) needing a deliberate team decision, not a one-off patch on one PR.

**Lesson for future automated-review triage on this workflow**: check a flagged "bug" against
this document's own §6/§8 design decisions before patching — several CodeRabbit/zizmor findings
here are known, deliberate tradeoffs already reasoned through, not oversights.

### 10.8 Rollout status snapshot, end of session (2026-07-22)
- **`silverfin-cli#265`** (`sampler-compact-diff-v2`) — OPEN, deliberately unmerged: gathering
  real feedback across both pilots first.
- **`nl_market#893`** — OPEN. Adds the sampler feature to `nl_market` for the first time *and*
  already carries the CLI-branch pointer + both bug fixes (10.6). Its comment is labeled `(test
  format - PR feedback build)` to distinguish it from the eventual permanent format. Only fires on
  PRs touching partner-2-mapped templates (the only partner actually wired up in `nl_market` so
  far).
- **`lu_market#765`** — OPEN. Unlike `nl_market`, the sampler is *already live* on `lu_market`'s
  `main` — merging #765 activates the CLI-branch pointer + both bug fixes immediately for the
  next approved PR there.
- **`bso_github_actions#31`** — OPEN. The actual upstream fix for 10.6's write-back bug. **Merging
  it alone does nothing for any caller** — `nl_market`/`lu_market`/`be_market` each pin the
  reusable workflow by commit SHA (`@55ee8aa4...`); the pin must be bumped separately in each
  caller once #31 merges.
- **Revert plan (not yet executed, sequencing matters)**: once `silverfin-cli#265` merges to
  `main`, `nl_market`/`lu_market`'s inlined jobs must revert to the standard single `uses:
  .../run_sampler.yml@<pin>` block **before or as part of** that merge, per 10.5's branch-deletion
  risk. Correct order: gather feedback → merge #265 → revert both callers back to
  `main`-tracking (also the natural moment to bump the `bso_github_actions` pin to whatever SHA
  #31 merges as, picking up the write-back fix too) → merge those reverts.
