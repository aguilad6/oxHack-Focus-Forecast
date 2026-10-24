// Preload script: runs before the web page loads and decides exactly what the
// page is allowed to see. Everything exposed here appears as `window.focusApi`.
// Later we'll add live Presage readings, focus scores, etc.

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('focusApi', {
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
  },
});
