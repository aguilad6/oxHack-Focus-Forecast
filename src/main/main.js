// Electron main process: the "backend" of the app.
// It runs in Node.js, opens the window, runs sessions, and collects data from
// Presage, the window tracker and the input monitor (things a web page is not allowed to do).

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { readActiveWindow } = require('./windowTracker');
const { startInputRate, stopInputRate, readInputRate } = require('./inputRate');
const { startRecording, record, stopRecording } = require('./recorder');
const { updateAway, resetAway } = require('./awayDetector');
const { askSelfReport } = require('./selfReport');
const { startPresageFace, stopPresageFace, readPresageFace } = require('./presageFace');
require('./settings'); // lets the settings panel read and change the user's settings file
const { initCalibration, feedCalibration, lookingAt, notifyCalibration } = require('./calibration');
const { resetFocusScore, updateFocusScore } = require('./score');
const { startInterventions, stopInterventions, feedFocus, getBaseline } = require('./intervention');

// Load .env (PRESAGE_API_KEY, USE_PRESAGE) if this laptop has one.
try {
  process.loadEnvFile(path.join(__dirname, '..', '..', '.env'));
} catch {
  // no .env: run without Presage
}

// How often the app collects data (milliseconds).
const TICK_MS = 1000;

// Presage uses trial minutes, so it only runs on laptops that set USE_PRESAGE=1 in .env.
let win = null;
let sessionActive = false;  // recording right now?
let endingSession = false;  // end-of-session question showing?
let presageRunning = false;

// ---- Presage (webcam) ----
// Uses trial minutes, so it only runs on laptops with USE_PRESAGE=1 in .env, and only during a session.

function startPresage() {
  if (process.env.USE_PRESAGE !== '1') return;
  try {
    startPresageFace();
    presageRunning = true;
    console.log('Presage started');
    notifyCalibration(); // webcam on: the dashboard can offer screen calibration
  } catch (err) {
    // e.g. no API key, or the Windows TPM key error: carry on without the camera.
    console.error('Presage failed to start, running without it:', err.message);
  }
}

// Stopping takes a moment: wait for it, but max 3 s so a stuck SDK can't block anything.
async function stopPresage() {
  if (!presageRunning) return;
  presageRunning = false;
  notifyCalibration();
  const giveUp = new Promise((resolve) => setTimeout(resolve, 3000));
  try {
    await Promise.race([stopPresageFace(), giveUp]);
  } catch (err) {
    console.error('Error stopping Presage:', err.message);
  }
}

// ---- Readings ----

// Every reading is saved to the session file and sent to the window.
function handleReading(reading) {
  record(reading);
  win.webContents.send('reading', reading);

  // Back after being away: save how long, and ask how focused they were before leaving.
  const awaySeconds = updateAway(reading);
  if (awaySeconds !== null) {
    handleReading({ t: Date.now(), source: 'away', seconds: awaySeconds });
    askSelfReport('Welcome back! How focused were you before you left?', (rating) => {
      if (rating) handleReading({ t: Date.now(), source: 'selfReport', trigger: 'returnFromAway', rating });
    });
  }
}

// ---- Sessions ----

function startSession() {
  console.log('Recording to', startRecording());
  resetAway();
  resetFocusScore();
  startInterventions();
  startPresage();
  sessionActive = true;
  win.webContents.send('session-started', { t: Date.now() });
}

// Ask the end-of-session question, then stop recording. afterwards() runs once it's all done.
function endSession(afterwards) {
  if (!sessionActive || endingSession) return;
  endingSession = true;
  askSelfReport('Session over. Overall, how focused were you this session?', async (rating) => {
    if (rating) handleReading({ t: Date.now(), source: 'selfReport', trigger: 'endOfSession', rating });
    sessionActive = false;
    endingSession = false;
    stopInterventions();
    stopRecording();
    await stopPresage();
    if (!win.isDestroyed()) win.webContents.send('session-ended', { rating });
    if (afterwards) afterwards();
  });
}

// Buttons in the window.
ipcMain.on('end-session', () => endSession());
ipcMain.on('start-session', () => {
  if (!sessionActive) startSession();
});

// ---- Window ----

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 750,
    backgroundColor: '#f6f3ec', // matches the paper UI, so there's no white flash on start
    webPreferences: {
      // preload.js is the only bridge between this process and the web page.
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, // the page cannot touch Node.js directly
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.once('did-finish-load', startSession); // first session starts when the app opens

  // Closing the window during a session: ask the end-of-session question first, then close.
  // Between sessions: just close.
  win.on('close', (event) => {
    if (!sessionActive && !endingSession) return;
    event.preventDefault();
    endSession(() => win.destroy());
  });

  // The every-second loop. Sensors are always read (so counts don't pile up between sessions),
  // but readings are only used during a session.
  const timer = setInterval(async () => {
    let windowReading = null;
    try {
      windowReading = await readActiveWindow();
    } catch (err) {
      console.error('Window tracker failed:', err.message);
    }
    const inputReading = readInputRate();
    const faceReading = presageRunning ? readPresageFace() : null;
    if (faceReading) {
      faceReading.lookingAt = lookingAt(faceReading); // screen number, 'away', or null (not calibrated)
      feedCalibration(faceReading);
    }

    if (!sessionActive || win.isDestroyed()) return;
    // Window and face go in before input: the focus score comes out on the input reading.
    for (const reading of [windowReading, faceReading, inputReading]) {
      if (!reading) continue;
      handleReading(reading);
      const focus = updateFocusScore(reading);
      if (focus) {
        handleReading(focus);
        feedFocus(focus); // may show a "refocus" pop-up
        win.webContents.send('focus-baseline', getBaseline()); // debugging: drawn on the focus chart
      }
    }
  }, TICK_MS);

  win.on('closed', () => clearInterval(timer));
}

// Electron is ready once its internals have started.
app.whenReady().then(() => {
  startInputRate();
  initCalibration({
    presageRunning: () => presageRunning,
    onStatusChange: (status) => {
      if (win && !win.isDestroyed()) win.webContents.send('calibration-status', status);
    },
  });
  createWindow();
});

// Before quitting: stop the keyboard/mouse listener (so it doesn't keep the app alive),
// close the session file, and stop the webcam.
app.on('will-quit', (event) => {
  stopInputRate();
  stopRecording();
  if (presageRunning) {
    event.preventDefault();
    stopPresage().finally(() => app.exit(0));
  }
});

// On Windows/Linux, closing the last window quits the app.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
