# sf-toolkit

A command-line tool for Silverfin template development.

## What can be used for ?

- Update your templates from the command-line while storing them in git repositories.
- Run your Liquid Tests from the command-line.
- Generate Liquid Tests from existing company files.

# Setup & Basic Usage

## Prerequsites

To use this CLI tool you first need to register an API application within Silverfin. You will get a `client_id` and `secret`.

## Install package manager

Install `npm` with Homebrew:

```
brew install node
```

Install `yarn` globally:

```
npm install --global yarn
```

## Add sf-toolkit package

Create `package.json` by running the following command and run through the prompts:

```
yarn init
```

Install `sf-toolkit` as a dependency of your project:

```
yarn add https://github.com/silverfin/sf-toolkit.git
```

## Add scripts to packages.json

You can add this `scripts` section to the `packages.json`, where we define `sf-cli` as an alias to call our CLI.

  "scripts": {
    "sf-cli": "./node_modules/sf_toolkit/bin/cli.js"
  },

# How to use it

## Authorize the CLI

```
yarn sf-cli authorize
```

## Import an existing reconciliation

```
yarn sf-cli import-reconciliation --firm <firm-id> --handle <handle>
```

## Update an existing reconciliation

```
yarn sf-cli update-reconciliation --firm <firm-id> --handle <handle>
```

## Import all existing reconciliations

```
yarn sf-cli import-all-reconciliations --firm <firm-id> --handle <handle>
```

## Import an existing shared part

```
yarn sf-cli import-shared-part --firm <firm-id> --handle <handle>
```

## Update an existing shared part

```
yarn sf-cli update-shared-part --firm <firm-id> --handle <handle>
```

## Import all existing shared parts

```
yarn sf-cli import-all-shared-parts --firm <firm-id> --handle <handle>
```

## Run a Liquid Test

```
yarn sf-cli run-test --firm <firm-id> --handle <handle>
```

## Create a Liquid Test

```
yarn sf-cli create-test --url <url>
```

## Help

You can always get extra information by adding `--help`. For example:

```
yarn sf-cli --help
yarn sf-cli import-reconciliation --help
```
