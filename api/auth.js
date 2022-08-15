const fs = require('fs');
const path = require('path');
const prompt = require('prompt-sync')({sigint: true});

class Config {
  constructor() {
      try {
        this.path = path.resolve(__dirname,'./config.json');
        const fileData = fs.readFileSync(this.path, 'utf-8');
        this.data = JSON.parse(fileData);
      } 
      catch (err) {
        console.log('File not founded. Creating new Config file.');
        this.data = {};
      };
    };
  
  saveConfig() {
    fs.writeFileSync(this.path, JSON.stringify(this.data), 'utf8', (err) => {
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
    
  setClientId() {
    this.data.clientId = prompt('Enter your API Client id: ',{echo:'*'});
    this.saveConfig();
  };
    
  setSecret() {
    this.data.secret = prompt('Enter your API secret: ',{echo:'*'});
    this.saveConfig();
  };
};

const config = new Config();

module.exports = {config}
