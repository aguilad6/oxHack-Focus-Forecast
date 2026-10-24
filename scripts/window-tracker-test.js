// Quick test for the window tracker: prints one reading per second.
// Run:  node scripts/window-tracker-test.js   then switch between apps. Ctrl+C to stop.

const { readActiveWindow } = require('../src/main/windowTracker');

setInterval(async () => {
  const r = await readActiveWindow();
  console.log(`${r.switched ? 'SWITCH ' : '       '}${r.category.padEnd(11)} ${r.app}`);
}, 1000);
