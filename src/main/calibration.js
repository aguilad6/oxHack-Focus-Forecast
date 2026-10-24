// Screen calibration: learns where the user's head and eyes point when looking at each screen,
// so every face reading can be labelled lookingAt: 0, 1, ... (screen number, left to right) or 'away'.
//
// Calibrate once: the result is saved in the user's settings file together with a fingerprint
// of the screen setup, so it's only needed again when screens are added, removed or moved.
// Needs the webcam (Presage), so it only works during a session with USE_PRESAGE=1.

const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const { getConfig, updateConfig } = require('../config');

const SETTLE_MS = 1000; // time to move your eyes to the dot before measuring starts

let isPresageRunning = () => false;
let notify = () => {};  // tells the dashboard the status changed
let running = false;
let cancelled = false;
let samples = null;     // face readings collected while measuring one screen
let overlay = null;     // the full-screen "look at the dot" window
let lastLook = null;    // previous label, for smoothing

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Connected screens, left to right (then top to bottom).
function screensNow() {
  return screen.getAllDisplays().sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
}

// A short text describing the setup, e.g. "0,0,1920x1080|1920,0,2560x1440". Changes if screens change.
function fingerprint(displays) {
  return displays.map((d) => `${d.bounds.x},${d.bounds.y},${d.bounds.width}x${d.bounds.height}`).join('|');
}

// What the dashboard needs to show the banner and the Settings "Screens" section.
function calibrationStatus() {
  const saved = getConfig().calibration;
  return {
    webcam: isPresageRunning(),
    running,
    screensNow: screensNow().length,
    calibrated: Boolean(saved),
    setupChanged: Boolean(saved) && saved.setup !== fingerprint(screensNow()),
    savedScreens: saved ? saved.screens.length : 0,
    savedAt: saved ? saved.createdAt : null,
  };
}

// Called by main.js with every face reading; collects them while a screen is being measured.
function feedCalibration(reading) {
  if (samples && reading.headYaw !== null) samples.push(reading);
}

const average = (list, key) => list.reduce((sum, r) => sum + r[key], 0) / list.length;

// Show the dot on one screen, let the eyes settle, then average the face readings for lookSeconds.
async function measureScreen(display, index, total) {
  overlay = new BrowserWindow({
    ...display.bounds,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    backgroundColor: '#0e131f',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlay.loadFile(path.join(__dirname, '..', 'renderer', 'calibrate.html'),
    { query: { screen: String(index + 1), total: String(total), seconds: String(getConfig().screens.lookSeconds) } });

  await sleep(SETTLE_MS);
  samples = [];
  await sleep(getConfig().screens.lookSeconds * 1000);
  const collected = samples;
  samples = null;
  if (overlay && !overlay.isDestroyed()) overlay.destroy();
  overlay = null;

  if (cancelled) throw new Error('Calibration cancelled.');
  if (collected.length < 2) throw new Error("Couldn't see your face clearly. Check the light and try again.");
  return {
    screen: index,
    headYaw: average(collected, 'headYaw'),
    headPitch: average(collected, 'headPitch'),
    gazeH: average(collected, 'gazeH'),
    gazeV: average(collected, 'gazeV'),
  };
}

// Measure every screen in turn, then save. Returns { ok: true } or { ok: false, message }.
async function runCalibration() {
  if (running) return { ok: false, message: 'Already calibrating.' };
  if (!isPresageRunning()) return { ok: false, message: 'Needs the webcam: set USE_PRESAGE=1 in .env and start a session.' };

  running = true;
  cancelled = false;
  notify();
  try {
    const displays = screensNow();
    const points = [];
    for (let i = 0; i < displays.length; i++) points.push(await measureScreen(displays[i], i, displays.length));
    updateConfig({ calibration: { setup: fingerprint(displays), createdAt: Date.now(), screens: points } });
    lastLook = null;
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  } finally {
    running = false;
    notify();
  }
}

// Label a face reading: the nearest calibrated screen, or 'away' if none is close enough.
// null = can't tell (no calibration, setup changed, or no face seen).
function lookingAt(reading) {
  const saved = getConfig().calibration;
  if (!saved || reading.headYaw === null || saved.setup !== fingerprint(screensNow())) return null;

  // Distance = how far head (and, less strongly, eyes) point from each screen's reference point.
  const { awayDistance, gazeWeight } = getConfig().screens;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const s of saved.screens) {
    const distance = Math.hypot(
      reading.headYaw - s.headYaw,
      reading.headPitch - s.headPitch,
      gazeWeight * (reading.gazeH - s.gazeH),
      gazeWeight * (reading.gazeV - s.gazeV),
    );
    if (distance < nearestDistance) {
      nearest = s.screen;
      nearestDistance = distance;
    }
  }
  const now = nearestDistance <= awayDistance ? nearest : 'away';

  // Smoothing: 'away' only after two readings in a row, so a quick glance down isn't counted.
  const label = now === 'away' && lastLook !== null && lastLook !== 'away' ? lastLook : now;
  lastLook = now;
  return label;
}

// Call once after the app is ready. onStatusChange(status) is called whenever the status may have changed.
function initCalibration({ presageRunning, onStatusChange }) {
  isPresageRunning = presageRunning;
  notify = () => onStatusChange(calibrationStatus());
  screen.on('display-added', notify);
  screen.on('display-removed', notify);
  screen.on('display-metrics-changed', notify);
}

ipcMain.handle('calibration-status', () => calibrationStatus());
ipcMain.handle('calibration-start', () => runCalibration());
ipcMain.on('calibration-cancel', () => {
  cancelled = true;
});

module.exports = { initCalibration, feedCalibration, lookingAt, calibrationStatus, notifyCalibration: () => notify() };
