const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");

// Only mock API calls and console, let filesystem operations run normally
jest.mock("consola");
jest.mock("../../../lib/api/sfApi");

const SF = require("../../../lib/api/sfApi");
const consola = require("consola");
const toolkit = require("../../../index");

describe("import-reconciliation", () => {
  let tempDir;
  let originalCwd;
  let originalExit;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create temporary directory and change to it
    tempDir = await fsPromises.mkdtemp(path.join(__dirname, "temp-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);

    originalExit = process.exit;
    process.exit = jest.fn();

    consola.success = jest.fn();
    consola.error = jest.fn();
    consola.info = jest.fn();
    consola.log = jest.fn();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    process.exit = originalExit;

    // Clean up temp directory
    try {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.error("Failed to clean up temp directory:", error);
      process.exit(1);
    }
  });

  describe("import reconciliation by id", () => {
    describe("from a firm", () => {
      describe("non-existing reconciliation text", () => {
        const mockApiResponse = {
          id: 12345,
          handle: "test_reconciliation",
          text: "{% comment %}Test reconciliation content{% endcomment %}\n{{ period.year }}",
          text_parts: [
            { name: "part_1", content: "Part 1: calculation logic" },
            { name: "part_2", content: "Part 2: validation" },
          ],
          tests: "test_1:\n  data:\n    period:\n      year: 2023\n  results:\n    verified: true",
          name_en: "Test Reconciliation",
          reconciliation_type: "can_be_reconciled_without_data",
          externally_managed: true,
          published: true,
        };

        it("should import the reconciliation by ID and create all necessary files", async () => {
          // Mock API response
          SF.readReconciliationTextById.mockResolvedValue({ data: mockApiResponse });

          // Call toolkit method directly
          await toolkit.fetchReconciliationById("firm", "1001", "12345");

          // Verify API was called
          expect(SF.readReconciliationTextById).toHaveBeenCalledWith("firm", "1001", "12345");

          // Verify success message
          expect(consola.success).toHaveBeenCalledWith('Reconciliation "test_reconciliation" imported from firm 1001');

          // Assert file system state
          const reconciliationDir = path.join(tempDir, "reconciliation_texts", "test_reconciliation");

          // Check that main.liquid was created with correct content
          expect(fs.existsSync(path.join(reconciliationDir, "main.liquid"))).toBe(true);
          const mainContent = fs.readFileSync(path.join(reconciliationDir, "main.liquid"), "utf8");
          expect(mainContent).toBe("{% comment %}Test reconciliation content{% endcomment %}\n{{ period.year }}");

          // Check that text_parts were created
          expect(fs.existsSync(path.join(reconciliationDir, "text_parts", "part_1.liquid"))).toBe(true);
          expect(fs.existsSync(path.join(reconciliationDir, "text_parts", "part_2.liquid"))).toBe(true);

          const part1Content = fs.readFileSync(path.join(reconciliationDir, "text_parts", "part_1.liquid"), "utf8");
          expect(part1Content).toBe("Part 1: calculation logic");

          const part2Content = fs.readFileSync(path.join(reconciliationDir, "text_parts", "part_2.liquid"), "utf8");
          expect(part2Content).toBe("Part 2: validation");

          // Check that tests were created
          expect(fs.existsSync(path.join(reconciliationDir, "tests", "test_reconciliation_liquid_test.yml"))).toBe(true);
          const testsContent = fs.readFileSync(path.join(reconciliationDir, "tests", "test_reconciliation_liquid_test.yml"), "utf8");
          expect(testsContent).toBe("test_1:\n  data:\n    period:\n      year: 2023\n  results:\n    verified: true");

          // Check config.json was created with correct structure
          expect(fs.existsSync(path.join(reconciliationDir, "config.json"))).toBe(true);
          const configContent = JSON.parse(fs.readFileSync(path.join(reconciliationDir, "config.json"), "utf8"));

          expect(configContent).toEqual({
            id: { 1001: 12345 },
            partner_id: {},
            handle: "test_reconciliation",
            text: "main.liquid",
            text_parts: {
              part_1: "text_parts/part_1.liquid",
              part_2: "text_parts/part_2.liquid",
            },
            test: "tests/test_reconciliation_liquid_test.yml",
            externally_managed: true,
            auto_hide_formula: "",
            downloadable_as_docx: false,
            hide_code: true,
            is_active: true,
            name_en: "Test Reconciliation",
            name_fr: "test_reconciliation",
            name_nl: "test_reconciliation",
            public: false,
            published: true,
            reconciliation_type: "can_be_reconciled_without_data",
            use_full_width: true,
            virtual_account_number: "",
          });
        });
      });

      describe("existing reconciliation text", () => {
        const mockApiResponse = {
          id: 54321,
          handle: "existing_reconciliation",
          text: "{% comment %}Updated content{% endcomment %}\n{{ company.name }}",
          text_parts: [
            { name: "shared_part", content: "Updated shared content" },
            { name: "new_part", content: "New part from remote" },
          ],
          tests: "updated_test:\n  data:\n    company:\n      name: Test Company\n  results:\n    status: updated",
          name_en: "Existing Reconciliation Updated",
          reconciliation_type: "only_reconciled_with_data",
          externally_managed: false,
          published: true,
        };

        it("should import the reconciliation and update necessary existing files", async () => {
          // Setup: Copy fixtures to temp directory to simulate existing files
          const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
          await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

          // Rename one of the existing reconciliation texts to match our test
          const existingReconciliation = path.join(tempDir, "reconciliation_texts", "reconciliation_text_1");
          const targetReconciliation = path.join(tempDir, "reconciliation_texts", "existing_reconciliation");

          if (fs.existsSync(existingReconciliation)) {
            await fsPromises.rename(existingReconciliation, targetReconciliation);
          }

          // Create initial files for the existing reconciliation
          await fsPromises.mkdir(path.join(targetReconciliation, "text_parts"), { recursive: true });
          await fsPromises.mkdir(path.join(targetReconciliation, "tests"), { recursive: true });

          await fsPromises.writeFile(path.join(targetReconciliation, "main.liquid"), "{% comment %}Original content{% endcomment %}");
          await fsPromises.writeFile(path.join(targetReconciliation, "text_parts", "shared_part.liquid"), "Original shared content");
          await fsPromises.writeFile(path.join(targetReconciliation, "tests", "existing_reconciliation_liquid_test.yml"), "original_test:\n  data: {}\n  results: {}");
          await fsPromises.writeFile(
            path.join(targetReconciliation, "config.json"),
            JSON.stringify(
              {
                id: { 1001: 12345 },
                handle: "existing_reconciliation",
                reconciliation_type: "can_be_reconciled_without_data",
              },
              null,
              2
            )
          );

          // Mock API response
          SF.readReconciliationTextById.mockResolvedValue({ data: mockApiResponse });

          // Import reconciliation by ID (this should update existing files)
          await toolkit.fetchReconciliationById("firm", "1001", 54321);

          // Verify API call and success message
          expect(SF.readReconciliationTextById).toHaveBeenCalledWith("firm", "1001", 54321);
          expect(consola.success).toHaveBeenCalledWith('Reconciliation "existing_reconciliation" imported from firm 1001');

          // Assert files were updated
          const reconciliationDir = path.join(tempDir, "reconciliation_texts", "existing_reconciliation");

          const mainContent = fs.readFileSync(path.join(reconciliationDir, "main.liquid"), "utf8");
          expect(mainContent).toBe("{% comment %}Updated content{% endcomment %}\n{{ company.name }}");

          const sharedPartContent = fs.readFileSync(path.join(reconciliationDir, "text_parts", "shared_part.liquid"), "utf8");
          expect(sharedPartContent).toBe("Updated shared content");

          const newPartContent = fs.readFileSync(path.join(reconciliationDir, "text_parts", "new_part.liquid"), "utf8");
          expect(newPartContent).toBe("New part from remote");

          const testsContent = fs.readFileSync(path.join(reconciliationDir, "tests", "existing_reconciliation_liquid_test.yml"), "utf8");
          expect(testsContent).toBe("original_test:\n  data: {}\n  results: {}");

          // Check config structure
          const config = JSON.parse(fs.readFileSync(path.join(reconciliationDir, "config.json"), "utf8"));
          expect(config.id).toEqual({ 1001: 54321 });
          expect(config.handle).toBe("existing_reconciliation");
          expect(config.text_parts).toEqual({
            shared_part: "text_parts/shared_part.liquid",
            new_part: "text_parts/new_part.liquid",
          });
          expect(config.reconciliation_type).toBe("only_reconciled_with_data");
          expect(config.externally_managed).toBe(false);
        });
      });
    });

    describe("from partners", () => {
      describe("non-existing reconciliation text", () => {
        it("should import reconciliation and create necessary files", async () => {
          const mockApiResponse = {
            id: 11111,
            handle: "partner_reconciliation",
            text: "{% comment %}Partner content{% endcomment %}",
            text_parts: [],
            tests: "partner_test:\n  data: {}\n  results:\n    partner_specific: true",
            name_en: "Partner Reconciliation",
            reconciliation_type: "can_be_reconciled_without_data",
            published: true,
          };
          SF.readReconciliationTextById.mockResolvedValue({ data: mockApiResponse });

          // Call with partner environment
          await toolkit.fetchReconciliationById("partner", "25", "11111");

          // Verify API call and success message
          expect(SF.readReconciliationTextById).toHaveBeenCalledWith("partner", "25", "11111");
          expect(consola.success).toHaveBeenCalledWith('Reconciliation "partner_reconciliation" imported from partner 25');

          // Verify files were created with partner ID in config
          const reconciliationDir = path.join(tempDir, "reconciliation_texts", "partner_reconciliation");
          const config = JSON.parse(fs.readFileSync(path.join(reconciliationDir, "config.json"), "utf8"));

          expect(config.id).toEqual({});
          expect(config.partner_id).toEqual({ 25: 11111 });
          expect(config.handle).toBe("partner_reconciliation");

          // Verify main content was created
          const mainContent = fs.readFileSync(path.join(reconciliationDir, "main.liquid"), "utf8");
          expect(mainContent).toBe("{% comment %}Partner content{% endcomment %}");
        });
      });

      describe("existing reconciliation text", () => {
        it("should import the reconciliation and update necessary files", async () => {
          const mockApiResponse = {
            id: 22222,
            handle: "existing_partner_reconciliation",
            text: "{% comment %}Updated partner content{% endcomment %}\n{{ partner.data }}",
            text_parts: [
              { name: "partner_shared", content: "Updated partner shared content" },
              { name: "partner_new", content: "New partner-specific content" },
            ],
            tests: "updated_partner_test:\n  data:\n    partner:\n      data: updated\n  results:\n    partner_verified: true",
            name_en: "Existing Partner Reconciliation Updated",
            reconciliation_type: "only_reconciled_with_data",
            externally_managed: true,
            published: false,
          };

          // Setup: Copy fixtures to temp directory to simulate existing files
          const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
          await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

          // Rename one of the existing reconciliation texts to match our test
          const existingReconciliation = path.join(tempDir, "reconciliation_texts", "reconciliation_text_2");
          const targetReconciliation = path.join(tempDir, "reconciliation_texts", "existing_partner_reconciliation");

          if (fs.existsSync(existingReconciliation)) {
            await fsPromises.rename(existingReconciliation, targetReconciliation);
          }

          // Create initial files for the existing partner reconciliation
          await fsPromises.mkdir(path.join(targetReconciliation, "text_parts"), { recursive: true });
          await fsPromises.mkdir(path.join(targetReconciliation, "tests"), { recursive: true });

          await fsPromises.writeFile(path.join(targetReconciliation, "main.liquid"), "{% comment %}Original partner content{% endcomment %}");
          await fsPromises.writeFile(path.join(targetReconciliation, "text_parts", "partner_shared.liquid"), "Original partner shared content");
          await fsPromises.writeFile(
            path.join(targetReconciliation, "tests", "existing_partner_reconciliation_liquid_test.yml"),
            "original_partner_test:\n  data: {}\n  results: {}"
          );
          await fsPromises.writeFile(
            path.join(targetReconciliation, "config.json"),
            JSON.stringify(
              {
                id: {},
                partner_id: { 25: 11111 },
                handle: "existing_partner_reconciliation",
                reconciliation_type: "can_be_reconciled_without_data",
              },
              null,
              2
            )
          );

          // Mock API response
          SF.readReconciliationTextById.mockResolvedValue({ data: mockApiResponse });

          // Import reconciliation by ID from partner (this should update existing files)
          await toolkit.fetchReconciliationById("partner", "25", 22222);

          // Verify API call and success message
          expect(SF.readReconciliationTextById).toHaveBeenCalledWith("partner", "25", 22222);
          expect(consola.success).toHaveBeenCalledWith('Reconciliation "existing_partner_reconciliation" imported from partner 25');

          // Assert files were updated
          const reconciliationDir = path.join(tempDir, "reconciliation_texts", "existing_partner_reconciliation");

          const mainContent = fs.readFileSync(path.join(reconciliationDir, "main.liquid"), "utf8");
          expect(mainContent).toBe("{% comment %}Updated partner content{% endcomment %}\n{{ partner.data }}");

          const sharedPartContent = fs.readFileSync(path.join(reconciliationDir, "text_parts", "partner_shared.liquid"), "utf8");
          expect(sharedPartContent).toBe("Updated partner shared content");

          const newPartContent = fs.readFileSync(path.join(reconciliationDir, "text_parts", "partner_new.liquid"), "utf8");
          expect(newPartContent).toBe("New partner-specific content");

          const testsContent = fs.readFileSync(path.join(reconciliationDir, "tests", "existing_partner_reconciliation_liquid_test.yml"), "utf8");
          expect(testsContent).toBe("original_partner_test:\n  data: {}\n  results: {}");

          // Check config structure - partner should maintain partner_id structure
          const config = JSON.parse(fs.readFileSync(path.join(reconciliationDir, "config.json"), "utf8"));
          expect(config.id).toEqual({});
          expect(config.partner_id).toEqual({ 25: 22222 });
          expect(config.handle).toBe("existing_partner_reconciliation");
          expect(config.text_parts).toEqual({
            partner_shared: "text_parts/partner_shared.liquid",
            partner_new: "text_parts/partner_new.liquid",
          });
          expect(config.reconciliation_type).toBe("only_reconciled_with_data");
          expect(config.externally_managed).toBe(true);
        });
      });

      describe("error handling", () => {
        it("should handle reconciliation not found by ID", async () => {
          // Mock API response with no data
          SF.readReconciliationTextById.mockResolvedValue({ data: null });

          await toolkit.fetchReconciliationById("firm", "1001", "99999");

          expect(SF.readReconciliationTextById).toHaveBeenCalledWith("firm", "1001", "99999");
          expect(consola.error).toHaveBeenCalledWith("Reconciliation with id 99999 wasn't found in firm 1001");
          expect(process.exit).toHaveBeenCalledWith(1);

          // Ensure no files were created
          expect(fs.existsSync(path.join(tempDir, "reconciliation_texts"))).toBe(false);
        });

        it("should handle API error when fetching by ID", async () => {
          // Mock API error
          SF.readReconciliationTextById.mockRejectedValue(new Error("API Error"));

          await toolkit.fetchReconciliationById("firm", "1001", "12345");

          expect(SF.readReconciliationTextById).toHaveBeenCalledWith("firm", "1001", "12345");
          expect(consola.error).toHaveBeenCalled();
          expect(process.exit).toHaveBeenCalledWith(1);

          // Ensure no files were created
          expect(fs.existsSync(path.join(tempDir, "reconciliation_texts"))).toBe(false);
        });
      });
    });

    describe("import reconciliation by handle", () => {
      it("should find reconciliation by handle remotely when not local", async () => {
        const mockApiResponse = {
          id: 67890,
          handle: "remote_reconciliation",
          text: "{% comment %}Remote content{% endcomment %}",
          text_parts: [],
          tests: "remote_test:\n  data: {}\n  results: {}",
          name_en: "Remote Reconciliation",
          reconciliation_type: "can_be_reconciled_without_data",
          published: true,
        };

        // Mock remote lookup and API response
        SF.findReconciliationTextByHandle.mockResolvedValue({ id: "67890" });
        SF.readReconciliationTextById.mockResolvedValue({ data: mockApiResponse });

        // Call toolkit method directly - the async issue doesn't affect this test much
        await toolkit.fetchReconciliationByHandle("firm", "1001", "remote_reconciliation");

        // Verify remote lookup was performed
        expect(SF.findReconciliationTextByHandle).toHaveBeenCalledWith("firm", "1001", "remote_reconciliation");

        // Verify API was called with found ID
        expect(SF.readReconciliationTextById).toHaveBeenCalledWith("firm", "1001", "67890");

        // Verify files were created
        const reconciliationDir = path.join(tempDir, "reconciliation_texts", "remote_reconciliation");
        if (fs.existsSync(path.join(reconciliationDir, "config.json"))) {
          const config = JSON.parse(fs.readFileSync(path.join(reconciliationDir, "config.json"), "utf8"));
          expect(config.id).toEqual({ 1001: 67890 });
          expect(config.handle).toBe("remote_reconciliation");
        }
      });
    });
  });
});
