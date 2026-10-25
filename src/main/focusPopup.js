// Refocus pop-up: a small window in the bottom-right corner with a chime, telling the user
// their focus has dropped and suggesting something to do about it.
// Like the self-report pop-up it stays on top but doesn't steal keyboard focus.
// Closes by itself after config.selfReport.popupTimeoutSec.

const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { getConfig } = require('../config');

let popup = null;
let timeout = null;

function closeFocusPopup() {
  if (!popup) return;
  const closing = popup;
  popup = null;
  clearTimeout(timeout);
  closing.destroy();
}

// The pop-up's "Got it" or × button.
ipcMain.on('focus-popup-close', (event) => {
  if (popup && event.sender === popup.webContents) closeFocusPopup();
});

// Show the pop-up with a suggestion, e.g. showFocusPopup('Take a 5 minute break.')
function showFocusPopup(suggestion) {
  closeFocusPopup(); // only one at a time

  const width = 360;
  const height = 150;
  const area = screen.getPrimaryDisplay().workArea; // screen minus the taskbar
  popup = new BrowserWindow({
    width,
    height,
    x: area.x + area.width - width - 16,
    y: area.y + area.height - height - 16,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Focus Forecast',
    frame: false,
    transparent: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required', // the chime plays without a click first
    },
  });
  popup.loadFile(path.join(__dirname, '..', 'renderer', 'focusPopup.html'), { query: { s: suggestion } });
  popup.once('ready-to-show', () => popup.showInactive()); // show without taking focus
  popup.on('closed', () => { popup = null; clearTimeout(timeout); });

  timeout = setTimeout(closeFocusPopup, getConfig().selfReport.popupTimeoutSec * 1000);
}

module.exports = { showFocusPopup, closeFocusPopup };
