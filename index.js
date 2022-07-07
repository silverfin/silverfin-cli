const api = require('./sf_api')
const fsUtils = require('./fs_utils')
const fs = require('fs');

const RECONCILIATOIN_FIELDS_TO_SYNC = ["name_nl", "name_fr", "name_en", "auto_hide_formula", "text_configuration", "virtual_account_number", "reconciliation_type", "public", "allow_duplicate_reconciliations", "is_active", "tests"]

createNewTemplateFolder = async function (handle) {
  const relativePath = `./reconciliation_texts/${handle}`
  fsUtils.createFolder(`./reconciliation_texts`)
  fsUtils.createFolders(relativePath)
  testFile = { name: "test", content: "" }
  textParts = { "part_1": "" }
  text = ""
  fsUtils.createFiles({ relativePath, testFile, textParts, text })

  config = {
    "text": "main.liquid",
    "text_parts": {
      "part_1": "text_parts/part_1.liquid"
    },
    "test": "tests/test.yml",
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
    name: "test", 
    content: "# Add your Liquid Tests here"
  }
  textPartsReducer = (acc, part) => {
    acc[part.name] = part.content
    return acc
  }

  textParts = reconciliationText.text_parts.reduce(textPartsReducer, {})
  fsUtils.createFiles({ relativePath, testFile, textParts, text: reconciliationText.text })

  attributes = RECONCILIATOIN_FIELDS_TO_SYNC.reduce((acc, attribute) => {
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
    "test": "tests/test.yml",
  }
  writeConfig(relativePath, config)
}

constructReconciliationText = function (handle) {
  const relativePath = `./reconciliation_texts/${handle}`
  const config = fsUtils.readConfig(relativePath)

  const attributes = RECONCILIATOIN_FIELDS_TO_SYNC.reduce((acc, attribute) => {
    acc[attribute] = config[attribute]
    return acc
  }, {})
  attributes.text = fs.readFileSync(`${relativePath}/main.liquid`, 'utf-8')
  attributes.tests = fs.readFileSync(`${relativePath}/tests/test.yml`, 'utf-8')

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

/* This will overwrite existing shared parts in reconcilation's config file */
refreshSharedPartsUsed = function (handle) {
  const relativePath = `./reconciliation_texts/${handle}`
  const configReconciliation = fsUtils.readConfig(relativePath)
  configReconciliation.shared_parts = []

  const sharedParts = fs.readdir(`./shared_parts`, (err, data) => {
    if (err) throw err;
    
    for (sharedPartDir of data) {
      let sharedPartPath = `./shared_parts/${sharedPartDir}`
      let dir = fs.statSync(sharedPartPath, ()=>{});
      if (dir.isDirectory()) {
        let configSharedPart = fsUtils.readConfig(sharedPartPath);
        let found = configSharedPart.used_in.find(function(template,index) {
          if (template.id == configReconciliation.id) { 
            configReconciliation.shared_parts.push({
              'id': configSharedPart.id,
              'name': sharedPartDir
            })
            return true 
          } 
        })
      }
    }
    fsUtils.writeConfig(relativePath, configReconciliation)
  })
}

addSharedPartToReconciliation = async function (sharedPartHandle, reconciliationHandle) {
  const relativePathReconciliation = `./reconciliation_texts/${reconciliationHandle}`
  const configReconciliation = fsUtils.readConfig(relativePathReconciliation)

  const relativePathSharedPart = `./shared_parts/${sharedPartHandle}`
  const configSharedPart = fsUtils.readConfig(relativePathSharedPart)

  response = await api.addSharedPart(configSharedPart.id, configReconciliation.id)

  if (response.status === 201) {
    console.log(`OK: Shared part "${sharedPartHandle}" added to "${reconciliationHandle}" reconciliation text.`)
  }

  sharedPartIndex = configReconciliation.shared_parts.findIndex(sharedPart => sharedPart.id === configSharedPart.id);

  if (sharedPartIndex === -1) {
    configReconciliation.shared_parts.push({
      'id': configSharedPart.id,
      'name': sharedPartHandle
    })
    fsUtils.writeConfig(relativePathReconciliation,configReconciliation)
  }

  reconciliationIndex = configSharedPart.used_in.findIndex(reconciliationText => reconciliationText.id === configReconciliation.id);

  if (reconciliationIndex === -1) {
    configSharedPart.used_in.push({
      'id': configReconciliation.id,
      'type': 'reconciliation'
    })
    fsUtils.writeConfig(relativePathSharedPart,configSharedPart)
  }
}

removeSharedPartFromReconciliation = async function (sharedPartHandle, reconciliationHandle) {
  const relativePathReconciliation = `./reconciliation_texts/${reconciliationHandle}`
  const configReconciliation = fsUtils.readConfig(relativePathReconciliation)

  const relativePathSharedPart = `./shared_parts/${sharedPartHandle}`
  const configSharedPart = fsUtils.readConfig(relativePathSharedPart)

  response = await api.removeSharedPart(configSharedPart.id, configReconciliation.id);
  if (response.status === 200) {
    console.log(`OK: Shared part "${sharedPartHandle}" removed from "${reconciliationHandle}" reconciliation text.`)
  }

  sharedPartIndex = configReconciliation.shared_parts.findIndex(sharedPart => sharedPart.id === configSharedPart.id);
  if (sharedPartIndex !== -1) {
    configReconciliation.shared_parts.splice(sharedPartIndex,1)
    fsUtils.writeConfig(relativePathReconciliation,configReconciliation)
  }

  reconciliationIndex = configSharedPart.used_in.findIndex(reconciliationText => reconciliationText.id === configReconciliation.id);
  if (reconciliationIndex !== -1) {
    configSharedPart.used_in.splice(reconciliationIndex,1)
    fsUtils.writeConfig(relativePathSharedPart,configSharedPart)
  }
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
module.exports = { createNewTemplateFolder, importNewTemplateFolder, constructReconciliationText, persistReconciliationText, importExistingSharedPartByName, importExistingSharedParts, persistSharedPart, addSharedPartToReconciliation, removeSharedPartFromReconciliation, runTests }
