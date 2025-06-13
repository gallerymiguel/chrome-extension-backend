import js from "@eslint/js";
import globals from "globals";
import jestPlugin from "eslint-plugin-jest";   // <— add this dev-dep

export default [

  // ❶ Base rules that apply everywhere
  js.configs.recommended,

  // ❷ App / source code  → Node environment
  {
    files: ["src/**/*.js", "*.js"],           // adjust path if needed
    languageOptions: {
      globals: globals.node,                  // adds process, Buffer…
      sourceType: "commonjs",
    },
    rules: {
      // custom Node-only rules here
    },
  },

  // ❸ Test files  → Node + Jest environment
  {
    files: ["**/__tests__/**/*.js", "**/*.test.js"],
    plugins: { jest: jestPlugin },
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,                      // adds test, expect, beforeAll…
      },
      sourceType: "commonjs",
    },
    rules: {
      "jest/expect-expect": "error",
      // add or relax test-specific rules here
    },
  },

  // ❹ (Optional) loose browser scripts  → Browser globals
  {
    files: ["public/**/*.js"],
    languageOptions: {
      globals: globals.browser,
      sourceType: "script",
    },
  },
];
