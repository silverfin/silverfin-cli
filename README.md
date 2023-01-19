# sf-toolkit

A command-line tool for Silverfin template development.

## What can be used for ?

- Update your templates from the command-line while storing them in git repositories.
- Run your Liquid Tests from the command-line.
- Generate Liquid Tests from existing company files.

# Setup & Basic Usage

## Prerequsites

To use this CLI tool you first need to register an API application within Silverfin. You will get a `client_id` and `secret`.

## Node

To make use of this CLI, you will need to have Node.js installed
You can check if you already have it by running `node --version`
If not you can download it from the [official website](https://nodejs.org/)

## Install the CLI

It is recommended to install the CLI globally by doing:

```
npm install -g https://github.com/silverfin/sf-toolkit.git
```

If you prefer, you could opt to add the CLI as a dependency to each of your projects containing a Liquid repository.

## Add your API credentials as environmental variables

Add them to an existing file in your system (e.g. `~/.bash-profile`, `~/.bashrc` or `~/.zshrc`)

```
export SF_API_CLIENT_ID=...
export SF_API_SECRET=...
```

In case you need to use a different host, you can also set it up as an environmental variable. By default it would be `https://live.getsilverfin.com`.

```
export SF_HOST=...
```

# How to use it

By installing the CLI globally, you will be able to run it simply with the command `silverfin`

For example, you can run `silverfin --help` to confirm that your CLI is up and running, and get extra information about all the available commands and options for each of them.

```
silverfin --help
silverfin import-reconciliation --help
```

## Authorize the CLI

The first time your are going to work with the CLI, you will need to authorize it's access. This can be done using the following command:

```
silverfin authorize
```
