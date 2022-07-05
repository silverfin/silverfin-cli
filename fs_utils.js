const fs = require('fs');

createFolder = function (path) {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path)
  }
}

createFolders = function (relativePath) {
  createFolder(relativePath)
  createFolder(`${relativePath}/tests`)
  createFolder(`${relativePath}/text_parts`)
}

createFiles = async function ({ relativePath, testFile, textParts, text }) {
  const emptyCallback = () => {}

  fs.writeFile(`${relativePath}/tests/${testFile.name}.yml`, testFile.content, emptyCallback)

  if (!fs.existsSync(`${relativePath}/tests/README.md`)) {
    const readmeLiquidTests = fs.readFileSync('./resources/liquid_tests/README.md')
    fs.writeFileSync(`${relativePath}/tests/README.md`, readmeLiquidTests)
  }

  Object.keys(textParts).forEach((textPartName) => {
    if (textPartName) {
      fs.writeFile(`${relativePath}/text_parts/${textPartName}.liquid`, textParts[textPartName], emptyCallback)
    }
  })

  fs.writeFile(`${relativePath}/main.liquid`, text, emptyCallback)
}

createLiquidFile = async function (relativePath, fileName, textContent) {
  const emptyCallback = () => {}
  fs.writeFile(`${relativePath}/${fileName}.liquid`, textContent, emptyCallback)
}

writeConfig = function (relativePath, config) {
  emptyCallback = () => {}
  fs.writeFile(`${relativePath}/config.json`, JSON.stringify(config, null, 2), emptyCallback);
}

readConfig = function (relativePath) {
  const json = fs.readFileSync(`${relativePath}/config.json`).toString()
  const config = JSON.parse(json)

  return config
}

module.exports = { writeConfig, createFiles, createLiquidFile, createFolder, createFolders, readConfig }