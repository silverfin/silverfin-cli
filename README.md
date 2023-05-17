# sf-toolkit

A command-line tool for Silverfin template development.

## What can be used for ?

- Update your templates from the command-line while storing them in git repositories.
- Run your Liquid Tests from the command-line.
- Generate Liquid Tests from existing company files.

## Setup & Basic Usage

### Prerequsites

#### API credentials

To use this CLI tool you first need to register an API application within Silverfin. You will get a `client_id` and `secret`.

#### Node

To make use of this CLI, you will need to have Node.js installed.
You can check if you already have it by running `node --version`.
If not you can download it from the [official website](https://nodejs.org/).

### Install the CLI

It is recommended to install the CLI globally by doing:

```bash
npm install -g https://github.com/silverfin/sf-toolkit.git
```

If you prefer, you could opt to add the CLI as a dependency to each of your projects containing a Liquid repository. Keep in mind that by doing so, the CLI may not work as expected (for example, the `update` command assumes that extension is installed globally).

### Set your API credentials

You will need to set up your API credentials as environmental variables. Add them to an existing file in your system (e.g. `~/.bash-profile`, `~/.bashrc` or `~/.zshrc`).

```bash
export SF_API_CLIENT_ID=...
export SF_API_SECRET=...
```

In case you need to use a different host, you can also set it up as an environmental variable. By default it would be `https://live.getsilverfin.com`.

```bash
export SF_HOST=...
```

## How to use it ?

By installing the CLI globally, you will be able to run it simply with the command `silverfin`

For example, you can run `silverfin --help` to confirm that your CLI is up and running, and get extra information about all the available commands and options for each of them.

```bash
silverfin --help
silverfin import-reconciliation --help
```

### Authorize the CLI

The first time your are going to work with the CLI, you will need to authorize it's access. This can be done using the following command:

```bash
silverfin authorize
```

This will open a new tab in your browser, where you would need to login in to Silverfin. Once you have authorized the use of the API, you will need to provide the authorization code you get to the CLI.

## Project structure conventions

The CLI will stick to some conventions regarding the structure and organization of your templates. We recommend that you organize your templates following the same principles.

### Repository

[Here](https://github.com/silverfin/example_liquid_repository) is an example of the directory structure that you can clone to use as a starting point of a new project, but basically files and directories are organized as follows:

```bash
/project
    /reconciliation_texts
        /[handle]
            main.liquid
            config.json
            /text_parts
                part_1.liquid
                part_2.liquid
            /tests
                README.md
                [handle]_liquid_test.yml
    /shared_parts
        /[name]
            [name].liquid
            config.json
```

### Naming conventions

- As you can see in the previous diagram, we use `handle` for Reconciliations and `name` for Shared Parts as their identifiers. You should keep them unique since they will be used to name the directories, liquid files and yaml files.
- The principal file of a reconciliation is always named `main.liquid` while every part is stored inside `/text_parts`.
- For shared parts, since there is only one liquid file, we use the `name` property to give the name to the liquid file.
- Both reconciliations and shared parts always have a `config.json` file, where all the details of the template are stored.
- Reconciliations can stored Liquid Tests inside `/test`. You could store here multiple YAML files if needed, but only one will be used by the CLI to run the tests, and it's the one that follows the naming convetion shown in the previous diagram (`[handle]_liquid_test.yml`). Note as well that we stick to using `.yml` instead of `.yaml`
