'use strict';
// Entry point of the single-file relay executable (tools/build-relay.js):
//   kick-relay-win-x64.exe                     start the relay
//   kick-relay-win-x64.exe subscribe [--list]  create (or list) the Kick webhook subscriptions
const args = process.argv.slice(2);
if (args[0] === 'subscribe') require('./subscribe.js').cli(args.slice(1));
else require('./server.js').main();
