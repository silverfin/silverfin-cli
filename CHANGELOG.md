# Changelog

All notable changes to this project will be documented in this file.

## [1.45.0] (xx/xx/2025) TODO
- Added `description_en`, `description_fr`, `description_nl` to the `accountTemplate` class
- Added `description_en`, `description_fr`, `description_nl` to the `exportFile` class
- Added `description_en`, `description_fr`, `description_nl` to the `reconciliationText` class

## [1.44.0] (11/07/2025)
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
