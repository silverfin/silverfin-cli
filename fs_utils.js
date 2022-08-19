const fs = require('fs');
const path = require('path');

function createFolder(path) {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path);
  };
};

function createFolders(relativePath) {
  createFolder(relativePath);
  createFolder(`${relativePath}/tests`);
  createFolder(`${relativePath}/text_parts`);
};

async function createFiles({ relativePath, testFile, textParts, text }) {
  const emptyCallback = () => {};

  if (!fs.existsSync(`${relativePath}/tests/${testFile.name}.yml`)) {
    fs.writeFile(`${relativePath}/tests/${testFile.name}.yml`, testFile.content, emptyCallback);
  };

  if (!fs.existsSync(`${relativePath}/tests/README.md`)) {
    const readmeLiquidTests = fs.readFileSync(path.resolve(__dirname,'./resources/liquid_tests/README.md'), 'UTF-8');
    fs.writeFileSync(`${relativePath}/tests/README.md`, readmeLiquidTests);
  };

  Object.keys(textParts).forEach((textPartName) => {
    if (textPartName) {
      fs.writeFile(`${relativePath}/text_parts/${textPartName}.liquid`, textParts[textPartName], emptyCallback);
    };
  });

  fs.writeFile(`${relativePath}/main.liquid`, text, emptyCallback);
};

async function createLiquidFile(relativePath, fileName, textContent) {
  const emptyCallback = () => {};
  fs.writeFile(`${relativePath}/${fileName}.liquid`, textContent, emptyCallback);
};

function writeConfig(relativePath, config) {
  emptyCallback = () => {};
  fs.writeFile(`${relativePath}/config.json`, JSON.stringify(config, null, 2), emptyCallback);
};

function readConfig(relativePath) {
  const json = fs.readFileSync(`${relativePath}/config.json`).toString();
  const config = JSON.parse(json);

  return config;
};

module.exports = { 
  writeConfig,
  createFiles, 
  createLiquidFile, 
  createFolder, 
  createFolders, 
  readConfig };