const api = require('./api/sf_api')
const fsUtils = require('./fs_utils')
const fs = require('fs');

const RECONCILIATION_FIELDS_TO_SYNC = ["name_nl", "name_fr", "name_en", "auto_hide_formula", "text_configuration", "virtual_account_number", "reconciliation_type", "public", "allow_duplicate_reconciliations", "is_active", "tests"]

createNewTemplateFolder = async function (handle) {
  const relativePath = `./reconciliation_texts/${handle}`
  fsUtils.createFolder(`./reconciliation_texts`)
  fsUtils.createFolders(relativePath)
  testFile = { name: handle, content: "" }
  textParts = { "part_1": "" }
  text = ""
  fsUtils.createFiles({ relativePath, testFile, textParts, text })

  config = {
    "text": "main.liquid",
    "text_parts": {
      "part_1": "text_parts/part_1.liquid"
    },
    "test": `tests/${handle}.yml`,
    "name_en": ""
  }
  writeConfig(relativePath, config)
}

importNewTemplateFolder = async function (handle) {
  reconciliationText = await api.findReconciliationText(handle)
  if (!reconciliationText) {
    throw(`${handle} wasn't found`)
  }

  const relativePath = `./reconciliation_texts/${handle}`
  fsUtils.createFolder(`./reconciliation_texts`)
  fsUtils.createFolders(relativePath)
  testFile = { 
    name: handle, 
    content: "# Add your Liquid Tests here"
  }
  textPartsReducer = (acc, part) => {
    acc[part.name] = part.content
    return acc
  }

  textParts = reconciliationText.text_parts.reduce(textPartsReducer, {})
  fsUtils.createFiles({ relativePath, testFile, textParts, text: reconciliationText.text })

  attributes = RECONCILIATION_FIELDS_TO_SYNC.reduce((acc, attribute) => {
    acc[attribute] = reconciliationText[attribute]
    return acc
  }, {})

  configTextParts = Object.keys(textParts).reduce((acc, name) => {
    if (name) {
      acc[name] = `text_parts/${name}.liquid`
    }

    return acc
  }, {})

  config = {
    ...attributes,
    "text": "main.liquid",
    "text_parts": configTextParts,
    "test": `tests/${handle}.yml`,
  }
  writeConfig(relativePath, config)
}

constructReconciliationText = function (handle) {
  const relativePath = `./reconciliation_texts/${handle}`
  const config = fsUtils.readConfig(relativePath)

  const attributes = RECONCILIATION_FIELDS_TO_SYNC.reduce((acc, attribute) => {
    acc[attribute] = config[attribute]
    return acc
  }, {})
  attributes.text = fs.readFileSync(`${relativePath}/main.liquid`, 'utf-8')
  attributes.tests = fs.readFileSync(`${relativePath}/tests/${handle}.yml`, 'utf-8')

  const textParts = Object.keys(config.text_parts).reduce((array, name) => {
    let path = `${relativePath}/${config.text_parts[name]}`
    let content = fs.readFileSync(path, 'utf-8')

    array.push({ name, content })
    return array
  }, [])

  attributes.text_parts = textParts

  const mainPartPath = `${relativePath}/${config.text}`
  const mainPartContent = fs.readFileSync(mainPartPath, 'utf-8')
  attributes.text = mainPartContent
  
  return attributes
}

persistReconciliationText = async function (handle) {
  reconciliationText = await api.findReconciliationText(handle)

  if (reconciliationText) {
    api.updateReconciliationText(reconciliationText.id, {...constructReconciliationText(handle), "version_comment": "Testing Cli"})
  } else {
    throw("Creation of reconcilaition texts isn't yet support by API")
  }
}

importExistingSharedPartById = async function(id) {
  const sharedPart = await api.fetchSharedPartById(id)

  if (!sharedPart) {
    throw(`Shared part ${id} wasn't found.`)
  }

  const relativePath = `./shared_parts/${sharedPart.data.name}`

  fsUtils.createFolder(`./shared_parts`)
  fsUtils.createFolder(relativePath)

  fsUtils.createLiquidFile(relativePath, sharedPart.data.name, sharedPart.data.text)

  config = {
    "id": sharedPart.data.id,
    "name": sharedPart.data.name,
    "text": "main.liquid",
    "used_in": sharedPart.data.used_in
  }

  writeConfig(relativePath, config)
}

importExistingSharedPartByName = async function(name) {

  const sharedPartByName = await api.findSharedPart(name)

  if (!sharedPartByName) {
    throw(`Shared part with name ${name} wasn't found.`)
  }

  importExistingSharedPartById(sharedPartByName.id)
}

importExistingSharedParts = async function() {
  response = await api.fetchSharedParts()
  const sharedParts = response.data

  if (sharedParts.length == 0) {
    console.log(`No shared parts found`)
    return
  }

  sharedParts.forEach(async (sharedPart) => {
    response = await importExistingSharedPartById(sharedPart.id)
  })
}

persistSharedPart = async function (name) {
  const relativePath = `./shared_parts/${name}`
  const config = fsUtils.readConfig(relativePath)
  const attributes = {}
  attributes.text = fs.readFileSync(`${relativePath}/${name}.liquid`, 'utf-8')
  api.updateSharedPart(config.id, {...attributes, "version_comment": "Testing Cli"})

}

runTests = async function (handle) {
  const relativePath = `./reconciliation_texts/${handle}`
  const config = fsUtils.readConfig(relativePath)
  const testPath = `${relativePath}/${config.test}`
  const testContent = fs.readFileSync(testPath, 'utf-8')

  const testParams = { 'template': constructReconciliationText(handle), 'tests': testContent }

  const testRunResponse = await api.createTestRun(testParams)
  const testRunId = testRunResponse.data
  let testRun = { 'status': 'started' }
  const pollingDelay = 2000

  while (testRun.status === 'started') {
    await new Promise(resolve => setTimeout(resolve, pollingDelay))

    const response = await api.fetchTestRun(testRunId)
    testRun = response.data
  }

  if (testRun.status !== 'completed') {
    console.error(testRun.error_message)
    process.exit(1)
  }

  if (testRun.result.length !== 0) {
    console.error('Tests Failed')
    console.error(testRun.result)
    process.exit(1)
  }
}

authorize = function () {
  api.authorizeApp();
};

module.exports = { 
  createNewTemplateFolder, 
  importNewTemplateFolder, 
  constructReconciliationText, 
  persistReconciliationText, 
  importExistingSharedPartByName, 
  importExistingSharedParts, 
  persistSharedPart, 
  runTests,
  authorize
}
