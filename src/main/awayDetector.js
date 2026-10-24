// Away detector: notices when the user has left the laptop and when they come back.
//
// Away = no keyboard/mouse activity for config.selfReport.awayMinutes (a locked screen also
// gives no activity). Short gaps, like grabbing something under the desk, are ignored.
// TODO (with presage.js): also treat "face visible" (status 0) as present, so reading
// without touching the mouse doesn't count as away.

const config = require('../config');

let lastActive = Date.now();
let away = false;

// Call with every reading. Returns the number of seconds the user was away at the moment
// they come back, otherwise null.
function updateAway(reading) {
  if (reading.source !== 'input') return null;

  const active = reading.keys > 0 || reading.clicks > 0 || reading.scrolls > 0 || reading.mouseMoved;
  if (!active) {
    if (reading.t - lastActive >= config.selfReport.awayMinutes * 60 * 1000) away = true;
    return null;
  }

  const awaySeconds = Math.round((reading.t - lastActive) / 1000);
  const cameBack = away;
  away = false;
  lastActive = reading.t;
  return cameBack ? awaySeconds : null;
}

module.exports = { updateAway };
