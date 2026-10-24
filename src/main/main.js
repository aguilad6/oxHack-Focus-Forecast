// Electron main process: the "backend" of the app.
// It runs in Node.js, opens the window, and will later talk to Presage,
// the window tracker and the input monitor (things a web page is not allowed to do).

const { app, BrowserWindow } = require('electron');
const path = require('path');
const config = require('../config');
const { readActiveWindow } = require('./windowTracker');
const { startInputRate, stopInputRate, readInputRate } = require('./inputRate');
const { startRecording, record, stopRecording } = require('./recorder');

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    webPreferences: {
      // preload.js is the only bridge between this process and the web page.
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, // the page cannot touch Node.js directly
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Every reading is saved to the session file and sent to the window.
  function handleReading(reading) {
    record(reading);
    win.webContents.send('reading', reading);
  }

  // The every-second loop: collect a reading from each sensor.
  // (presage.js will be added here the same way.)
  const timer = setInterval(async () => {
    try {
      handleReading(await readActiveWindow());
    } catch (err) {
      console.error('Window tracker failed:', err.message);
    }
    handleReading(readInputRate());
  }, config.tickMs);

  win.on('closed', () => clearInterval(timer));
}

// Electron is ready once its internals have started.
app.whenReady().then(() => {
  console.log('Recording to', startRecording());
  startInputRate();
  createWindow();
});

// Before quitting: stop the keyboard/mouse listener (so it doesn't keep the app alive)
// and close the session file.
app.on('will-quit', () => {
  stopInputRate();
  stopRecording();
});

// On Windows/Linux, closing the last window quits the app.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
