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
  // Used by the self-report pop-up to send the clicked 1-5 rating to main.js.
  answerSelfReport: (rating) => ipcRenderer.send('self-report-answer', rating),
  // Session buttons, and messages when a session starts/ends.
  endSession: () => ipcRenderer.send('end-session'),
  startSession: () => ipcRenderer.send('start-session'),
  onSessionStarted: (callback) => ipcRenderer.on('session-started', (_event, info) => callback(info)),
  onSessionEnded: (callback) => ipcRenderer.on('session-ended', (_event, info) => callback(info)),
});
