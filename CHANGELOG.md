# Changelog

All notable changes to this project will be documented in this file.

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