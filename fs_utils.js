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

createFiles = async function ({ relativePath, testFiles, textParts, text }) {
  const emptyCallback = () => {}

  Object.keys(testFiles).forEach((fileName) => {
    fs.writeFile(`${relativePath}/tests/${fileName}.yml`, testFiles[fileName], emptyCallback)
  })

  Object.keys(textParts).forEach((textPartName) => {
    if (textPartName) {
      fs.writeFile(`${relativePath}/text_parts/${textPartName}.liquid`, textParts[textPartName], emptyCallback)
    }
  })

  fs.writeFile(`${relativePath}/text.liquid`, text, emptyCallback)
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

module.exports = { writeConfig, createFiles, createFolders, readConfig }
