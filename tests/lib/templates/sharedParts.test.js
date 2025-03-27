const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const fsUtils = require("../../../lib/utils/fsUtils");
const templateUtils = require("../../../lib/utils/templateUtils");
const { SharedPart } = require("../../../lib/templates/sharedPart");

jest.mock("../../../lib/utils/templateUtils");
jest.mock("consola");
