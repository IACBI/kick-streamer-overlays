'use strict';
// Lints every tracked script: the Node relay, tests and tools as CommonJS, and the browser core as a classic script.
// Inline <script> blocks in the overlay pages are not linted; the Chrome end-to-end run covers them. The studio
// script lives in shared/studio.js and is linted like the core.

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  // src/core/ holds fragments of one script (tools/build-core.js joins them); the joined shared/kick-core.js is linted.
  { ignores: ['node_modules/**', 'dist/**', 'qa-out/**', 'src/core/**'] },
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
