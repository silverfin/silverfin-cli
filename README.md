# sf-toolkit

A command-line tool for Silverfin template development.

## What can be used for ?

- Create, read, update your templates from the command-line while storing them in git repositories (limited to Reconciliation templates at the moment).
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

## How to use it ?

By installing the CLI globally, you will be able to run it simply with the command `silverfin`

### Help

The only command that you really need to know. It will provide you with a list of all the available commands.

```bash
silverfin --help
```

You can also run `--help` for each command to get more information about it. For example:

```bash
silverfin import-reconciliation --help
```

### Authorize the CLI

The first time your are going to work with the CLI, you will need to authorize it's access. This can be done using the following command:

```bash
silverfin authorize
```

This will open a new tab in your browser, where you would need to login in to Silverfin. Once you have authorized the use of the API, you will need to provide the authorization code you get to the CLI.

### Set up a default firm

If you are going to work with a single firm, you can set it up as the default firm for the CLI. This will save you from having to provide the firm id every time you run a command.

```bash
silverfin config --set-firm <firm_id>
```

### Import a reconciliation

Most likely, you have worked already on the Silverfin platform and you already have an existing set of templates. You can import them to your local repository using the following command:

```bash
silverfin import-reconciliation --handle <handle>
```

The previous command also supports the flag `--all` to import all the reconciliations of a firm at once.

```bash
silverfin import-reconciliation --all
```

> Note that the CLI will overwrite any existing template with the same handle.

### Update a reconciliation

Once you have made updates to your reconciliation, you can update it using the following command:

```bash
silverfin update-reconciliation --handle <handle>
```

The previous command also supports the flag `--all` to update all the reconciliations of a firm at once.

```bash
silverfin update-reconciliation --all
```

> Note that the entire code of the template in Silverfin will be replaced with the one in your local repository.

### Shared Parts

You can import and update Shared Parts using similar commands as for Reconciliations.

```bash
silverfin import-shared-part --shared-part <handle>
silverfin update-shared-part --shared-part <handle>
```

### Adding a shared part to a reconciliation

When you `include` a shared part in one of your reconciliations, you need to add it to create their link. You can add a shared part to a reconciliation using the following command:

```bash
silverfin add-shared-part --handle <handle> --shared-part <handle>
```

You can also remove it using the following command if it's no longer needed:

```bash
silverfin remove-shared-part --handle <handle> --shared-part <handle>
```

### Run Liquid Tests

You can run the Liquid Tests of a reconciliation using the following command:

```bash
silverfin run-test --handle <handle>
```

### Updating the CLI

Whenever a new version of the CLI is available, you should see a message in your terminal informing it, so you can keep it always up to date. To update the CLI to the latest version, you can run the following command:

```bash
silverfin update
```

### Development mode

The `development-mode` will watch for changes in your local repository and automatically update the template in Silverfin. This is very useful when you are working on a template and you want to see the changes in Silverfin without having to run the `run-test` or `update` command every time.

**It is important to know that you need to manually terminate this process (ctrl + c) when you no longer need it.**

There are two different ways to use the `development-mode`:

- Using the `--handle` flag to specify the reconciliation you want to work on. This will run a new liquid test every time you save a related file of this reconciliation (liquid or yaml), including shared parts used by this reconciliation. (equivalent to use: `silverfin run-test --handle <handle>`)

```bash
silverfin development-mode --handle <handle>
```

- Using the `--update-templates` flag. This will listen for changes in liquid files. Every time a change is saved to a liquid file of a reconciliation or shared part, it will be updated in Silverfin. **Note that this will not run any liquid test, and it will replace the liquid code of your template in Silverfin.** (equivalent to use: `silverfin update-reconciliation --handle <handle>` or `silverfin update-shared-part --shared-part <name>`)

```bash
silverfin development-mode --update-templates
```

## Contributing

If you find any bug or you have any suggestion, please feel free to open an issue in this repository.
