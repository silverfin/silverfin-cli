# Basic Usage

## Prerequsites

To use this cli tool you need to first obtain silverfin api access_token

## Install

```
yarn add https://github.com/GetSilverfin/sf-toolkit.git
```

## Set env variables

### Linux / Mac

```
export SF_FIRM_ID=<firm_id>
export SF_ACCESS_TOKEN=<access_token>
```

### Windows

```
set SF_FIRM_ID=<firm_id>
set SF_ACCESS_TOKEN=<access_token>
```


## Import Existing template

```
./bin/cli.js import --handle <handle>
```

## Update the template

```
node_modules/sf_toolkit/bin/cli.js persistReconciliationText --handle <handle>
```
