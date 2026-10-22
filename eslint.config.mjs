import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/out/**", "**/.next/**", "**/node_modules/**", "**/studio-dist/**", "examples/**", "**/*.d.ts", "**/coverage/**", "**/playwright-report/**", "**/test-results/**", "**/content/docs/**", "**/e2e/__screens__/**", "wrappers/python/src/postseed/_engine/**", "wrappers/python/src/postseed/studio-dist/**", "wrappers/ruby/lib/postseed/engine/**", "wrappers/ruby/lib/postseed/studio-dist/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports", prefer: "type-imports" }],
      "no-control-regex": "off",
      "no-eval": "error",
      "no-implied-eval": "error",
    },
  },
  {
    files: ["packages/studio/src/**/*.{ts,tsx}", "apps/web/src/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    rules: { ...nextPlugin.configs.recommended.rules, ...nextPlugin.configs["core-web-vitals"].rules, "@next/next/no-html-link-for-pages": "off" },
  },
);
