// @ts-check
const nextPlugin = require('@next/eslint-plugin-next');
const tsParser = require('@typescript-eslint/parser');

/** @type {import('eslint').Linter.FlatConfig[]} */
const config = [
  // ─── Next.js recommended rules ────────────────────────────────────────────
  {
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },

  // ─── i18n: warn on raw string literals in JSX ─────────────────────────────
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'no-restricted-syntax': [
        'warn',
        // JSX text nodes with 3+ alphabetic chars (catches raw UI strings between tags)
        {
          selector: 'JSXText[value=/[A-Za-zÄÖÜäöüß]{3,}/]',
          message: 'Raw text in JSX. Use {t("...")} from useAppTranslation.',
        },
        // String literals directly inside JSX expression containers
        {
          selector: 'JSXExpressionContainer > Literal[value=/[A-Za-zÄÖÜäöüß]{3,}/]',
          message: 'Raw string in JSX expression. Use t("...") from useAppTranslation.',
        },
      ],
    },
  },

  // ─── Ignores ───────────────────────────────────────────────────────────────
  {
    ignores: [
      '.next/**',
      '.next-local/**',
      '.next-local-lock/**',
      '.private/**',
      'node_modules/**',
      'messages/**',
      'scripts/**',
      'public/**',
      'src/lib/i18n/app-localization.ts',
      'src/lib/i18n/app-localization.ts.backup*',
    ],
  },
];

module.exports = config;
