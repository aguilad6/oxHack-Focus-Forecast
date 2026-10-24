// Renderer: the UI code running inside the window (like a normal web page).
// It only sees what preload.js exposed on window.focusApi.

const v = window.focusApi.versions;
document.getElementById('versions').textContent =
  `Electron ${v.electron} · Node ${v.node}`;

// Keep the latest reading from each sensor ('window', later 'input' and 'presage') and show them all.
const latest = {};
window.focusApi.onReading((reading) => {
  latest[reading.source] = reading;
  document.getElementById('readings').textContent = JSON.stringify(latest, null, 2);
});
