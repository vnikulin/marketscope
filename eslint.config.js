import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const zeroRequestMessage =
  'MarketScope generates zero Facebook requests. This operation is forbidden in extension source.';

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
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='innerHTML']",
          message:
            'MarketScope renders listing-derived strings as text nodes. innerHTML is forbidden.',
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='insertAdjacentHTML']",
          message:
            'MarketScope renders listing-derived strings as text nodes. insertAdjacentHTML is forbidden.',
        },
      ],
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
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: zeroRequestMessage },
        { name: 'XMLHttpRequest', message: zeroRequestMessage },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'document', property: 'cookie', message: zeroRequestMessage },
        { object: 'chrome', property: 'cookies', message: zeroRequestMessage },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='innerHTML']",
          message:
            'MarketScope renders listing-derived strings as text nodes. innerHTML is forbidden.',
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='insertAdjacentHTML']",
          message:
            'MarketScope renders listing-derived strings as text nodes. insertAdjacentHTML is forbidden.',
        },
        {
          selector:
            "CallExpression[callee.object.name='window'][callee.property.name='scrollTo']",
          message: zeroRequestMessage,
        },
        {
          selector: "CallExpression[callee.property.name='scrollIntoView']",
          message: zeroRequestMessage,
        },
        {
          selector: "CallExpression[callee.property.name='click']",
          message: zeroRequestMessage,
        },
        {
          selector: "CallExpression[callee.property.name='dispatchEvent']",
          message: zeroRequestMessage,
        },
        {
          selector:
            "CallExpression[callee.object.name='history'][callee.property.name='pushState']",
          message: zeroRequestMessage,
        },
        {
          selector:
            "CallExpression[callee.object.name='location'][callee.property.name='assign']",
          message: zeroRequestMessage,
        },
        {
          selector:
            "AssignmentExpression[left.object.name='location'][left.property.name='href']",
          message: zeroRequestMessage,
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(querySelector|querySelectorAll|matches|closest)$/] > Literal.arguments:first-child[value=/\\.[a-z0-9]{6,}/]",
          message:
            'Facebook generated class names are unstable. Use structural, ARIA, href, alt, or visible-text selectors.',
        },
      ],
    },
  },
);
