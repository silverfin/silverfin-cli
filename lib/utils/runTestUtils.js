function checkMode(htmlInput, htmlPreview) {
  if (htmlInput && htmlPreview) {
    return "all";
  } else if (htmlInput) {
    return "input";
  } else if (htmlPreview) {
    return "preview";
  } else {
    return "none";
  }
}

module.exports = {
  checkMode,
};
