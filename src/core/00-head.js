/*!
 * Kick Overlay Pack — shared core.
 *
 * A classic script (not an ES module) so it works from file:// in OBS.
 * It does no DOM work at load time, so it also runs under Node for tests.
 * Exposes window.KickOverlay.
 *
 * Built from src/core/ by tools/build-core.js. Edit the parts there, not this file.
 */
(function (global) {
  'use strict';

