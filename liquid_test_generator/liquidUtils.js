// Search for all "input" tags in Liquid
function lookForInputTags(liquidCode, input_type="") {
    const input_types = ['account_collection',"currency","integer","file","text","boolean","select","percentage","date",""];
    if (!input_types.includes(input_type)){
      console.log('Input type defined not supported');
      process.exit(1);
    };
    let reInput;
    if (input_type) {
      let expression = `{%.*input.*as:${input_type}.*%}`; // {% input as:account_collection %}
      reInput = new RegExp(expression, 'g'); 
    } else {
      reInput = RegExp(/{%.*input.*%}/g); // {% input %}
    };
    const found = liquidCode.match(reInput) || [];
    return found; // return array with all the input tags found [{% input custom.foo.bar as:account_collection %}]
  };
  
  // Look for default parameter. You could pass a string (full liquid code) or an array (e.g input tags)
  function lookForDefault(text){
    reDefault = RegExp(/default:\w+/g); // default:variable_name
    if (typeof text === 'string') {
      const found = text.match(reDefault) || [];
      const variableNames = found.map(element =>{
        return element.split(":")[1]; // default:variable_name
      });
      const uniqueVariables = [...new Set(variableNames)];
      return uniqueVariables;
    };
    // Each element of the array should have only one default
    if (Array.isArray(text)){
      const defaultsArray = text.map(element => {
        let matchItem = element.match(reDefault);
        if (matchItem) {
          return matchItem[0].split(":")[1]; // default:variable_name
        };
      }).filter(element=>element); // remove undefined
      const uniqueVariables = [...new Set(defaultsArray)];
      return uniqueVariables;
    }
  };
  
  // Search for an specific "assign" tag in Liquid by it's name
  function lookForAssign(text, variableName){
    let expression = `{%.*assign.*${variableName}.*=.*%}`; // {% assign variable_name = content %}
    reAssign = new RegExp(expression, 'g');
    const found = text.match(reAssign) || [];
    const variables = found.map(element => {
      let parts = element.split("=");
      return parts[1].replace("%}","").trim();
    });
    return variables[0]; // return the content of the assign tag
  };

  // Search for all capture tags in Liquid.
  function lookForCaptureTags(liquidCode) {
    const reCapture = RegExp(/{%.*capture.*%}.*{%.*endcapture.*%}/g); // {% input %}
    const found = liquidCode.match(reCapture) || [];
    return found; // return array with all the capture tags found [{% capture variable_name %}Content{% endcapture %}]
  };

  module.exports = {
    lookForInputTags,
    lookForDefault,
    lookForAssign,
    lookForCaptureTags
  };
