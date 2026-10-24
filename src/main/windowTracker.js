// Window tracker: which app is in front right now, is it work or a distraction,
// and did the user just switch?
//
// Uses the get-windows package, which asks the operating system for the focused window
// (the one receiving your typing). With several monitors only one window has focus at a time.
//
// Privacy: the window title is used only to pick a category, and is never returned or saved.

const { getConfig } = require('../config');

let getWindows = null; // loaded on first use (get-windows is an ES module, so we use import())
let lastKey = null;    // app + category from the previous reading, to detect switches

// Decide 'distraction', 'on-task' or 'neutral' from the app name and window title.
function categorise(appName, title) {
  const text = `${appName} ${title}`.toLowerCase();
  const { categories } = getConfig();
  if (categories.distraction.some((word) => text.includes(word))) return 'distraction';
  if (categories.onTask.some((word) => text.includes(word))) return 'on-task';
  return 'neutral';
}

// Returns one reading, e.g. { t, source: 'window', app: 'Code', category: 'on-task', switched: false }
async function readActiveWindow() {
  if (!getWindows) getWindows = await import('get-windows');
  const win = await getWindows.activeWindow();
  const t = Date.now();

  // No focused window (e.g. desktop shown, or the screen is locked).
  if (!win) return { t, source: 'window', app: null, category: 'unknown', switched: false };

  const app = win.owner.name;
  const category = categorise(app, win.title || '');

  // A switch = different app, or same browser but moved between work and distraction tabs.
  const key = `${app}|${category}`;
  const switched = lastKey !== null && key !== lastKey;
  lastKey = key;

  return { t, source: 'window', app, category, switched };
}

module.exports = { readActiveWindow, categorise };
