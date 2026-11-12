import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  sortImports: { ...ultracite.sortImports, partitionByComment: true },
  ignorePatterns: [...ultracite.ignorePatterns, "vendor/visio"],
});
