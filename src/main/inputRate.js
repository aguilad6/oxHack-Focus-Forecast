// Input rate: how many key presses, clicks and scrolls happened since the last reading,
// and whether the mouse moved. Tells us active vs idle.
//
// Uses the uiohook-napi package, which sees keyboard/mouse events anywhere on the computer.
// Privacy: we only count events. Which key was pressed is never looked at or saved.

const { uIOhook } = require('uiohook-napi');

let counts = { keys: 0, clicks: 0, scrolls: 0, mouseMoved: false };

// Start listening. Call once when the app starts.
function startInputRate() {
  uIOhook.on('keydown', () => { counts.keys += 1; });
  uIOhook.on('mousedown', () => { counts.clicks += 1; });
  uIOhook.on('wheel', () => { counts.scrolls += 1; });
  uIOhook.on('mousemove', () => { counts.mouseMoved = true; });
  uIOhook.start();
}

// Stop listening. Call when the app quits.
function stopInputRate() {
  uIOhook.stop();
}

// Returns the counts since the last call, then resets them to zero,
// e.g. { t, source: 'input', keys: 3, clicks: 0, scrolls: 0, mouseMoved: true }
function readInputRate() {
  const reading = { t: Date.now(), source: 'input', ...counts };
  counts = { keys: 0, clicks: 0, scrolls: 0, mouseMoved: false };
  return reading;
}

module.exports = { startInputRate, stopInputRate, readInputRate };
