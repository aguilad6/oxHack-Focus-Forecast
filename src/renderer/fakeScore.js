// TEMPORARY fake focus score, so the live view can be built before scoring.js exists.
// Delete this file (and its <script> tag in index.html) once main.js sends the real score.
//
// Rough idea: on-task app + activity = high, distraction app = low, no activity for a while = low.
// Then smoothed so it drifts instead of jumping.

const FAKE = {
  onTask: 85,          // target score when a work app is in front
  neutral: 60,         // ...a neutral app (e.g. Outlook) or this dashboard
  distraction: 25,     // ...a distraction (YouTube, Discord, ...)
  idleSeconds: 90,     // no keyboard/mouse for this long = disengaged
  idleScore: 35,       // target score when disengaged
  neutralGraceSec: 30, // a neutral app keeps the previous state this long, then becomes 'neutral'
  smoothing: 1 / 30,   // each second, move 1/30 of the way to the target (~1 min to settle)
};

let fakeLastWindow, fakeLastActive, fakeSmoothed, fakeState, fakeNeutralSince;

// Start fresh (call when a new session starts).
function resetFakeScore() {
  fakeLastWindow = null;
  fakeLastActive = Date.now();
  fakeSmoothed = null;
  fakeState = 'unknown';
  fakeNeutralSince = null;
}
resetFakeScore();

// Feed every reading in. Returns { t, focus, state } once per second (on input readings), else null.
function fakeScore(reading) {
  if (reading.source === 'window') {
    fakeLastWindow = reading;
    return null;
  }
  if (reading.source !== 'input') return null;

  const t = reading.t;
  if (reading.keys || reading.clicks || reading.scrolls || reading.mouseMoved) fakeLastActive = t;
  const engaged = t - fakeLastActive < FAKE.idleSeconds * 1000;

  const category = fakeLastWindow ? fakeLastWindow.category : 'unknown';
  if (category === 'unknown') return { t, focus: null, state: 'unknown' };

  let target = category === 'on-task' ? FAKE.onTask
    : category === 'distraction' ? FAKE.distraction
      : FAKE.neutral;
  if (!engaged) target = Math.min(target, FAKE.idleScore);

  // Exponential smoothing: new = old + k * (target - old). Small k = slow, smooth changes.
  fakeSmoothed = fakeSmoothed === null ? target : fakeSmoothed + FAKE.smoothing * (target - fakeSmoothed);

  // The four states from the brief: body engaged/disengaged x on-task/distraction app.
  // Plus: this dashboard = 'checkingIn' straight away (never counts as focus);
  // other neutral apps keep the previous state for a short grace period, then 'neutral'.
  fakeNeutralSince = category === 'neutral' ? (fakeNeutralSince ?? t) : null;
  if (category === 'on-task') fakeState = engaged ? 'flow' : 'zonedOut';
  else if (category === 'distraction') fakeState = engaged ? 'hooked' : 'break';
  else if (category === 'self') fakeState = 'checkingIn';
  else if (t - fakeNeutralSince >= FAKE.neutralGraceSec * 1000) fakeState = 'neutral';

  return { t, focus: Math.round(fakeSmoothed), state: fakeState };
}
