// Values which more than one module in lib/utils needs to agree on.
// This module requires nothing, so any module can require it without creating a cycle.

// Workflows are not templates, so they are not part of fsUtils.FOLDERS.
// fsUtils builds paths from this; errorUtils names it in its messages.
const WORKFLOWS_FOLDER = "workflows";

module.exports = {
  WORKFLOWS_FOLDER,
};
