module.exports = [
  require("@eslint/js").configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      ecmaVersion: "latest",
      globals: {
        ...require("globals").node,
        ...require("globals").jest,
      },
    },
    rules: {
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "prefer-const": "error",
      "prefer-object-has-own": "error",
    },
  },
];
