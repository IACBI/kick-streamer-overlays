#!/usr/bin/env node
// Automated checks for the Kick overlay pack. Plain Node, no npm.
//
//   Run from the project root:   node tests/run.js
//
// Prints one line per check plus a summary. Exit code 1 when any check FAILs.
// PENDING means a page is missing or still has old markup; it does not fail the run.
// The core is loaded into a vm context, so these tests run the real shared/kick-core.js.
'use strict';
// The checks live in tests/unit/, one file per area; this file runs them in order.

const { counts } = require('./unit/harness.js');
const { testLangFiles } = require('./unit/lang.test.js');
const { testCoreApi, testNormalize, testReadSettings, testHelpers } = require('./unit/core.test.js');
const { testParsers, testKickRest, testOfficial, testSubscriberSource, testMockServer } = require('./unit/kick.test.js');
const { testSettingsV23, testHelpersV23, testCreateGoalBar, testPoller } = require('./unit/core-v23.test.js');
const { testChatFeed, testRelayInfoAndChannel, testSubscriberRelayAndBaseline, testConnectRelayReconnect } = require('./unit/relay-client.test.js');
const { testThemesAndPages, testSyntax, testVersionSync } = require('./unit/pages.test.js');

(async function main() {
  await testLangFiles();
  await testCoreApi();
  await testNormalize();
  await testReadSettings();
  await testHelpers();
  await testParsers();
  await testKickRest();
  await testOfficial();
  await testSubscriberSource();
  await testChatFeed();
  await testMockServer();
  await testSettingsV23();
  await testHelpersV23();
  await testCreateGoalBar();
  await testPoller();
  await testRelayInfoAndChannel();
  await testSubscriberRelayAndBaseline();
  await testConnectRelayReconnect();
  await testThemesAndPages();
  await testSyntax();
  await testVersionSync();

  const total = counts.PASS + counts.FAIL + counts.PENDING;
  console.log('\nSummary: ' + counts.PASS + ' passed, ' + counts.FAIL + ' failed, ' +
    counts.PENDING + ' pending (' + total + ' checks)');
  process.exitCode = counts.FAIL > 0 ? 1 : 0;
})().catch((err) => {
  console.error('Runner error: ' + ((err && err.message) || err));
  process.exitCode = 1;
});
