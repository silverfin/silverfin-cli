const fs = require('fs');
const path = require('path');

function createFolder(path) {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path);
    console.log(`Directory created: ${path}`);
  };
};

function createFolders(relativePath) {
  createFolder(relativePath);
  createFolder(`${relativePath}/tests`);
  createFolder(`${relativePath}/text_parts`);
};

async function createLiquidTestFiles(relativePath, testFilenameRoot, testContent) {
  const emptyCallback = () => {};
  // Liquid Test: YAML
  if (!fs.existsSync(`${relativePath}/tests/${testFilenameRoot}_liquid_test.yml`)) {
    fs.writeFile(`${relativePath}/tests/${testFilenameRoot}_liquid_test.yml`, testContent, emptyCallback);
    console.log(`Liquid Testing: YAML file created`);
  };
  // Liquid Test: Readme
  if (!fs.existsSync(`${relativePath}/tests/README.md`)) {
    const readmeLiquidTests = fs.readFileSync(path.resolve(__dirname,'./resources/liquid_tests/README.md'), 'UTF-8');
    fs.writeFileSync(`${relativePath}/tests/README.md`, readmeLiquidTests);
    console.log(`Liquid Testing: README file created`);
  };
};

async function createTemplateFiles(relativePath, textMain, textParts) {
  const emptyCallback = () => {};
  // Template: Main
  fs.writeFile(`${relativePath}/main.liquid`, textMain, emptyCallback);
  console.log(`Template: main part file created`);  
  // Template: Parts
  Object.keys(textParts).forEach((textPartName) => {
    if (textPartName) {
      fs.writeFile(`${relativePath}/text_parts/${textPartName}.liquid`, textParts[textPartName], emptyCallback);
      console.log(`Template: ${textPartName} file created`);
    };
  });
};

async function createLiquidFile(relativePath, fileName, textContent) {
  const emptyCallback = () => {};
  fs.writeFile(`${relativePath}/${fileName}.liquid`, textContent, emptyCallback);
  console.log(`${fileName} file created`);
};

function writeConfig(relativePath, config) {
  emptyCallback = () => {};
  fs.writeFile(`${relativePath}/config.json`, JSON.stringify(config, null, 2), emptyCallback);
  console.log(`config.json file saved`);
};

function readConfig(relativePath) {
  const json = fs.readFileSync(`${relativePath}/config.json`).toString();
  const config = JSON.parse(json);
  return config;
};

module.exports = { 
  writeConfig,
  createTemplateFiles,
  createLiquidTestFiles,
  createLiquidFile, 
  createFolder, 
  createFolders, 
  readConfig };
  