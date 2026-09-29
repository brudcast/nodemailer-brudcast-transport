import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["test/dist/**"],
    languageOptions: { globals: { require: "readonly", console: "readonly" } },
    rules: { "@typescript-eslint/no-require-imports": "off" }
  }
);
