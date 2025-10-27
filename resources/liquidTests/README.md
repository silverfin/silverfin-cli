# Liquid Testing

## Pattern Matching Example

The `example_pattern_test.yml` file demonstrates how to use pattern matching to run batches of related tests.

### Example Usage

If you have tests organized with naming conventions like:
- `unit_3_test_1`, `unit_3_test_2`, `unit_3_test_3`
- `unit_4_test_1`, `unit_4_test_2`
- `table_test_1`, `table_test_2`

You can run specific groups of tests using the `--string-pattern` option:

```bash
# Run all unit 3 tests
silverfin run-test --handle <handle> --string-pattern "unit_3_"

# Run all unit 4 tests
silverfin run-test --handle <handle> --string-pattern "unit_4_"

# Run all table tests
silverfin run-test --handle <handle> --string-pattern "table_"
```

This feature is useful when:
- You want to test specific functionality (e.g., all table-related tests)
- You're developing a specific unit and want to run only those tests
- You want to run a subset of tests without running the entire test suite

## [Template name]

> Use this Readme file to add extra information about the Liquid Tests that can be performed
