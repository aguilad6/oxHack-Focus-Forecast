// Preload script: runs before the web page loads and decides exactly what the
// page is allowed to see. Everything exposed here appears as `window.focusApi`.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('focusApi', {
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
  },
  // Lets the page react to each reading main.js sends, e.g. { source: 'window', app: 'Code', ... }
  onReading: (callback) => ipcRenderer.on('reading', (_event, reading) => callback(reading)),
  // Debugging: the mean and standard deviation alert.js compares focus against, { n, mean, sd } or null.
  onFocusBaseline: (callback) => ipcRenderer.on('focus-baseline', (_event, baseline) => callback(baseline)),
  // Used by the self-report pop-up to send the clicked 1-5 rating to main.js.
  answerSelfReport: (rating) => ipcRenderer.send('self-report-answer', rating),
  // Used by the refocus pop-up's "Got it" / × buttons.
  closeFocusPopup: () => ipcRenderer.send('focus-popup-close'),
  // Session buttons, and messages when a session starts/ends.
  endSession: () => ipcRenderer.send('end-session'),
  startSession: () => ipcRenderer.send('start-session'),
  onSessionStarted: (callback) => ipcRenderer.on('session-started', (_event, info) => callback(info)),
  onSessionEnded: (callback) => ipcRenderer.on('session-ended', (_event, info) => callback(info)),
  // Screen calibration: status for the banner/Settings, start (returns { ok, message }), cancel (Esc).
  calibration: {
    status: () => ipcRenderer.invoke('calibration-status'),
    start: () => ipcRenderer.invoke('calibration-start'),
    cancel: () => ipcRenderer.send('calibration-cancel'),
    onStatus: (callback) => ipcRenderer.on('calibration-status', (_event, status) => callback(status)),
  },
  // Voice: play ElevenLabs clips / built-in voice, and the Settings section (status, Test voice).
  voice: {
    status: () => ipcRenderer.invoke('voice-status'),
    test: () => ipcRenderer.invoke('voice-test'),
    onPlay: (callback) => ipcRenderer.on('voice-play', (_event, clip) => callback(clip)),
    onFallback: (callback) => ipcRenderer.on('voice-fallback', (_event, text) => callback(text)),
  },
  // Settings panel: each returns the full, updated settings.
  settings: {
    get: () => ipcRenderer.invoke('settings-get'),
    update: (changes) => ipcRenderer.invoke('settings-update', changes),
    reset: () => ipcRenderer.invoke('settings-reset'),
    // Moves the learnt data to a backup folder; returns { folder, moved }.
    resetData: () => ipcRenderer.invoke('data-reset'),
  },
});
