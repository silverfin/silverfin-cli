# Changelog

All notable changes to this project will be documented in this file.

## [1.59.1] (22/09/2026)
The tier's caps are now a budget, not a fixed count: `--compact` renders every finding, field note and affected entry it has, and only elides them when the diff would otherwise exceed GitHub's 65,536-character comment limit, stepping down through progressively tighter caps and disclosing what was cut. Previously a run stopped at 6 field notes per finding and 10 findings regardless of how much room was left, so a normal-sized run was truncated for no reason. The item lists inside one note (lost/added options, tag counts, column spans, static-text words, and the scope tier's ledger/handle/account-range/param/required-key lists and flag-flip suffixes) keep their fixed preview length; a truncated one now ends in `, #<hash>` of the full list, so two findings that differ only past the preview are no longer grouped as one.

Sharpen `silverfin run-sampler --compact`'s visual-only tier. It now diffs a `<select>`'s and a radio/checkbox group's available options, not just the selected one (a dropdown that silently lost its option list previously showed nothing at all), and names a field that changed element type; describes markup changes by parsing the HTML — element counts, table counts, row counts and column spans — instead of only matching `data-name` attributes, so a restructured or malformed table is explained rather than handed back as "compare the two `view.html` files yourself"; groups entries reporting the identical finding into one block with the affected entry list, since a single template change lands on every sampled entry of that template; and caps the number of findings and listed entries, disclosing what was elided, like the other tiers already do.

Behaviour changes that follow from this: an entry whose `view.html` differs only in its per-entry `data-object-id`/`data-object-ledger-id` values (matched however the attribute is cased, spaced or quoted) is no longer reported as a visual-only change, and so no longer appears in `--add-diffs-folder`'s `diffs/` subset either; the tier's old catch-all note ("layout/markup changed with no anchored field explaining it") is gone — a diff nothing else explains is now reported as a static-text word diff or as an attribute/styling-only change; and a `view.html` over 2 MB, with more than 1,000 unclosed tags, or with markup nested too deeply to parse, is still reported as a visual-only change but described as such instead of being parsed, so one pathological render can't stall or abort the whole run's diff. Everything this tier lifts out of the render or the results zip — template labels, entry ids, field names, field values, option labels, tag names — is now printed unchanged inside a code span it can't close (named_results keys and values in the data tier too), and a template label is always printed on one line, since the compact diff is posted verbatim as a PR comment and, with `--from-zip`, none of it is guaranteed to have come from Silverfin's own sampler backend.

## [1.59.0] (05/08/2026)
Expand `silverfin run-sampler --compact`: diff the `results` register, group vanished output per template instead of listing every entry, add a scope-change tier (dependencies/rollforward/required keys) and a visual-only tier for `view.html` changes the data diff can't see, and truncate/cap long output. Also adds `run-sampler --from-zip <path>` to build the compact diff from an already-downloaded `results.zip`.

## [1.58.0] (31/07/2026)
Added the `company-data-copier` command, which triggers the platform Data Copier to copy a source company's data (account values incl. adjustments, text properties, people/company drop and configuration) into a brand-new company in a destination development firm. Intended for BSO developers to reproduce a client's situation in a dev firm without touching the production firm. Only *data* is copied, not template *code* — templates must already exist in the destination firm to be populated.

## [1.57.2] (30/07/2026)
Cap the liquid-test polling interval at 5 seconds. The delay between result polls grew 5% per poll without a limit, so long test runs (~10 minutes) were only checked every 30-60 seconds and a finished run could sit unnoticed for up to a minute.

## [1.57.1] (15/07/2026)
Improve `silverfin run-sampler` by adding a compact output mode.

## [1.57.0] (14/07/2026)
Added a new `silverfin run-sampler` command to run the Liquid Sampler for partner templates. Specify a partner with `-p` and one or more reconciliation text handles (`-h`), account detail template names (`-at`), and/or shared part names (`-s`), optionally scoping the run to specific firms with `--firm-ids`. Pass `--id <sampler-id>` to fetch and display the results of an existing sampler run instead.

## [1.56.3] (03/07/2026)
Improve `run-test --status` output for CI: surface the underlying error message when a run ends in `test_error`/`internal_error` (previously reported as a bare `FAILED` with no reason), and suppress the progress spinner when stdout is not a TTY (it flooded CI logs with hundreds of "Running tests.." frames).

## [1.56.2] (25/06/2026)
Send the staging HTTP Basic Auth header on firm OAuth token requests only when the staging gateway actually requires it (detected via a one-time `WWW-Authenticate: Basic` probe). Fixes `silverfin authorize` and token refresh failing with "unknown client" on stagings that have HTTP basic auth disabled.

## [1.56.1] (08/06/2026)
Increase the waiting time for the test runs to avoid timeout errors.

## [1.56.0] (04/06/2026)
Allow subfolders in template directories.

## [1.55.2] (04/06/2026)
Update dependencies to fix security vulnerabilities.

## [1.55.1] (03/06/2026)
Increase test coverage.

## [1.55.0] (27/05/2026)
Added an error summary at the end of the `update-reconciliation --all`, `update-shared-part --all`, `update-export-file --all`, and `update-account-template --all` commands.

## [1.54.2] (13/05/2026)
Fix error reporting in `silverfin authorize`, `refresh-token`, and the partner-key refresh: previously some failures (notably network-layer errors with no HTTP response) crashed with `Cannot read properties of undefined (reading 'status')` or exited silently — they now print the underlying error so the cause is visible.

## [1.54.1] (14/04/2026)
Increase the waiting time for the test runs to avoid timeout errors.

## [1.54.0] (17/02/2026)
Added `create-test` command support for account templates (fetches template data, period data, and custom data).

## [1.53.0] (11/02/2026)
We have introduced a new command `silverfin check-dependencies -h reconciliation_handle`.
Currently, it only works for reconciliation templates and detects which templates reference the given handle in their Liquid Test data.

## [1.52.2] (11/02/2026)
Update description of the `silverfin update-all-templates` command

## [1.52.1] (21/01/2026)
In this update we solved a bug related to the `silverfin run-test -p "string pattern" -h template_handle` command. Previously, when we run tests and define a pattern, those tests can include an alias, but the anchor was defined in a different section that gets filtered out when running the tests. This has now been resolved.

## [1.52.0] (12/01/2026)
This update improves test execution performance when running tests with status checks across multiple template handles. 
Tests are now run in parallel for multiple handles when using the `--status` flag, significantly reducing the overall execution time. Previously, tests with status checks for multiple handles would run sequentially, but now they leverage parallel processing for better efficiency. This change only affects the `silverfin run-test` command when both multiple handles and the status flag are used together.

## [1.51.0] (08/01/2026)

This update should have no user impact whatsoever.
Replace Windows-specific dependencies with built-in functionality to improve cross-platform compatibility and reduce security risks related to npm dependencies.
Unify how files are downloaded, stored and opened across different commands.

## [1.50.0] (07/01/2026)

We introduce a new command `silverfin generate-export-file` which enables the creation of export files (XBRLs, iXBRLs, CSV, etc.) with the CLI. This could be used as part of your development process, for example, after updating an export file template to quickly generate a new export without the need to go to Silverfin's website. It should display any validation errors in the terminal and open the generated file in the default application (browser, text editor, etc.). See more details on how to use it by running `silverfin generate-export-file --help`.

## [1.49.0] (07/01/2026)
In this version we are introducing Liquid batch/pattern testing. An extra option was added to the `silverfin run-test`command to run all tests which conatin a common string.
To enable it run `silverfin run-test -p "string pattern" -h template_handle`

## [1.48.0] (25/09/2025)
In this version we are introducing TAB autocompletion for the CLI commands. It should autocomplete command names, flags, and template handles and names.
To enable it, run `silverfin config --set-autocompletion` and follow the instructions.

## [1.47.1] (13/11/2025)
- Fix: Update authorize command to use user-inputted firm ID when calling `getFirmName` function rather than default firm ID

## [1.47.0] (23/09/2025)
- Added `create-all-templates` and `update-all-templates` commands, which will create or update all templates for a given firm at once

## [1.46.0] (23/09/2025)
- Added `description_en`, `description_nl`, `description_fr` to the `accountTemplate` class
- Added `description_en`, `description_nl`, `description_fr` to the `exportFile` class
- Added `description_en`, `description_nl`, `description_fr` to the `reconciliationText` class

## [1.45.3] (16/09/2025)
- Fix: when creating a yaml file from an existing template, and a CustomDrop collection contains more than 10 items, we were wrongly sorting them alphabetically instead of by key id.

## [1.45.2] (12/09/2025)
- Fix: make sure template supports all 7 locales but not all locales get populated automatically.

## [1.45.1] (29/08/2025)
- Fix: when fetching the Period CustomDrop, we were limited to 200 results. Implemented pagination to fetch all results.

## [1.45.0] (28/08/2025)
- A new config file attribute `test_firm_id` was added for account templates and reconciliations texts.
Adding it with a specific firm will make sure that this firm is used for the Github actions.

## [1.44.0] (11/08/2025)
- `create-account-template` command will now create an empty .yml file

## [1.43.0] (11/08/2025)
- It is now possible to use the `create-test` command on files that are relying directly on partners code.
- period.custom data is now picked up when using the `create-test` command

## [1.42.0] (07/08/2025)
Now it is possible to call update commands using the `--id` option, which allows to update a specific template by its ID.
For example: `silverfin update-reconciliation --id 12345`

## [1.41.0] (28/07/2025)
- Add tests for the accountTemplate class

## [1.40.0] (08/07/2025)
- `stats` command now displays the amount of yaml files that have at least two unit tests defined

## [1.39.0] (07/07/2025)
- Add tests for the exportFile class

## [1.38.0] (04/07/2025)
- Added a changelog.md file and logic to display the changes when updating to latest version