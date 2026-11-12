'use strict';
// Lints every tracked script: the Node relay, tests and tools as CommonJS, and the browser core as a classic script.
// The inline <script> blocks of the overlay pages are linted in place, through the small processor below. The studio
// script lives in shared/studio.js and is linted like the core.

const js = require('@eslint/js');
const globals = require('globals');

// Hands ESLint the inline scripts of a page. Everything outside them is blanked out character by character, so a
// finding keeps the line and column it has in the .html file. Scripts with a src are other files, linted as such.
const inlineScripts = {
  meta: { name: 'kick-inline-scripts', version: '1.0.0' },
  preprocess(text) {
    const blank = (part) => part.replace(/[^\r\n]/g, ' ');
    // The end tag is matched as a browser reads it: any case, and anything up to the ">" ("</script >").
    const tag = /(<script\b[^>]*>)([\s\S]*?)<\/script\b[^>]*>/gi;
    let out = '', last = 0, m;
    while ((m = tag.exec(text)) !== null) {
      if (/\ssrc\s*=/i.test(m[1])) continue;
      const start = m.index + m[1].length;
      const end = start + m[2].length;
      out += blank(text.slice(last, start)) + text.slice(start, end);
      last = end;
    }
    return [{ text: out + blank(text.slice(last)), filename: 'inline.js' }];
  },
  postprocess: (messages) => messages.flat(),
  supportsAutofix: false
};

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
  },
  { files: ['*.html'], processor: inlineScripts },
  {
    files: ['*.html/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } }
  }
];
