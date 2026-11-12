import { preset } from "@visio/oxlint-plugin/config";
import solidV2 from "eslint-plugin-solid/configs/v2";
import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";

export default defineConfig({
  // visio's conventions: vendor/visio/oxlint-plugin/DESIGN.md. Ultracite
  // first, so the project's own rules win.
  extends: [core, antiSlop, preset()],
  jsPlugins: ["eslint-plugin-solid"],
  plugins: [
    "eslint",
    "typescript",
    "unicorn",
    "oxc",
    "import",
    "jsdoc",
    "node",
    "promise",
  ],
  // oxlint does not read ignorePatterns from an extended config.
  ignorePatterns: [
    ...core.ignorePatterns,
    "vendor/visio",
    "**/*.gen.*",
    "dist",
    ".visio",
  ],
  categories: {
    correctness: "error",
    suspicious: "warn",
    perf: "warn",
  },
  settings: solidV2.settings,
  rules: {
    ...solidV2.rules,
    "no-unused-vars": "error",
    "typescript/no-explicit-any": "error",
    "typescript/consistent-type-imports": "error",
    "import/no-cycle": "error",
    // Side-effect imports are how the stylesheet is pulled in.
    "import/no-unassigned-import": "off",
    // Its fix reorders keys whose order is read: the screens of the tokens.
    "sort-keys": "off",
    "func-style": ["error", "declaration"],
    "no-use-before-define": ["error", { functions: false }],
    "no-inline-comments": "error",
  },
  overrides: [
    {
      files: ["**/*.d.ts"],
      rules: {
        "unicorn/require-module-specifiers": "off",
        "typescript/consistent-type-imports": "off",
      },
    },
  ],
});
