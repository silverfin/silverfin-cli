// Unused imports removed - not needed for this test file
const { testGenerator } = require("../../lib/liquidTestGenerator");
const SF = require("../../lib/api/sfApi");
const { firmCredentials } = require("../../lib/api/firmCredentials");
const Utils = require("../../lib/utils/liquidTestUtils");
const { ReconciliationText } = require("../../lib/templates/reconciliationText");
const { SharedPart } = require("../../lib/templates/sharedPart");
const { consola } = require("consola");

// Mock all dependencies
jest.mock("../../lib/api/sfApi");
jest.mock("../../lib/api/firmCredentials");
jest.mock("../../lib/utils/liquidTestUtils");
jest.mock("../../lib/templates/reconciliationText");
jest.mock("../../lib/templates/sharedPart");
jest.mock("consola");

describe("liquidTestGenerator", () => {
  let mockExitSpy;
  const mockUrl = "https://live.getsilverfin.com/f/123/456/ledgers/789/workflows/101/reconciliation_texts/202";
  const mockTestName = "unit_1_test_1";
  const mockParameters = {
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

  beforeEach(() => {
    jest.clearAllMocks();

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
    Utils.searchForResultsFromDependenciesInLiquid.mockReturnValue({});
    Utils.searchForCustomsFromDependenciesInLiquid.mockReturnValue({});
    Utils.lookForSharedPartsInLiquid.mockReturnValue([]);
    Utils.getCompanyDependencies.mockReturnValue({
      standardDropElements: [],
      customDropElements: [],
    });
    Utils.lookForAccountsIDs.mockReturnValue([]);
    Utils.exportYAML.mockImplementation(() => {});
    Utils.processCustom.mockReturnValue({
      "test_namespace.test_key": "test_value",
    });

    // Mock firmCredentials
    firmCredentials.data = { 123: { accessToken: "mock_token" } };

    // Mock SF API calls
    SF.readReconciliationTextDetails = jest.fn().mockResolvedValue({
      data: { handle: mockReconciliationHandle },
    });
    SF.findReconciliationInWorkflow = jest.fn().mockReturnValue({ starred: true });
    SF.getPeriods = jest.fn().mockResolvedValue({
      data: [mockPeriodData],
    });
    SF.findPeriod = jest.fn().mockReturnValue(mockPeriodData);
    SF.getPeriodCustom = jest.fn().mockResolvedValue({
      data: [
        {
          namespace: "pit_integration",
          key: "code_1002",
          value: "yes",
          owner: { id: 100660006, type: "Ledger" },
          documents: [],
          updated_by_id: null,
        },
      ],
    });
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
      data: { company_name: "Test Company" },
    });
    SF.getCompanyCustom = jest.fn().mockResolvedValue({
      data: [],
    });

    // Mock template reading
    ReconciliationText.read.mockResolvedValue({
      handle: mockReconciliationHandle,
      text: "Main liquid content",
      text_parts: [{ name: "part1", content: "Part 1 content" }],
    });

    SharedPart.read.mockResolvedValue({
      name: "shared_part_name",
      text: "Shared part content",
      text_parts: [],
    });
  });

  afterEach(() => {
    mockExitSpy.mockRestore();
  });

  describe("testGenerator", () => {
    describe("template reading", () => {
      it("should handle missing reconciliation template gracefully", async () => {
        ReconciliationText.read.mockResolvedValue(false);

        await expect(testGenerator(mockUrl, mockTestName)).rejects.toThrow("Process.exit called with code undefined");
        expect(consola.warn).toHaveBeenCalledWith(`Reconciliation "${mockReconciliationHandle}" wasn't found`);
      });

      it("should handle missing shared part gracefully", async () => {
        Utils.lookForSharedPartsInLiquid.mockReturnValue(["missing_shared_part"]);
        SharedPart.read.mockResolvedValue(false);

        await testGenerator(mockUrl, mockTestName);

        expect(consola.warn).toHaveBeenCalledWith(`Shared part "missing_shared_part" wasn't found`);
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
          })
        );
      });

      it("should handle empty period custom data", async () => {
        SF.getPeriodCustom = jest.fn().mockResolvedValue({ data: [] });

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
          })
        );
      });

      it("should handle period custom data with missing namespace or key", async () => {
        SF.getPeriodCustom = jest.fn().mockResolvedValue({
          data: [
            { namespace: "test", key: "value", value: "should_be_included" },
            { namespace: "", key: "value", value: "should_be_excluded" },
            { namespace: "test", key: "", value: "should_be_excluded" },
            { value: "should_be_excluded" },
          ],
        });

        await testGenerator(mockUrl, mockTestName);

        // Only the first item should be included
        expect(Utils.exportYAML).toHaveBeenCalledWith(
          mockReconciliationHandle,
          expect.objectContaining({
            [mockTestName]: expect.objectContaining({
              data: expect.objectContaining({
                periods: expect.objectContaining({
                  "2024-12-31": expect.objectContaining({
                    custom: {
                      "test.value": "should_be_included",
                    },
                  }),
                }),
              }),
            }),
          })
        );
      });
    });

    describe("error handling improvements", () => {
      it("should exit with error code 1 for authorization failures", async () => {
        firmCredentials.data = {};

        await expect(testGenerator(mockUrl, mockTestName)).rejects.toThrow("Process.exit called with code 1");
        expect(consola.error).toHaveBeenCalledWith(`You have no authorization to access firm id ${mockParameters.firmId}`);
      });

      it("should warn and exit for missing reconciliation template", async () => {
        ReconciliationText.read.mockResolvedValue(false);

        await expect(testGenerator(mockUrl, mockTestName)).rejects.toThrow("Process.exit called with code undefined");
        expect(consola.warn).toHaveBeenCalledWith(`Reconciliation "${mockReconciliationHandle}" wasn't found`);
      });

      it("should warn and return gracefully for missing shared parts", async () => {
        Utils.lookForSharedPartsInLiquid.mockReturnValue(["missing_shared_part"]);
        SharedPart.read.mockResolvedValue(false);

        await testGenerator(mockUrl, mockTestName);

        expect(consola.warn).toHaveBeenCalledWith(`Shared part "missing_shared_part" wasn't found`);
        // Should not exit the process
        expect(mockExitSpy).not.toHaveBeenCalled();
      });
    });

    describe("integration with utility functions", () => {
      it("should pass correct object structure to utility functions", async () => {
        await testGenerator(mockUrl, mockTestName);

        // Verify that the correct object structure is passed to utility functions
        expect(Utils.searchForResultsFromDependenciesInLiquid).toHaveBeenCalledWith(
          expect.objectContaining({
            text: "Main liquid content",
            text_parts: [{ name: "part1", content: "Part 1 content" }],
          }),
          mockReconciliationHandle
        );

        expect(Utils.searchForCustomsFromDependenciesInLiquid).toHaveBeenCalledWith(
          expect.objectContaining({
            text: "Main liquid content",
            text_parts: [{ name: "part1", content: "Part 1 content" }],
          }),
          mockReconciliationHandle
        );

        expect(Utils.lookForSharedPartsInLiquid).toHaveBeenCalledWith(
          expect.objectContaining({
            text: "Main liquid content",
            text_parts: [{ name: "part1", content: "Part 1 content" }],
          }),
          mockReconciliationHandle
        );
      });

      it("should handle shared parts with nested dependencies", async () => {
        Utils.lookForSharedPartsInLiquid
          .mockReturnValueOnce(["shared_part_1"]) // First call for main template
          .mockReturnValueOnce(["nested_shared_part"]); // Second call for shared part

        await testGenerator(mockUrl, mockTestName);

        expect(SharedPart.read).toHaveBeenCalledWith("shared_part_1");
        expect(Utils.searchForResultsFromDependenciesInLiquid).toHaveBeenCalledWith(
          expect.objectContaining({ name: "shared_part_name", text: "Shared part content" }),
          "shared_part_name",
          expect.any(Object)
        );
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
          })
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
          })
        );
      });
    });
  });
});
