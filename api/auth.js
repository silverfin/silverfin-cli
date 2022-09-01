const fs = require('fs');
const path = require('path');

// Location
const homedir = require('os').homedir();
const sfFolder = path.resolve(homedir, '.silverfin/');
if (!fs.existsSync(sfFolder)) {
  fs.mkdirSync(sfFolder);
};

class Config {
  constructor() {
      try {
        this.path = path.resolve(homedir, '.silverfin/config.json');
        const fileData = fs.readFileSync(this.path, 'utf-8');
        this.data = JSON.parse(fileData);
      } 
      catch (err) {
        console.log('File not founded. Creating new Config file.');
        this.data = {};
      };
    };
  
  saveConfig() {
    fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf8', (err) => {
      if (err) {
        console.log(`Error while writing config file: ${err}`);
      } else {
        console.log(`Config file was written successfully`);
      }; 
    });
  };
    
  // Store new tokens to config
  storeNewTokens(responseTokens, firmId) {
    if (responseTokens) {
      this.data[firmId] = { 
        accessToken: responseTokens.data.access_token,
        refreshToken: responseTokens.data.refresh_token
      };
      this.saveConfig();
    };   
  };
};

const config = new Config();

module.exports = {config}
