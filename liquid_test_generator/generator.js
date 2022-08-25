const SF = require('../api/sf_api');
const {config} = require('../api/auth');
const Utils = require('./utils');

// MainProcess
async function testGenerator(url) {

	// Liquid Test Object
	const liquidTestObject = Utils.createBaseLiquidTest();
	
	// Get parameters from URL provided
	const parameters = Utils.extractURL(url);

	// Check if firm is authhorized
	if (!config.data.hasOwnProperty(parameters.firmId)) {
		throw `You have no authorization to access firm id ${parameters.firmId}`;
	};
	firmId = parameters.firmId;
	
	// Reconciled Status (CLI argument. True by default)
	liquidTestObject.test_name.expectation.reconciled = reconciledStatus;

	// Get Reconciliation Details
	const responseDetails = await SF.getReconciliationDetails(parameters.companyId, parameters.ledgerId, parameters.reconciliationId);

	// Get Workflow Information
	const starredStatus = {...SF.findReconciliationInWorkflow(responseDetails.data.handle, parameters.companyId, parameters.ledgerId, parameters.workflowId)}.starred

	// Get period data
	const responsePeriods = await SF.getPeriods(parameters.companyId);
	const currentPeriodData = SF.findPeriod(parameters.ledgerId, responsePeriods.data);

	// Set Current Period
	liquidTestObject.test_name.context.period = String(currentPeriodData.fiscal_year.end_date);
	liquidTestObject.test_name.data.periods[currentPeriodData.fiscal_year.end_date] = liquidTestObject.test_name.data.periods['replace_period_name'];
	delete liquidTestObject.test_name.data.periods['replace_period_name'];

	// Check Previous Period
	const currentPeriodIndex = responsePeriods.data.indexOf(currentPeriodData);
	const periodsMaxIndex = responsePeriods.data.length-1;
	if (currentPeriodIndex < periodsMaxIndex ) {
		const previousPeriodData = responsePeriods.data[currentPeriodIndex+1];
		if (previousPeriodData) {
			// Add empty previous period to Liquid Test
			liquidTestObject.test_name.data.periods[previousPeriodData.fiscal_year.end_date] = null;       
		};
	};

	// Get all the text properties
	const responseCustom = await SF.getReconciliationCustom(parameters.companyId, parameters.ledgerId, parameters.reconciliationId);
	const currentReconCustom = Utils.processCustom(responseCustom.data);
	liquidTestObject.test_name.data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[responseDetails.data.handle] = {
		starred: starredStatus, 
		...currentReconCustom
	};
	
	// Get all the results generated in current template
	const responseResults = await SF.getReconciliationResults(parameters.companyId, parameters.ledgerId, parameters.reconciliationId);
	liquidTestObject.test_name.expectation.results = responseResults.data;

	// Get the code of the template
	const reconciliationCode = await SF.findReconciliationText(responseDetails.data.handle);

	// Get results used in the liquid code (main and text_parts)
	let resultsObj;
	resultsObj = Utils.searchForResultsFromDependenciesInLiquid(reconciliationCode);

	// Search for shared parts in the liquid code (main and text_parts)
	const sharedPartsUsed = Utils.lookForSharedPartsInLiquid(reconciliationCode);
	if (sharedPartsUsed.length != 0) {
		for (sharedPartName of sharedPartsUsed) {
			// Look for shared part id
			let sharedPartResponse = await SF.findSharedPart(sharedPartName);
			let sharedPartId = sharedPartResponse.id;
			// Get shared part details
			let sharedPartDetails = await SF.fetchSharedPartById(sharedPartId);
			// Look for nested shared parts (in that case, add them to this same loop)
			let nestedSharedParts = Utils.lookForSharedPartsInLiquid(sharedPartDetails.data);
			for (nested of nestedSharedParts){
				if (!sharedPartsUsed.includes(nested)){
					sharedPartsUsed.push(nested);
				};
			};
			// Search for results in shared part (we append to existing collection)
			resultsObj = Utils.searchForResultsFromDependenciesInLiquid(sharedPartDetails.data, resultsObj);
		};
	};
	
	// Get results from dependencies reconciliations
	if (resultsObj) {
		// Search in each reconciliation
		for (const [handle, resultsArray] of Object.entries(resultsObj)) {
			try {
				// Find reconciliation in Workflow to get id (depdeency template can be in a different Workflow)
				let reconciliation = await SF.findReconciliationInWorkflows(handle, parameters.companyId, parameters.ledgerId)
				// Fetch results
				let reconciliationResults = await SF.getReconciliationResults(parameters.companyId, parameters.ledgerId, reconciliation.id);
				// Add handle and results block to Liquid Test
				liquidTestObject.test_name.data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle] = {};
				liquidTestObject.test_name.data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle].results = {};
				// Search for results
				for (resultTag of resultsArray) {
					// Add result to Liquid Test
					liquidTestObject.test_name.data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle].results[resultTag] = reconciliationResults.data[resultTag];
				};
			} catch (err) {
				console.error(err)
			};
		};
	};

	// Get company drop used in the liquid code (main and text_parts)
	const companyObj = Utils.getCompanyDependencies(reconciliationCode);
	
	if (companyObj.standardDropElements.length !== 0 || companyObj.customDropElements.length !== 0) {
		liquidTestObject.test_name.data.company = {};
	}

	// Get Company Data - company drop
	if (companyObj.standardDropElements.length !== 0) {
		const responseCompanyDrop = await SF.getCompanyDrop(parameters.companyId);
		const companyData = responseCompanyDrop.data;   // { foo: bar, baz: bat ... }
		
		for (drop of companyObj.standardDropElements) {
			const [a, key] = drop.split('.'); // company.foo
			if (key in companyData) {
				// Add to Liquid Test
				liquidTestObject.test_name.data.company[key] = companyData[key] 
			};
		};
	};
	
	// Get Company Data - custom drop
	if (companyObj.customDropElements.length !== 0) {
		const responseCompanyCustom = await SF.getCompanyCustom(parameters.companyId);
		const companyCustom = responseCompanyCustom.data; // [ { namespace: foo, key: bar, value: baz }... ]
		liquidTestObject.test_name.data.company.custom = {};

		for (drop of companyObj.customDropElements) {
			const [a, b, namespace, key] = drop.split('.'); // company.custom.namespace.key
			let foundItem = companyCustom.find((element, index)=>{
				if (element.namespace == namespace && element.key == key) {
					return true;
				}
			})
			if (foundItem) {
				let namespaceKey = `${namespace}.${key}`;
				// Add to Liquid Test
				liquidTestObject.test_name.data.company.custom[namespaceKey] = foundItem.value;
			}
		}
	};

	// Search for account ids in customs
	const accountIds = Utils.lookForAccounts(liquidTestObject);
	if (accountIds.length != 0) {
		liquidTestObject.test_name.data.periods[currentPeriodData.fiscal_year.end_date].accounts = {};
		for (accountId of accountIds) {
			accountId = accountId.replace("#","");
			try {
				let accountResponse = await SF.getAccountDetails(parameters.companyId, parameters.ledgerId, accountId);
				// If value is zero it won't be found ?
				if (accountResponse) {
					liquidTestObject.test_name.data.periods[currentPeriodData.fiscal_year.end_date].accounts[accountResponse.data.account.number] = {
						id: accountResponse.data.account.id,
						name: accountResponse.data.account.name,
						value: Number(accountResponse.data.value)
					};
				};
			}
			catch (error) {
				console.log(error);
			};
		};
	};

	// Save YAML
	Utils.exportYAML(responseDetails.data.handle, liquidTestObject);
};


module.exports = {
  testGenerator
}