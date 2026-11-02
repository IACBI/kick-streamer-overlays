'use strict';
// Lints every tracked script: the Node relay, tests and tools as CommonJS, and the browser core as a classic script.
// Inline <script> blocks in the HTML pages are not linted; the Chrome end-to-end run covers them.

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'qa-out/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      // `catch (e) { /* reason */ }` is the house style for errors that are deliberately ignored.
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'off',
      'prefer-const': 'off'
    }
  },
  {
    files: ['shared/**/*.js', 'AYARLAR*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } }
  }
];
