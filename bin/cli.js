#!/usr/bin/env node

const toolkit = require('../index.js');

printHelp = function () {
  console.log("Usage:")
  commands = Object.keys(commandsDescription)
  maxLength = commands.sort((a, b) => b.length - a.length)[0].length
  defaultSpaces = 4

  Object.keys(commandsDescription).forEach((command) => {
    numberOfSpaces = defaultSpaces + maxLength - command.length;
    required_arg = commandsDescription[command]["required"]

    console.log(`  ${command}${" ".repeat(numberOfSpaces)}${commandsDescription[command]["description"]}`)
    if (required_arg) {
      console.log(`    ${required_arg}\n`)
    }
  })
}

commandsToFunctions = {
  "new": toolkit.createNewTemplateFolder,
  "import": toolkit.importNewTemplateFolder,
  "persistReconciliationText": toolkit.persistReconciliationText,
  "run_tests": toolkit.runTests,
  "help": printHelp
}
commandsDescription = {
  "new": {
    "description": "Generates new folder structure for a new template",
    "required": "--handle",
  },
  "import": {
    "description": "Imports existing template",
    "required": "--handle"
  },
  "persistReconciliationText": {
    "description": "Send template updates back to Silverfin",
    "required": "--handle"
  },
  "run_tests": {
    "description": "Send template and test to Silverfin and waits for completion",
    "required": "--handle"
  },
  "help": {
    "description": `
      Prints this message.

      You need to specify SF_ACCESS_TOKEN and SF_FIRM_ID environment variables, e.g. export SF_FIRM_ID=123
      You can also assign the SF_HOST environment variable to override the API location (to a staging or a local environment), E.g. export SF_HOST=http://localhost:3000. Default is https://live.getsilverfin.com
    `
  }
}

command = process.argv[2]
if (!command) {
  printHelp()
  process.exit()
 }

fun = commandsToFunctions[command]
if (!fun) {
  console.log("Command doesn't exist\n")
  printHelp()
  process.exit(1)
}

required_arg = commandsDescription[command]["required"]
if (required_arg && (required_arg != process.argv[3] || !process.argv[4])) {
  console.log(`${required_arg} is required`)
} else {
  fun(process.argv[4])
}