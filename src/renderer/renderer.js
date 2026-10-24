// Renderer: the UI code running inside the window (like a normal web page).
// It only sees what preload.js exposed on window.focusApi.

const v = window.focusApi.versions;
document.getElementById('versions').textContent =
  `Electron ${v.electron} · Node ${v.node}`;
