const { testGenerator } = require("../../lib/liquidTestGenerator");
const SF = require("../../lib/api/sfApi");
const { firmCredentials } = require("../../lib/api/firmCredentials");
const Utils = require("../../lib/utils/liquidTestUtils");
const { ReconciliationText } = require("../../lib/templates/reconciliationText");
const { AccountTemplate } = require("../../lib/templates/accountTemplate");
const { SharedPart } = require("../../lib/templates/sharedPart");
const { consola } = require("consola");

// Mock external dependencies
jest.mock("../../lib/api/sfApi");
jest.mock("../../lib/api/firmCredentials");
jest.mock("../../lib/templates/reconciliationText");
jest.mock("../../lib/templates/accountTemplate");
jest.mock("../../lib/templates/sharedPart");
jest.mock("consola");

jest.mock("../../lib/utils/liquidTestUtils", () => {
  const originalModule = jest.requireActual("../../lib/utils/liquidTestUtils");
  return {
    ...originalModule,
    createBaseLiquidTest: jest.fn(),
    exportYAML: jest.fn(),
    extractURL: jest.fn(),
  };
});

describe("liquidTestGenerator", () => {
  let mockExitSpy;
  const mockUrl = "https://live.getsilverfin.com/f/123/456/ledgers/789/workflows/101/reconciliation_texts/202";
  const mockTestName = "unit_1_test_1";
  const mockParameters = {
    templateType: "reconciliationText",
    firmId: "123",
    companyId: "456",
    ledgerId: "789",
    workflowId: "101",
    reconciliationId: "202",
  };
  const mockReconciliationHandle = "test_handle";
  const mockPeriodData = {
    fiscal_year: { end_date: "2024-12-31" },
  };

  // Mock template data
  const mockReconciliationTemplate = {
    handle: "test_handle",
    id: 808080,
    text: "Main liquid content with {{ shared/header_part }} and {{ shared/footer_part }}",
    text_parts: [
      { name: "part_1", content: "Part 1 content with {{ shared/header_part }}" },
      { name: "part_2", content: "{{ period.reconciliations.test_reconciliation.result.random_result }}" },
    ],
    tests: "Test content as string",
    externally_managed: true,
  };

  const mockSharedPartTemplates = {
    header_part: {
      name: "header_part",
      text: "Header part content with {{ company.name }}",
      externally_managed: false,
    },
    footer_part: {
      name: "footer_part",
      text: "Footer part content with {{ company.custom.namespace.key }} & {{ period.custom.namespace.key }}",
      externally_managed: false,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock firmCredentials
    firmCredentials.data = {
      123: { accessToken: "mock_token" },
    };

    // Mock process.exit
    mockExitSpy = jest.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`Process.exit called with code ${code}`);
    });

    // Mock Utils functions
    Utils.createBaseLiquidTest.mockReturnValue({
      [mockTestName]: {
        context: { period: "2024-12-31" },
        data: {
          periods: {
            replace_period_name: {
              reconciliations: {},
            },
          },
        },
        expectation: {
          reconciled: true,
          results: {},
        },
      },
    });

    Utils.extractURL.mockReturnValue(mockParameters);
    Utils.exportYAML.mockImplementation(() => {});

    // Mock template reading
    ReconciliationText.read.mockResolvedValue(mockReconciliationTemplate);
    SharedPart.read.mockImplementation((name) => {
      if (mockSharedPartTemplates[name]) {
        return Promise.resolve(mockSharedPartTemplates[name]);
      }
      return Promise.resolve(false);
    });

    // Mock SF API calls
    SF.readReconciliationTextDetails = jest.fn().mockResolvedValue({
      data: { handle: mockReconciliationHandle },
    });
    SF.findReconciliationInWorkflow = jest.fn().mockReturnValue({ starred: true });
    SF.getPeriods = jest.fn().mockResolvedValue({
      data: [mockPeriodData],
    });
    SF.findPeriod = jest.fn().mockReturnValue(mockPeriodData);
    SF.getAllPeriodCustom = jest.fn().mockResolvedValue([
      {
        namespace: "pit_integration",
        key: "code_1002",
        value: "yes",
      },
    ]);
    SF.getReconciliationCustom = jest.fn().mockResolvedValue({
      data: [
        {
          namespace: "test_namespace",
          key: "test_key",
          value: "test_value",
        },
      ],
    });
    SF.getReconciliationResults = jest.fn().mockResolvedValue({
      data: { result1: "value1", result2: "value2" },
    });
    SF.getCompanyDrop = jest.fn().mockResolvedValue({
      data: { name: "Test Company" },
    });
    SF.getCompanyCustom = jest.fn().mockResolvedValue({
      data: [],
    });
  });

  afterEach(() => {
    mockExitSpy.mockRestore();
  });

  describe("testGenerator", () => {
    describe("template reading", () => {
      it("should read reconciliation template correctly", async () => {
        await testGenerator(mockUrl, mockTestName);

        // Verify that ReconciliationText.read was called with the correct handle
        expect(ReconciliationText.read).toHaveBeenCalledWith(mockReconciliationHandle);

        // Verify that the template content is processed correctly
        expect(Utils.exportYAML).toHaveBeenCalledWith(
          mockReconciliationHandle,
          expect.objectContaining({
            [mockTestName]: expect.objectContaining({
              data: expect.objectContaining({
                periods: expect.objectContaining({
                  "2024-12-31": expect.any(Object),
                }),
              }),
            }),
          }),
          "reconciliationText"
        );
      });

      it("should handle missing reconciliation template gracefully", async () => {
        ReconciliationText.read.mockResolvedValue(false);

        await expect(testGenerator(mockUrl, mockTestName)).rejects.toThrow("Process.exit called with code undefined");
        expect(consola.warn).toHaveBeenCalledWith(`Template "${mockReconciliationHandle}" wasn't found`);
      });

      it("should read shared parts correctly", async () => {
        await testGenerator(mockUrl, mockTestName);

        // Verify that SharedPart.read was called for each shared part
        expect(SharedPart.read).toHaveBeenCalledWith("header_part");
        expect(SharedPart.read).toHaveBeenCalledWith("footer_part");
      });

      it("should handle missing shared part gracefully", async () => {
        // Mock SharedPart.read to return false for footer_part specifically
        SharedPart.read.mockImplementation((name) => {
          if (name === "footer_part") {
            return Promise.resolve(false);
          }
          if (mockSharedPartTemplates[name]) {
            return Promise.resolve(mockSharedPartTemplates[name]);
          }
          return Promise.resolve(false);
        });

        await testGenerator(mockUrl, mockTestName);

        expect(consola.warn).toHaveBeenCalledWith(`Shared part "footer_part" wasn't found`);
        // Should not exit the process, just return from function
        expect(mockExitSpy).not.toHaveBeenCalled();
      });
    });

    describe("period custom data processing", () => {
      it("should process period custom data correctly", async () => {
        await testGenerator(mockUrl, mockTestName);

        // Verify the custom data is processed correctly
        expect(Utils.exportYAML).toHaveBeenCalledWith(
          mockReconciliationHandle,
          expect.objectContaining({
            [mockTestName]: expect.objectContaining({
              data: expect.objectContaining({
                periods: expect.objectContaining({
                  "2024-12-31": expect.objectContaining({
                    custom: {
                      "pit_integration.code_1002": "yes",
                    },
                  }),
                }),
              }),
            }),
          }),
          "reconciliationText"
        );
      });

      it("should handle empty period custom data", async () => {
        SF.getAllPeriodCustom = jest.fn().mockResolvedValue([]);

        await testGenerator(mockUrl, mockTestName);

        // Should not add custom data if empty
        expect(Utils.exportYAML).toHaveBeenCalledWith(
          mockReconciliationHandle,
          expect.objectContaining({
            [mockTestName]: expect.objectContaining({
              data: expect.objectContaining({
                periods: expect.objectContaining({
                  "2024-12-31": expect.not.objectContaining({
                    custom: expect.anything(),
                  }),
                }),
              }),
            }),
          }),
          "reconciliationText"
        );
      });
    });

    describe("error handling", () => {
      it("should exit with error code 1 for authorization failures", async () => {
        // Override the mock to simulate unauthorized firm
        firmCredentials.data = {};

        await expect(testGenerator(mockUrl, mockTestName)).rejects.toThrow("Process.exit called with code 1");
        expect(consola.error).toHaveBeenCalledWith(`You have no authorization to access firm id ${mockParameters.firmId}`);
      });

      it("should warn and exit for missing reconciliation template", async () => {
        ReconciliationText.read.mockResolvedValue(false);

        await expect(testGenerator(mockUrl, mockTestName)).rejects.toThrow("Process.exit called with code undefined");
        expect(consola.warn).toHaveBeenCalledWith(`Template "${mockReconciliationHandle}" wasn't found`);
      });

      it("should warn and return gracefully for missing shared parts", async () => {
        // Mock SharedPart.read to return false for footer_part specifically
        SharedPart.read.mockImplementation((name) => {
          if (name === "footer_part") {
            return Promise.resolve(false);
          }
          if (mockSharedPartTemplates[name]) {
            return Promise.resolve(mockSharedPartTemplates[name]);
          }
          return Promise.resolve(false);
        });

        await testGenerator(mockUrl, mockTestName);

        expect(consola.warn).toHaveBeenCalledWith(`Shared part "footer_part" wasn't found`);
        // Should not exit the process
        expect(mockExitSpy).not.toHaveBeenCalled();
      });
    });

    describe("period data handling", () => {
      it("should set current period correctly", async () => {
        await testGenerator(mockUrl, mockTestName);

        expect(Utils.exportYAML).toHaveBeenCalledWith(
          mockReconciliationHandle,
          expect.objectContaining({
            [mockTestName]: expect.objectContaining({
              context: expect.objectContaining({
                period: "2024-12-31",
              }),
              data: expect.objectContaining({
                periods: expect.objectContaining({
                  "2024-12-31": expect.any(Object),
                }),
              }),
            }),
          }),
          "reconciliationText"
        );
      });

      it("should handle previous period correctly", async () => {
        const previousPeriodData = {
          fiscal_year: { end_date: "2023-12-31" },
        };
        SF.getPeriods.mockResolvedValue({
          data: [mockPeriodData, previousPeriodData],
        });

        await testGenerator(mockUrl, mockTestName);

        expect(Utils.exportYAML).toHaveBeenCalledWith(
          mockReconciliationHandle,
          expect.objectContaining({
            [mockTestName]: expect.objectContaining({
              data: expect.objectContaining({
                periods: expect.objectContaining({
                  "2024-12-31": expect.any(Object),
                  "2023-12-31": null,
                }),
              }),
            }),
          }),
          "reconciliationText"
        );
      });
    });

    describe("account template test generation", () => {
      const mockAccountUrl = "https://live.getsilverfin.com/f/123/456/ledgers/789/workflows/101/account_entry/5000";
      const mockAccountParameters = {
        templateType: "accountTemplate",
        firmId: "123",
        companyId: "456",
        ledgerId: "789",
        workflowId: "101",
        accountId: "5000",
      };
      const mockAccountTemplateHandle = "test_account_template";
      const mockAccountResponse = {
        account: {
          id: 1001,
          number: "5000",
          name: "Test Account",
        },
        value: "12345.67",
        starred: false,
        account_reconciliation_template: {
          id: 9999,
        },
      };
      const mockAccountTemplateDetails = {
        name_nl: "test_account_template",
        name_en: "Test Account Template",
        id: 9999,
      };
      const mockAccountTemplate = {
        name_nl: "test_account_template",
        id: 9999,
        text: "Main liquid content for account template",
        text_parts: [{ name: "part_1", content: "Part 1 content" }],
        externally_managed: true,
      };

      beforeEach(() => {
        // Override extractURL for account template tests
        Utils.extractURL.mockReturnValue(mockAccountParameters);
        Utils.createBaseLiquidTest.mockReturnValue({
          [mockTestName]: {
            context: { period: "2024-12-31" },
            data: {
              periods: {
                replace_period_name: {
                  accounts: {},
                },
              },
            },
            expectation: {
              reconciled: true,
              results: {},
            },
          },
        });

        // Mock AccountTemplate.read
        AccountTemplate.read.mockResolvedValue(mockAccountTemplate);

        // Mock SF API calls for account templates
        SF.findAccountByNumber = jest.fn().mockResolvedValue(mockAccountResponse);
        SF.readAccountTemplateById = jest.fn().mockResolvedValue(mockAccountTemplateDetails);
        SF.getAccountTemplateCustom = jest.fn().mockResolvedValue({
          data: [
            {
              namespace: "account_namespace",
              key: "account_key",
              value: "account_value",
            },
          ],
        });
        SF.getAccountTemplateResults = jest.fn().mockResolvedValue({
          data: { account_result1: "value1", account_result2: "value2" },
        });
      });

      it("should read account template correctly", async () => {
        await testGenerator(mockAccountUrl, mockTestName);

        // Verify account lookup
        expect(SF.findAccountByNumber).toHaveBeenCalledWith(
          mockAccountParameters.firmId,
          mockAccountParameters.companyId,
          mockAccountParameters.ledgerId,
          mockAccountParameters.accountId
        );

        // Verify template details fetch
        expect(SF.readAccountTemplateById).toHaveBeenCalledWith("firm", mockAccountParameters.firmId, 9999);

        // Verify AccountTemplate.read was called with the correct handle
        expect(AccountTemplate.read).toHaveBeenCalledWith(mockAccountTemplateHandle);
      });

      it("should set current_account in context", async () => {
        await testGenerator(mockAccountUrl, mockTestName);

        expect(Utils.exportYAML).toHaveBeenCalledWith(
          mockAccountTemplateHandle,
          expect.objectContaining({
            [mockTestName]: expect.objectContaining({
              context: expect.objectContaining({
                current_account: "5000",
                period: "2024-12-31",
              }),
            }),
          }),
          "accountTemplate"
        );
      });

      it("should fetch account template custom and results", async () => {
        await testGenerator(mockAccountUrl, mockTestName);

        // Verify custom fetch
        expect(SF.getAccountTemplateCustom).toHaveBeenCalledWith(
          "firm",
          mockAccountParameters.firmId,
          mockAccountParameters.companyId,
          mockAccountParameters.ledgerId,
          mockAccountResponse.account.id
        );

        // Verify results fetch
        expect(SF.getAccountTemplateResults).toHaveBeenCalledWith(
          "firm",
          mockAccountParameters.firmId,
          mockAccountParameters.companyId,
          mockAccountParameters.ledgerId,
          mockAccountResponse.account.id
        );

        // Verify account data structure in test object
        expect(Utils.exportYAML).toHaveBeenCalledWith(
          mockAccountTemplateHandle,
          expect.objectContaining({
            [mockTestName]: expect.objectContaining({
              data: expect.objectContaining({
                periods: expect.objectContaining({
                  "2024-12-31": expect.objectContaining({
                    accounts: expect.objectContaining({
                      5000: expect.objectContaining({
                        name: "Test Account",
                        value: 12345.67,
                        custom: expect.objectContaining({
                          "account_namespace.account_key": "account_value",
                        }),
                      }),
                    }),
                  }),
                }),
              }),
              expectation: expect.objectContaining({
                results: expect.objectContaining({
                  account_result1: "value1",
                  account_result2: "value2",
                }),
              }),
            }),
          }),
          "accountTemplate"
        );
      });

      it("should use starred status from account response", async () => {
        const starredAccountResponse = {
          ...mockAccountResponse,
          starred: true,
        };
        SF.findAccountByNumber.mockResolvedValue(starredAccountResponse);

        await testGenerator(mockAccountUrl, mockTestName);

        // The starred status should be extracted from response (not from workflow lookup)
        expect(SF.findReconciliationInWorkflow).not.toHaveBeenCalled();
      });

      it("should skip dependency resolution for account templates", async () => {
        await testGenerator(mockAccountUrl, mockTestName);

        // Verify shared parts are NOT searched (dependency resolution is skipped)
        expect(SharedPart.read).not.toHaveBeenCalled();

        // Verify the test object does not contain reconciliation dependencies
        // (only account data should be present)
        expect(Utils.exportYAML).toHaveBeenCalledWith(
          mockAccountTemplateHandle,
          expect.objectContaining({
            [mockTestName]: expect.objectContaining({
              data: expect.objectContaining({
                periods: expect.objectContaining({
                  "2024-12-31": expect.objectContaining({
                    accounts: expect.any(Object),
                    // Should not have reconciliations object
                  }),
                }),
              }),
            }),
          }),
          "accountTemplate"
        );
      });

      it("should handle missing account template association gracefully", async () => {
        const accountWithoutTemplate = {
          ...mockAccountResponse,
          account_reconciliation_template: null,
        };
        SF.findAccountByNumber.mockResolvedValue(accountWithoutTemplate);

        await expect(testGenerator(mockAccountUrl, mockTestName)).rejects.toThrow("Process.exit called with code 1");
        expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("No account template associated with account"));
      });

      it("should handle missing account template file gracefully", async () => {
        AccountTemplate.read.mockResolvedValue(false);

        await expect(testGenerator(mockAccountUrl, mockTestName)).rejects.toThrow("Process.exit called with code undefined");
        expect(consola.warn).toHaveBeenCalledWith(`Template "${mockAccountTemplateHandle}" wasn't found`);
      });

      it("should handle account lookup errors gracefully", async () => {
        SF.findAccountByNumber.mockRejectedValue(new Error("Account not found"));

        await expect(testGenerator(mockAccountUrl, mockTestName)).rejects.toThrow("Process.exit called with code 1");
        expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("Failed to get account template details"));
      });

      it("should process period custom data for account templates", async () => {
        await testGenerator(mockAccountUrl, mockTestName);

        expect(Utils.exportYAML).toHaveBeenCalledWith(
          mockAccountTemplateHandle,
          expect.objectContaining({
            [mockTestName]: expect.objectContaining({
              data: expect.objectContaining({
                periods: expect.objectContaining({
                  "2024-12-31": expect.objectContaining({
                    custom: expect.objectContaining({
                      "pit_integration.code_1002": "yes",
                    }),
                  }),
                }),
              }),
            }),
          }),
          "accountTemplate"
        );
      });

      it("should handle empty period custom data for account templates", async () => {
        SF.getAllPeriodCustom.mockResolvedValue([]);

        await testGenerator(mockAccountUrl, mockTestName);

        // Should not add custom data if empty
        expect(Utils.exportYAML).toHaveBeenCalledWith(
          mockAccountTemplateHandle,
          expect.objectContaining({
            [mockTestName]: expect.objectContaining({
              data: expect.objectContaining({
                periods: expect.objectContaining({
                  "2024-12-31": expect.not.objectContaining({
                    custom: expect.anything(),
                  }),
                }),
              }),
            }),
          }),
          "accountTemplate"
        );
      });
    });
  });
});
