const toolkit = require('../index.js');
const {Command} = require('commander');
const prompt = require('prompt-sync')({sigint: true});
const program = new Command();

// Load firm id from ENV vars
let firmIdDefault = undefined;
if (process.env.SF_FIRM_ID) {
  firmIdDefault = process.env.SF_FIRM_ID;
  console.log(`Firm ID to be used: ${firmIdDefault}`)
};

// Version
program
  .version('0.1.0');


// Prompt Confirmation
function promptConfirmation(){
  const confirm = prompt('This will overwrite existin templates. Do you want to proceed? (yes/NO): ');
  if (confirm.toLocaleLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
    console.log('Operation cancelled');
    process.exit();
  };
  return true;
};

// Import a single reconciliation
program
  .command('import-reconciliation')
  .description('Import an existing reconciliation template')
  .requiredOption('-f, --firm <firm-id>', 'Specify the firm to be used (mandatory)', firmIdDefault)
  .requiredOption('-h, --handle <handle>', 'Mandatory. Specify the reconcilation to be used (mandatory)')
  .option('--yes', 'Skip the prompt confirmation (optional)')
  .action((options) => {
    if (!options.yes) {
      promptConfirmation();
    };
    firmId = options.firm;
    toolkit.importNewTemplateFolder(options.handle);
  });

// Update a single reconciliation
program
  .command('update-reconciliation')
  .description('Update an existing reconciliation template')
  .requiredOption('-f, --firm <firm-id>', 'Specify the firm to be used (mandatory)', firmIdDefault)
  .requiredOption('-h, --handle <handle>', 'Mandatory. Specify the reconcilation to be used (mandatory)')
  .option('--yes', 'Skip the prompt confirmation (optional)')
  .action((options)=>{
    if (!options.yes) {
      promptConfirmation();
    };
    firmId = options.firm;
    toolkit.persistReconciliationText(options.handle);
  });

// Import all reconciliations
program
  .command('import-all-reconciliations')
  .description('Import all reconciliations at once')
  .requiredOption('-f, --firm <firm-id>', 'Specify the firm to be used (mandatory)', firmIdDefault)
  .option('--yes', 'Skip the prompt confirmation (optional)')
  .action((options) => {
    if (!options.yes) {
      promptConfirmation();
    };
    firmId = options.firm;
    // TO DO: Add function
    console.log('Method not implemented yet')
  });

// Import a single shared part
program
  .command('import-shared-part')
  .description('Import an existing shared part')
  .requiredOption('-f, --firm <firm-id>', 'Specify the firm to be used (mandatory)', firmIdDefault)
  .requiredOption('-h, --handle <handle>', 'Mandatory. Specify the shared part to be used (mandatory)')
  .option('--yes', 'Skip the prompt confirmation (optional)')
  .action((options) => {
    if (!options.yes) {
      promptConfirmation();
    };
    firmId = options.firm;
    toolkit.importExistingSharedPartByName(options.handle);
  });

// Update a single shared part
program
  .command('update-shared-part')
  .description('Update an existing shared part')
  .requiredOption('-f, --firm <firm-id>', 'Specify the firm to be used (mandatory)', firmIdDefault)
  .requiredOption('-h, --handle <handle>', 'Mandatory. Specify the shared part to be used (mandatory)')
  .option('--yes', 'Skip the prompt confirmation (optional)')
  .action((options) => {
    if (!options.yes) {
      promptConfirmation();
    };
    firmId = options.firm;
    toolkit.persistSharedPart(options.handle);
  });

// Import all shared parts
program
  .command('import-all-shared-parts')
  .description('Import all shared parts at once')
  .requiredOption('-f, --firm <firm-id>', 'Specify the firm to be used (mandatory)', firmIdDefault)
  .option('--yes', 'Skip the prompt confirmation (optional)')
  .action((options) => {
    if (!options.yes) {
      promptConfirmation();
    };
    firmId = options.firm;
    toolkit.importExistingSharedParts();
  });

// Run Liquid Test
program
  .command('run-test')
  .description('Run Liquid Tests for a reconciliation template from a YAML file')
  .requiredOption('-f, --firm <firm-id>', 'Specify the firm to be used (mandatory)', firmIdDefault)
  .requiredOption('-h, --handle <handle>', 'Mandatory. Specify the reconciliation to be used (mandatory)')
  .action((options) => {
    firmId = options.firm;
    toolkit.runTests(options.handle);
  });

// Create Liquid Test 
program
  .command('create-test')
  .description('Create Liquid Test (YAML file) from an existing reconciliation in a company file')
  .requiredOption('-u, --url <url>', 'Specify the url to be used (mandatory)')
  .action(() => {
    // TO BE DONE
  });

// Authorize APP
program
  .command('authorize')
  .description('Authorize the CLI by entering your Silverfin API credentials')
  .action(()=>{
    toolkit.authorize();
  });

program.parse();

// Unhandled errors while running the cli
process.on('unhandledRejection', error => {
  console.log(error);
});