import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { marketscopePlugin } from './eslint-rules.js';

export default tseslint.config(
  {
    ignores: [
      '**/build/**',
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    plugins: {
      marketscope: marketscopePlugin,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'marketscope/no-em-dash': 'error',
      'marketscope/no-unsafe-html': 'error',
    },
  },
  {
    files: ['apps/extension/**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        chrome: 'readonly',
      },
    },
    rules: {
      'marketscope/no-extension-automation': ['error', { banNetwork: true }],
      'marketscope/no-generated-facebook-class': 'error',
    },
  },
  {
    files: [
      'apps/extension/src/service-worker.{js,ts}',
      'apps/extension/src/service-worker/**/*.{js,ts}',
      'apps/extension/src/background/**/*.{js,ts}',
    ],
    rules: {
      'marketscope/no-extension-automation': ['error', { banNetwork: false }],
    },
  },
  {
    files: ['tools/marketscope-fixtures/collectcards.js'],
    rules: {
      // The collection labeler intentionally detects non-ASCII text.
      'no-control-regex': 'off',
    },
  },
);
