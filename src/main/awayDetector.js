// Away detector: notices when the user has left the laptop and when they come back.
//
// Present = keyboard/mouse activity, or (with Presage) a face looking at the camera.
// Away = neither for config.selfReport.awayMinutes (a locked screen also gives no activity).
// Short gaps, like grabbing something under the desk, are ignored.

const { getConfig } = require('../config');

let lastActive = Date.now();
let away = false;

// Does this reading show the user is at the laptop?
function isActive(reading) {
  if (reading.source === 'input') {
    return reading.keys > 0 || reading.clicks > 0 || reading.scrolls > 0 || reading.mouseMoved;
  }
  if (reading.source === 'face') {
    return reading.status === 0 && reading.gazeH !== null; // camera check OK and eyes seen
  }
  return null; // other readings say nothing about presence
}

// Call with every reading. Returns the number of seconds the user was away at the moment
// they come back, otherwise null.
function updateAway(reading) {
  const active = isActive(reading);
  if (active === null) return null;

  if (!active) {
    if (reading.t - lastActive >= getConfig().selfReport.awayMinutes * 60 * 1000) away = true;
    return null;
  }

  const awaySeconds = Math.round((reading.t - lastActive) / 1000);
  const cameBack = away;
  away = false;
  lastActive = reading.t;
  return cameBack ? awaySeconds : null;
}

// Start fresh (call when a new session starts), so time between sessions doesn't count as away.
function resetAway() {
  lastActive = Date.now();
  away = false;
}

module.exports = { updateAway, resetAway };
