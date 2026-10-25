// Settings panel <-> the user's settings file (via config.js).
// The window asks for the current settings, sends changes, or resets everything to the defaults.

const { ipcMain } = require('electron');
const { getConfig, updateConfig } = require('../config');
const presets = require('../presets.json');
require('./voice'); // the Voice section in Settings (on/off, Test voice)

ipcMain.handle('settings-get', () => getConfig());

// changes = only the part that changed, e.g. { categories: { onTask: ['code', 'figma'] } }.
// Lists are replaced whole, so this is how items get added or deleted.
ipcMain.handle('settings-update', (_event, changes) => updateConfig(changes));

// Write every default back over the user's settings.
ipcMain.handle('settings-reset', () => updateConfig(presets));
