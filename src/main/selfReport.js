// Self-report pop-up: a small window in the bottom-right corner asking a 1-5 question.
// It stays on top of other apps but appears without stealing keyboard focus,
// so it never interrupts typing. Closes by itself after config.selfReport.popupTimeoutSec.

const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { getConfig } = require('../config');

let popup = null;   // the open pop-up (only one at a time)
let onDone = null;  // called with the rating 1-5, or null if ignored/closed
let timeout = null;

// Close the pop-up and report the answer (null = no answer).
function finish(rating) {
  if (!popup) return;
  const done = onDone;
  const closing = popup;
  popup = null; // set first: destroy() fires 'closed', which calls finish() again
  onDone = null;
  clearTimeout(timeout);
  closing.destroy();
  done(rating);
}

// The pop-up page sends the clicked number here.
ipcMain.on('self-report-answer', (event, rating) => {
  if (popup && event.sender === popup.webContents) finish(rating);
});

// Show the question. callback(rating) gets 1-5, or null if the user ignores or closes it.
function askSelfReport(question, callback) {
  if (popup) finish(null); // replace any older question

  const width = 360;
  const height = 160;
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
    frame: false,             // no white Windows title bar; the page draws its own (with a × button)
    transparent: true,        // lets the page's rounded corners show
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  popup.loadFile(path.join(__dirname, '..', 'renderer', 'selfReport.html'), { query: { q: question } });
  popup.once('ready-to-show', () => popup.showInactive()); // show without taking focus
  popup.on('closed', () => finish(null)); // user clicked the X

  onDone = callback;
  timeout = setTimeout(() => finish(null), getConfig().selfReport.popupTimeoutSec * 1000);
}

module.exports = { askSelfReport };
