# Changelog

All notable changes to this project will be documented in this file.

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
