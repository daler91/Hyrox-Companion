import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "migrations/**",
      "*.config.js",
      "*.config.ts",
      "script/**",
      "scripts/**",
      "attached_assets/**",
      "vitest.setup.ts",
      "cypress/**",
    ],
  },

  // Base recommended rules for all files
  eslint.configs.recommended,

  // TypeScript recommended rules
  ...tseslint.configs.recommendedTypeChecked,

  // Prettier compatibility (disables formatting rules)
  eslintConfigPrettier,

  // TypeScript parser settings
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Shared rules for all source files
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-misused-promises": [
        "warn",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
    },
  },

  // React hooks rules for client code
  {
    files: ["client/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // Server-side: no console (use pino logger)
  {
    files: ["server/**/*.ts"],
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // Relax rules for test files
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/tests/**/*.ts", "**/testUtils.ts", "**/helpers.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-console": "off",
    },
  },
);
