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

You can add this `scripts` section to the `packages.json`, where we define `silverfin` as an alias to call our CLI.

```
  "scripts": {
    "silverfin": "node ./node_modules/sf_toolkit/bin/cli.js"
  },
```

## Add your API credentials as environmental variables

You could use a new `.env` local file, or add them to an existing file in your system (e.g. `~/.bash-profile`, `~/.bashrc` or `~/.zshrc`)

```
export SF_API_CLIENT_ID=...
export SF_API_SECRET=...
```

If you are only using one firm, you could set it up as an environmental variable. That way, you won't need to pass the `--firm <firmid>` option every time you run a command.

```
export SF_FIRM_ID=...
```

In case you need to use a different host, you can also set it up as an environmental variable. By default it would be `https://live.getsilverfin.com`.

```
export SF_HOST=...
```

# How to use it

## Authorize the CLI

```
yarn silverfin authorize
```

## Import an existing reconciliation

```
yarn silverfin import-reconciliation --firm <firm-id> --handle <handle>
```

## Update an existing reconciliation

```
yarn silverfin update-reconciliation --firm <firm-id> --handle <handle>
```

## Import all existing reconciliations

```
yarn silverfin import-all-reconciliations --firm <firm-id>
```

## Import an existing shared part

```
yarn silverfin import-shared-part --firm <firm-id> --handle <handle>
```

## Update an existing shared part

```
yarn silverfin update-shared-part --firm <firm-id> --handle <handle>
```

## Import all existing shared parts

```
yarn silverfin import-all-shared-parts --firm <firm-id>
```

## Run a Liquid Test

```
yarn silverfin run-test --firm <firm-id> --handle <handle>
```

## Create a Liquid Test

```
yarn silverfin create-test --url <url>
```

## Help

You can always get extra information by adding `--help`. For example:

```
yarn silverfin --help
yarn silverfin import-reconciliation --help
```
