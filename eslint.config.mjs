// eslint.config.mjs
import js from "@eslint/js";
import globals from "globals";
import jestPlugin from "eslint-plugin-jest";

export default [
  // 1️⃣ Base rules
  js.configs.recommended,

  // 2️⃣ Regular app / source files  → Node globals
  {
    files: ["src/**/*.js"],                 // adjust if source lives elsewhere
    languageOptions: {
      globals: globals.node,
      sourceType: "commonjs",
    },
  },

  // 3️⃣ Jest test suites  → Node + Jest globals
  {
    files: ["**/__tests__/**/*.js", "**/*.test.js", "jest.setup.js"],   // 👈 added jest.setup.js here
    plugins: { jest: jestPlugin },
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: "commonjs",
    },
    rules: {
      "jest/expect-expect": "error",
    },
  },

  // 4️⃣ (Optional) browser scripts  → Browser globals
  {
    files: ["public/**/*.js"],
    languageOptions: {
      globals: globals.browser,
      sourceType: "script",
    },
  },
];
