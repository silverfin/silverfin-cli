const fs = require("fs");
const fsUtils = require("../utils/fsUtils");
const templateUtils = require("../utils/templateUtils");
const { consola } = require("consola");

class ExportFile {
  static CONFIG_ITEMS = ["name_en", "name_fr", "name_nl", "file_name", "externally_managed", "encoding", "published", "hide_code"];
  static TEMPLATE_TYPE = "exportFile";
  static TEMPLATE_FOLDER = fsUtils.FOLDERS[this.TEMPLATE_TYPE];
  constructor() {}

  /**
   * Process the response provided by the Silverfin API and store every detail in its corresponding file (liquid files, config file, etc)
   * @param {string} type firm or partner
   * @param {number} envId  The id of the firm or partner environment where the template is going to be imported from
   * @param {object} template
   */
  static save(type, envId, template) {
    // NL must be enabled in "Advanced Settings" in Silverfin
    if (templateUtils.missingNameNL(template)) return false;
    if (templateUtils.missingLiquidCode(template)) return false;
    if (!templateUtils.checkValidName(template.name, this.TEMPLATE_TYPE)) return false;

    const name = template.name_nl;
    fsUtils.createTemplateFolders(this.TEMPLATE_TYPE, name, false);

    // Liquid files
    const mainPart = template.text;
    const textParts = templateUtils.filterParts(template);
    fsUtils.createTemplateFiles(this.TEMPLATE_TYPE, name, mainPart, textParts);

    // Config Json File
    let existingConfig = fsUtils.readConfig(this.TEMPLATE_TYPE, name);
    const configDetails = this.#prepareConfigDetails(template, existingConfig);

    const addNewId = (currentType, typeCheck, envId, template) => (currentType == typeCheck ? { [envId]: template.id } : {});

    const configContent = {
      id: { ...existingConfig?.id, ...addNewId(type, "firm", envId, template) },
      partner_id: {
        ...existingConfig?.partner_id,
        ...addNewId(type, "partner", envId, template),
      },
      ...configDetails,
    };
    fsUtils.writeConfig(this.TEMPLATE_TYPE, name, configContent);

    return true;
  }

  /**
   * Read all necessary files and prepare the object to be sent to the Silverfin API
   * @param {string} name The name of the template to read
   * @returns {object} The object to be sent to the Silverfin API
   */
  static read(name) {
    if (!templateUtils.checkValidName(name, this.TEMPLATE_TYPE)) return false;
    fsUtils.createTemplateFolders(this.TEMPLATE_TYPE, name, false);
    let templateConfig = fsUtils.readConfig(this.TEMPLATE_TYPE, name);

    // Handle legacy name conversion
    templateConfig = this.#populateMissingNameLocales(templateConfig); 

    // Write updated config back to file
    fsUtils.writeConfig(this.TEMPLATE_TYPE, name, templateConfig);

    if (!this.#validateFolderName(name, templateConfig)) return false;
    let template = this.#filterConfigItems(templateConfig);

    // Liquid
    this.#createMainLiquid(name);
    template.text = this.#readMainLiquid(name, templateConfig);
    template.text_parts = this.#readPartsLiquid(name, templateConfig);

    return template;
  }

  /** Update template's id for the corresponding firm in template's config file */
  static updateTemplateId(type, envId, name, templateId) {
    let templateConfig = fsUtils.readConfig(this.TEMPLATE_TYPE, name);
    fsUtils.setTemplateId(type, envId, templateConfig, templateId);
    fsUtils.writeConfig(this.TEMPLATE_TYPE, name, templateConfig);
  }

  static #prepareConfigDetails(template, existingConfig) {
    const attributes = this.CONFIG_ITEMS.reduce((acc, attribute) => {
      if (template.hasOwnProperty(attribute)) {
        acc[attribute] = template[attribute];
      } else if (existingConfig?.hasOwnProperty(attribute)) {
        acc[attribute] = existingConfig[attribute];
      }

      return acc;
    }, {});
    const textParts = templateUtils.filterParts(template);
    const configTextParts = Object.keys(textParts).reduce((acc, name) => {
      if (name) {
        acc[name] = `text_parts/${name}.liquid`;
      }
      return acc;
    }, {});
    return { ...attributes, text: "main.liquid", text_parts: configTextParts };
  }

  static #filterConfigItems(templateConfig) {
    return this.CONFIG_ITEMS.reduce((acc, attribute) => {
      if (templateConfig.hasOwnProperty(attribute)) {
        acc[attribute] = templateConfig[attribute];
      }
      return acc;
    }, {});
  }

  static #populateMissingNameLocales(templateConfig) {
    if (templateConfig.name && !templateConfig.name_nl) {
      templateConfig.name_nl = templateConfig.name;
      templateConfig.name_en = templateConfig.name;
      templateConfig.name_fr = templateConfig.name;
      delete templateConfig.name;
    }
    return templateConfig;
  }

  static #createMainLiquid(name) {
    const relativePath = `./${this.TEMPLATE_FOLDER}/${name}`;
    if (!fs.existsSync(`${relativePath}/main.liquid`)) {
      fsUtils.createLiquidFile(relativePath, "main", "{% comment %} MAIN PART {% endcomment %}");
    }
  }

  static #readMainLiquid(name, templateConfig) {
    const mainPartPath = `./${this.TEMPLATE_FOLDER}/${name}/${templateConfig.text}`;
    return fs.readFileSync(mainPartPath, "utf-8");
  }

  static #readPartsLiquid(name, templateConfig) {
    const relativePath = `./${this.TEMPLATE_FOLDER}/${name}`;
    return Object.keys(templateConfig.text_parts).reduce((array, name) => {
      let path = `${relativePath}/${templateConfig.text_parts[name]}`;
      let content = fs.readFileSync(path, "utf-8");
      array.push({ name, content });
      return array;
    }, []);
  }

  static #validateFolderName(name, config) {
    if (name !== config.name_nl) {
      consola.warn(`Folder name "${name}" does not match name_nl "${config.name_nl}" in config. Please change it accordingly and try again.`);

      return false;
    }
    return true;
  }
}

module.exports = { ExportFile };

// Example Silverfin Response
// {
//   "id": 1,
//   "marketplace_template_id": 10,
//   "name": "New Export file",
//   "file_name": "export_file_name.sxbrl",
//   "externally_managed": false,
//   "encoding": "UTF-8",
//   "text": "Liquid code",
//   "text_parts": [
//       {
//           "name": "part_1",
//           "content": "part 1 liquid code"
//       }
//   ]
// }
