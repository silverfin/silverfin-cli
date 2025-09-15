const fs = require("fs");
const fsUtils = require("../utils/fsUtils");
const templateUtils = require("../utils/templateUtils");
const { consola } = require("consola");

class ExportFile {
  static CONFIG_ITEMS = [
    "name_en",
    "name_fr",
    "name_nl",
    "name_de",
    "name_da",
    "name_se",
    "name_fi",
    "description_en",
    "description_fr",
    "description_nl",
    "file_name",
    "externally_managed",
    "encoding",
    "published",
    "hide_code",
    "download_warning",
    "test_firm_id",
  ];
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
    // Validate template requirements before proceeding
    // NL must be enabled in "Advanced Settings" in Silverfin
    if (templateUtils.missingNameNL(template)) return false;
    // Ensure liquid code is present
    if (templateUtils.missingLiquidCode(template)) return false;
    // Ensure template name follows required naming conventions
    if (!templateUtils.checkValidName(template.name_nl, this.TEMPLATE_TYPE)) return false;

    const name = template.name_nl;
    // Create folder structure for template if it doesn't exist
    fsUtils.createTemplateFolders(this.TEMPLATE_TYPE, name, false);

    // Process and save Liquid files
    const mainPart = template.text;
    const textParts = templateUtils.filterParts(template);
    fsUtils.createTemplateFiles(this.TEMPLATE_TYPE, name, mainPart, textParts);

    // Process and save Config Json File
    const existingConfig = fsUtils.readConfig(this.TEMPLATE_TYPE, name);
    const configDetails = this.#prepareConfigDetails(template, existingConfig);

    // Helper function to add environment-specific IDs based on type
    const addNewId = (currentType, typeCheck, envId, template) => (currentType == typeCheck ? { [envId]: template.id } : {});

    // Construct final config object, preserving existing IDs and adding new ones
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
    // Handle legacy description conversion
    templateConfig = this.#populateMissingDescriptionLocales(templateConfig);

    if (!this.#validateFolderName(name, templateConfig)) return false;
    const template = this.#filterConfigItems(templateConfig);

    // Liquid
    this.#createMainLiquid(name);
    template.text = this.#readMainLiquid(name, templateConfig);
    template.text_parts = this.#readPartsLiquid(name, templateConfig);

    return template;
  }

  /** Update template's id for the corresponding firm in template's config file */
  static updateTemplateId(type, envId, name, templateId) {
    const templateConfig = fsUtils.readConfig(this.TEMPLATE_TYPE, name);
    fsUtils.setTemplateId(type, envId, templateConfig, templateId);
    fsUtils.writeConfig(this.TEMPLATE_TYPE, name, templateConfig);
  }

  static #prepareConfigDetails(template, existingConfig) {
    const attributes = this.CONFIG_ITEMS.reduce((acc, attribute) => {
      if (Object.hasOwn(template, attribute)) {
        acc[attribute] = template[attribute];
      } else if (existingConfig && Object.hasOwn(existingConfig, attribute)) {
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
      if (Object.hasOwn(templateConfig, attribute)) {
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
      templateConfig.name_de = templateConfig.name;
      templateConfig.name_da = templateConfig.name;
      templateConfig.name_se = templateConfig.name;
      templateConfig.name_fi = templateConfig.name;
      delete templateConfig.name;

      // Write updated config back to file
      consola.debug(`Template ${templateConfig.name_nl}: adjusting name fields in config.json`);
      fsUtils.writeConfig(this.TEMPLATE_TYPE, templateConfig.name_nl, templateConfig);
    }
    return templateConfig;
  }

  static #populateMissingDescriptionLocales(templateConfig) {
    if (templateConfig.description && !templateConfig.description_nl) {
      templateConfig.description_nl = templateConfig.description;
      templateConfig.description_en = templateConfig.description;
      templateConfig.description_fr = templateConfig.description;
      delete templateConfig.description;

      // Write updated config back to file
      consola.debug(`Template ${templateConfig.name_nl}: adjusting description fields in config.json`);
      fsUtils.writeConfig(this.TEMPLATE_TYPE, templateConfig.name_nl, templateConfig);
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
      const path = `${relativePath}/${templateConfig.text_parts[name]}`;
      const content = fs.readFileSync(path, "utf-8");
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
//   "name_en": "New Export File",
//   "name_fr": "Nouveau fichier d'export",
//   "name_nl": "Nieuw export bestand",
//   "description_en": "Description of the export file",
//   "description_fr": "Description du fichier d'export",
//   "description_nl": "Beschrijving van het export bestand",
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
