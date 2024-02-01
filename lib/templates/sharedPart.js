const fs = require("fs");
const fsUtils = require("../utils/fsUtils");
const templateUtils = require("../utils/templateUtils");
const SF = require("../api/sfApi");

class SharedPart {
  static CONFIG_ITEMS = ["name", "externally_managed", "hide_code"];
  static TEMPLATE_TYPE = "sharedPart";
  static TEMPLATE_FOLDER = fsUtils.FOLDERS[this.TEMPLATE_TYPE];
  constructor() {}

  /**
   * Process the response provided by the Silverfin API and store every detail in its corresponding file (liquid files, config file, etc)
   * @param {number} firmId
   * @param {object} template
   */
  static async save(firmId, template) {
    if (!templateUtils.checkValidName(template.name, this.TEMPLATE_TYPE))
      return false;
    if (!fsUtils.checkNameAligned(template.name, this.TEMPLATE_TYPE))
      return false;

    fsUtils.createSharedPartFolders(template.name);

    // Liquid File
    const relativePath = `./${this.TEMPLATE_FOLDER}/${template.name}`;
    fsUtils.createLiquidFile(relativePath, template.name, template.text);

    // Config Json File
    let existingConfig = fsUtils.readConfig(this.TEMPLATE_TYPE, template.name);
    let usedIn = await this.#processUsedIn(
      firmId,
      template.used_in,
      existingConfig
    );

    const config = {
      id: { ...existingConfig.id, [firmId]: template.id },
      partnerId: {
        ...existingConfig?.partnerId,
      },
      name: template.name,
      text: `${template.name}.liquid`,
      used_in: usedIn,
      externally_managed: template.externally_managed,
    };

    fsUtils.writeConfig(this.TEMPLATE_TYPE, template.name, config);

    return true;
  }

  static async read(name) {
    if (!templateUtils.checkValidName(name, this.TEMPLATE_TYPE)) return false;
    if (!fsUtils.checkNameAligned(name, this.TEMPLATE_TYPE)) return false;
    fsUtils.createSharedPartFolders(name);
    // Config.json
    const templateConfig = fsUtils.readConfig(this.TEMPLATE_TYPE, name);
    let template = this.#filterConfigItems(templateConfig);
    // Liquid File
    this.#createMainLiquid(name);
    template.text = this.#readMainLiquid(name, templateConfig);
    return template;
  }

  /** Update template's id for the corresponding firm in template's config file */
  static updateTemplateId(firmId, name, templateId) {
    let templateConfig = fsUtils.readConfig(this.TEMPLATE_TYPE, name);
    templateConfig.id[firmId] = templateId;
    fsUtils.writeConfig(this.TEMPLATE_TYPE, name, templateConfig);
  }

  static async #processUsedIn(firmId, templateUsedIn, existingConfig) {
    // Adjust IDs and find templates handle
    let usedIn = existingConfig.used_in ? existingConfig.used_in : [];
    // Remove old format IDs
    // OLD: "id": 1234
    // NEW: "id": { "100": 1234 }
    usedIn = usedIn.filter((template) => typeof template.id !== "number");

    for await (let template of templateUsedIn) {
      template = this.checkTemplateType(template);
      const handle = await this.#findTemplateHandle(firmId, template);
      if (!handle) continue;

      template.handle = handle;
      // Check if there's already an existing used_in configuration for other firms
      const templateExistingInConfig = usedIn.findIndex(
        (existingUsedTemplate) => existingUsedTemplate.handle == template.handle
      );
      if (templateExistingInConfig !== -1) {
        // Update existing
        template.id = {
          ...usedIn[templateExistingInConfig].id,
          [firmId]: template.id,
        };
        template.partnerId = { ...usedIn[templateExistingInConfig].partnerId };
        usedIn[templateExistingInConfig] = template;
        // New entry
      } else {
        template.id = { [firmId]: template.id };
        template.partnerId = {};
        usedIn.push(template);
      }
    }
    return usedIn;
  }

  static async #findTemplateHandle(firmId, template) {
    // Search in repository
    let handle = fsUtils.findHandleByID(firmId, template.type, template.id);
    // Search through the API
    if (!handle) {
      const handle_attribute =
        templateUtils.TEMPLATES_NAME_ATTRIBUTE[template.type];
      switch (template.type) {
        case "reconciliationText":
          let reconciliationText = await SF.readReconciliationTextById(
            firmId,
            template.id
          );
          if (reconciliationText) {
            handle = reconciliationText.data[handle_attribute];
          }
          break;
        case "exportFile":
          let exportFile = await SF.readExportFileById(firmId, template.id);
          if (exportFile) {
            handle = exportFile[handle_attribute];
          }
          break;
        case "accountTemplate":
          let accountTemplate = await SF.readAccountTemplateById(
            firmId,
            template.id
          );
          if (accountTemplate) {
            handle = accountTemplate[handle_attribute];
          }
          break;
      }
    }
    return handle;
  }

  static #createMainLiquid(name) {
    const relativePath = `./${this.TEMPLATE_FOLDER}/${name}`;
    if (!fs.existsSync(`${relativePath}/${name}.liquid`)) {
      fsUtils.createLiquidFile(
        relativePath,
        name,
        "{% comment %} MAIN PART {% endcomment %}"
      );
    }
  }

  static #readMainLiquid(name) {
    const mainPartPath = `./${this.TEMPLATE_FOLDER}/${name}/${name}.liquid`;
    return fs.readFileSync(mainPartPath, "utf-8");
  }

  static #filterConfigItems(templateConfig) {
    return this.CONFIG_ITEMS.reduce((acc, attribute) => {
      if (templateConfig.hasOwnProperty(attribute)) {
        acc[attribute] = templateConfig[attribute];
      }
      return acc;
    }, {});
  }

  static checkTemplateType(template) {
    if (fsUtils.TEMPLATE_TYPES.includes(template.type)) {
      return template;
    }
    template.type = templateUtils.TEMPLATE_MAP_TYPES[template.type];
    return template;
  }
}

module.exports = { SharedPart };
