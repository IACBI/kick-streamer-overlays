#!/usr/bin/env node
'use strict';
// Prints the CHANGELOG.md section of one version, for the GitHub release notes:
//   node tools/changelog-notes.js 2.4.0 > notes.md
// Exits 1 when the version has no section or the section is empty, so a release cannot go out
// without notes.

const fs = require('fs');
const path = require('path');

/**
 * @param {string} changelog full CHANGELOG.md text
 * @param {string} version for example "2.4.0" (a leading "v" is ignored)
 * @returns {string|null} the section body without its heading, or null when missing or empty
 */
function notesFor(changelog, version) {
  const v = String(version).replace(/^v/, '');
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## [${v}]`));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^## \[/.test(l));
  if (end < 0) end = lines.length;
  // Link reference definitions at the end of the file are not part of the last section.
  const body = lines.slice(start + 1, end).filter((l) => !/^\[[^\]]+\]:\s/.test(l)).join('\n').trim();
  return body || null;
}

if (require.main === module) {
  const version = process.argv[2];
  if (!version) { console.error('Usage: node tools/changelog-notes.js <version>'); process.exit(2); }
  const notes = notesFor(fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8'), version);
  if (!notes) { console.error(`CHANGELOG.md has no notes for ${version}.`); process.exit(1); }
  process.stdout.write(notes + '\n');
}

module.exports = { notesFor };
