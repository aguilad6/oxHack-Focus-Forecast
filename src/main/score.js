// Focus score: one number from 0 (not focused) to 100 (deep focus), worked out from the readings.
//
// Rough idea: on-task app + keyboard/mouse activity = high, distraction app = low,
// no activity for a while = low. With the webcam: eyes off the screen or talking pull it down.
// Then smoothed so it drifts instead of jumping.

const SCORE = {
  onTask: 85,          // target score when a work app is in front
  neutral: 60,         // ...a neutral app (e.g. Outlook) or this dashboard
  distraction: 25,     // ...a distraction (YouTube, Discord, ...)
  idleSeconds: 90,     // no keyboard/mouse for this long = disengaged
  idleScore: 35,       // highest score while disengaged
  lookingAwayScore: 40, // highest score while the camera sees a face but not the eyes
  talkingPenalty: 10,  // taken off while talking
  faceStaleSeconds: 5, // ignore face readings older than this (camera off or stopped)
  smoothing: 1 / 30,   // each second, move 1/30 of the way to the target (~1 min to settle)
};

let lastWindow, lastFace, lastActive, smoothed;

// Start fresh. Call when a new session starts.
function resetFocusScore() {
  lastWindow = null;
  lastFace = null;
  lastActive = Date.now();
  smoothed = null;
}
resetFocusScore();

// Feed every reading in. Returns { t, source: 'focus', focus } once per second (on input readings),
// otherwise null. focus is null when there's nothing to judge yet (no window seen).
function updateFocusScore(reading) {
  if (reading.source === 'window') lastWindow = reading;
  if (reading.source === 'face') lastFace = reading;
  if (reading.source !== 'input') return null;

  const t = reading.t;
  if (reading.keys || reading.clicks || reading.scrolls || reading.mouseMoved) lastActive = t;

  const category = lastWindow ? lastWindow.category : 'unknown';
  if (category === 'unknown') return { t, source: 'focus', focus: null };

  let target = category === 'on-task' ? SCORE.onTask
    : category === 'distraction' ? SCORE.distraction
      : SCORE.neutral;
  if (t - lastActive >= SCORE.idleSeconds * 1000) target = Math.min(target, SCORE.idleScore);

  // Webcam, only if it's running and its camera check is OK.
  const face = lastFace && t - lastFace.t < SCORE.faceStaleSeconds * 1000 && lastFace.status === 0
    ? lastFace : null;
  if (face) {
    if (face.gazeH === null) target = Math.min(target, SCORE.lookingAwayScore);
    if (face.talking) target -= SCORE.talkingPenalty;
  }

  // Exponential smoothing: new = old + k * (target - old). Small k = slow, smooth changes.
  smoothed = smoothed === null ? target : smoothed + SCORE.smoothing * (target - smoothed);
  return { t, source: 'focus', focus: Math.round(smoothed) };
}

module.exports = { resetFocusScore, updateFocusScore };
