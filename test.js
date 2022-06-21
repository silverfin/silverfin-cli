const toolkit = require('./index.js');
const fs = require('fs');

test.only("createNewTemplateFolder", async () => {
  const handlerName = "super_handler"
  expect(fs.existsSync(handlerName)).toBe(false);

  await toolkit.createNewTemplateFolder(handlerName);
  expect(fs.existsSync(handlerName)).toBe(true);
  expect(fs.existsSync(`./${handlerName}/tests/test.yml`)).toBe(true);
  expect(fs.existsSync(`./${handlerName}/text_parts/part_1.liquid`)).toBe(true);
  expect(fs.existsSync(`./${handlerName}/config.json`)).toBe(true);

  fs.rmdirSync(handlerName, { recursive: true });
});

test("importNewTemplateFolder", async () => {
  const handlerName = "expenses"
  expect(fs.existsSync(handlerName)).toBe(false);

  await toolkit.importNewTemplateFolder(handlerName);

  expect(fs.existsSync(handlerName)).toBe(true);
  expect(fs.existsSync(`./${handlerName}/tests/test.yml`)).toBe(true);
  expect(fs.existsSync(`./${handlerName}/text_parts/variables.liquid`)).toBe(true);
  expect(fs.existsSync(`./${handlerName}/text_parts/translations.liquid`)).toBe(true);
  expect(fs.existsSync(`./${handlerName}/config.json`)).toBe(true);

  fs.rmdirSync(handlerName, { recursive: true });
});

test.only("constructReconciliationText", async () => {
  const handlerName = "expenses"

  toolkit.constructReconciliationText(handlerName);
})