// All the numbers and lists we might want to tweak, in one place.
//
// Defaults live in presets.json (next to this file). The user's own settings live in
// ~/.config/focus-forecast/config.json, which is created from the defaults on first run.
// Anything missing from the user's file falls back to the default, so it can hold just a few settings.
// The file is re-read whenever it changes, so edits (by hand or from the app) apply without a restart.
//
// Settings:
//   selfReport.awayMinutes       no keyboard/mouse for this long = user has left (ask when they're back)
//   selfReport.popupTimeoutSec   pop-up closes by itself if ignored; nothing is saved
//   categories.distraction/onTask  words matched (lowercase) against the app name and window title,
//                                e.g. "LinkedIn - Google Chrome". Distraction is checked first, so a
//                                YouTube tab in Chrome counts as distraction. Matching neither = 'neutral'.
//   alerts.holdStartSeconds      focus must stay low this long before the first "refocus" pop-up
//   alerts.holdStepUpSeconds     ...and this much longer after every pop-up (so it doesn't nag)
//   alerts.holdMaxSeconds        ...up to this
//   alerts.calmMinutes           every this many minutes without low focus, the wait shrinks again
//   alerts.holdStepDownSeconds   ...by this much, back down to holdStartSeconds
//   alerts.epsilon               chance (0-1) of trying a random suggestion instead of the best one so far
//   Interactions                 suggestions the "refocus" pop-up can show

const fs = require('fs');
const os = require('os');
const path = require('path');
const presets = require('./presets.json');

const configDir = path.join(os.homedir(), '.config', 'focus-forecast');
const configPath = path.join(configDir, 'config.json');

let cached = null;     // the merged config from the last read
let cachedMtime = null; // when the user's file was last changed, to spot edits

// Copy `overrides` on top of `defaults`. Objects are merged key by key; anything else
// (numbers, strings, lists) is replaced, so a user's distraction list replaces the default list.
function merge(defaults, overrides) {
  const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  if (!isObject(defaults) || !isObject(overrides)) return overrides === undefined ? defaults : overrides;
  const result = { ...defaults };
  for (const [key, value] of Object.entries(overrides)) result[key] = merge(defaults[key], value);
  return result;
}

// The user's file as written (only their own settings), or null if it can't be read.
function readUserFile() {
  try {
    const user = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    // Older files spelled the suggestions list "Iterations": rename it once.
    if (user && 'Iterations' in user) {
      user.Interactions ??= user.Iterations;
      delete user.Iterations;
      writeUserFile(user);
    }
    return user;
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Can't read ${configPath}, keeping previous settings:`, err.message);
    return null;
  }
}

function writeUserFile(settings) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(settings, null, 2));
}

// Returns the current settings. Cheap to call often: it only re-reads the file when it has changed.
function getConfig() {
  if (!fs.existsSync(configPath)) writeUserFile(presets);

  const mtime = fs.statSync(configPath).mtimeMs;
  if (cached && mtime === cachedMtime) return cached;

  const user = readUserFile();
  // A broken file (e.g. half-typed JSON) keeps the last good settings instead of resetting them.
  if (user !== null || !cached) cached = merge(presets, user ?? {});
  cachedMtime = mtime;
  return cached;
}

// Change some settings and save them to the user's file, e.g. updateConfig({ selfReport: { awayMinutes: 10 } })
function updateConfig(changes) {
  writeUserFile(merge(readUserFile() ?? {}, changes));
  cachedMtime = null; // force a re-read
  return getConfig();
}

module.exports = { getConfig, updateConfig, configPath };
