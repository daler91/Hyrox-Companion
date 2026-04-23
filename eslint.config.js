import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";

// Local a11y rule: `<Button size="icon" | "icon-touch">` renders an icon-only
// control. Without an `aria-label` (or `aria-labelledby`), screen readers
// have no accessible name for it. WCAG 4.1.2 Name, Role, Value.
//
// Note: the rule intentionally only checks the string-literal shape. A
// dynamic `size={someVar}` falls through and is assumed intentional.
// Empty / whitespace-only static labels (e.g. `aria-label=""`) count as
// missing — they exist as attributes but carry no accessible name.
const iconButtonNeedsLabelRule = {
  meta: {
    type: "problem",
    docs: { description: "Icon-only Button must have an aria-label" },
    schema: [],
    messages: {
      missingLabel:
        "Icon-only <Button size=\"{{size}}\"> must have a non-empty aria-label (or aria-labelledby) so screen readers have an accessible name.",
    },
  },
  create(context) {
    // Returns one of: "ok" (real value present), "empty" (statically-empty
    // string literal), or "dynamic" (JSX expression — we can't verify).
    const classifyLabelValue = (value) => {
      if (!value) return "empty"; // `<Button aria-label>` — no value at all
      if (value.type === "Literal") {
        return typeof value.value === "string" && value.value.trim() !== ""
          ? "ok"
          : "empty";
      }
      if (value.type === "JSXExpressionContainer") {
        const expr = value.expression;
        if (expr && expr.type === "Literal") {
          return typeof expr.value === "string" && expr.value.trim() !== ""
            ? "ok"
            : "empty";
        }
        return "dynamic";
      }
      return "dynamic";
    };

    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "Button") return;
        const attrs = node.attributes;
        const sizeAttr = attrs.find(
          (a) => a.type === "JSXAttribute" && a.name?.name === "size",
        );
        if (!sizeAttr || sizeAttr.value?.type !== "Literal") return;
        const sizeValue = sizeAttr.value.value;
        if (sizeValue !== "icon" && sizeValue !== "icon-touch") return;
        // Allow spread attributes (e.g. {...props}) to short-circuit the
        // check — we can't statically verify those carry a label.
        const hasSpread = attrs.some((a) => a.type === "JSXSpreadAttribute");
        if (hasSpread) return;
        const labelAttrs = attrs.filter(
          (a) =>
            a.type === "JSXAttribute" &&
            (a.name?.name === "aria-label" || a.name?.name === "aria-labelledby"),
        );
        // Accept if any label attr is statically non-empty OR dynamic.
        // Report only when every label attr is statically empty / missing.
        const verdicts = labelAttrs.map((a) => classifyLabelValue(a.value));
        const hasAcceptableLabel = verdicts.includes("ok") || verdicts.includes("dynamic");
        if (!hasAcceptableLabel) {
          context.report({
            node,
            messageId: "missingLabel",
            data: { size: sizeValue },
          });
        }
      },
    };
  },
};

const localA11yPlugin = {
  rules: { "icon-button-needs-label": iconButtonNeedsLabelRule },
};

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
      "client/public/**",
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

  // Import sorting — enforced across all source files
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "simple-import-sort/imports": "warn",
      "simple-import-sort/exports": "warn",
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
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
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
      "local-a11y": localA11yPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "local-a11y/icon-button-needs-label": "error",
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
