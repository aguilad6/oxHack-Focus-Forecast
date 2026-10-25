// Focus score: one number from 0 (not focused) to 100 (deep focus), worked out from the readings,
// plus the state shown on the dashboard (flow, hooked, zoned out, break, neutral).
//
// Each measure gives a part score from 0 to 100 (see PARTS). The focus score is their weighted average.
// Measures with no data right now (webcam off, vitals still warming up, no history yet) are left out
// and the other weights count for more, so a missing sensor never drags the score down.
// Then smoothed so it doesn't jump around.

const { baselineOf } = require('./alert');

// How much each measure counts. Fixed on purpose (not a user setting). Adds up to 100.
const WEIGHTS = {
  app: 30,          // work app, neutral, or distraction
  eyesOnScreen: 22, // webcam: looking at a screen or away
  activity: 15,     // keyboard/mouse: reading without touching anything slowly costs points
  eyesShut: 8,      // webcam: eyes closed for a while = drowsy
  heartRate: 7,     // webcam: well above your usual heart rate = stressed
  switching: 6,     // switching apps a lot = scattered attention
  talking: 5,       // webcam: talking most of the last minute
  breathing: 4,     // webcam: well above your usual breathing rate
  hrv: 3,           // webcam: HRV well below your usual = stressed
};

const SCORE = {
  // Part scores go from 100 at the first number to 0 at the second, in a straight line in between.
  idleSeconds: [15, 90],      // seconds since last keyboard/mouse use
  switchesPerMinute: [2, 6],  // app switches in the last minute
  talkingShare: [0.25, 0.5],  // share of the last minute spent talking
  eyesClosedMs: [500, 2000],  // how long the eyes have been shut (a blink is ~100-400 ms)
  heartAboveUsual: [10, 30],  // bpm above your usual heart rate
  breathingAboveUsual: [3, 8], // breaths per minute above your usual rate
  hrvOfUsual: [0.8, 0.5],     // HRV as a share of your usual (lower = more stressed)
  appScore: { 'on-task': 100, neutral: 50, distraction: 0, self: 0 }, // self = this dashboard

  vitalsMinSamples: 60,  // need this many past readings before "your usual" vitals count (~1 min)
  baselineRefreshSeconds: 30, // re-read your usual vitals this often
  faceStaleSeconds: 5,   // ignore face readings older than this (camera off or stopped)
  idleStateSeconds: 90,  // no keyboard/mouse for this long = disengaged (for the state, not the score)
  neutralGraceSec: 30,   // a neutral app keeps the previous state this long, then becomes 'neutral'
  smoothing: 1 / 5,      // each second, move 1/5 of the way to the target (~10 s to settle)
};

let lastWindow, lastFace, lastActive, smoothed, state, neutralSince;
let switchTimes, talkingHistory; // the last minute of app switches / talking yes-no
let usual = {};                  // your usual pulse, breathing, hrv: { n, mean, sd } (from alert.js)
let usualTime = null;            // when `usual` was last read

// Start fresh. Call when a new session starts.
function resetFocusScore() {
  lastWindow = null;
  lastFace = null;
  lastActive = Date.now();
  smoothed = null;
  state = 'unknown';
  neutralSince = null;
  switchTimes = [];
  talkingHistory = [];
  usualTime = null;
}
resetFocusScore();

// 100 when x is at `good`, 0 at `bad`, a straight line in between (works whichever way round they are).
function ramp(x, [good, bad]) {
  const f = (x - good) / (bad - good);
  return 100 * (1 - Math.min(1, Math.max(0, f)));
}

// Your usual value of a vital, or null if there isn't enough history yet.
function usualMean(name) {
  const baseline = usual[name];
  return baseline && baseline.n >= SCORE.vitalsMinSamples ? baseline.mean : null;
}

// Forget the cached usual vitals, e.g. after the learnt data was reset.
function refreshUsual() {
  usualTime = null;
}

// Part scores (0-100) for every measure that has data right now. Missing measures are left out.
function partScores(t, category) {
  const parts = {};
  parts.app = SCORE.appScore[category] ?? 50;
  parts.activity = ramp((t - lastActive) / 1000, SCORE.idleSeconds);
  parts.switching = ramp(switchTimes.length, SCORE.switchesPerMinute);

  // Webcam measures: only with a recent face reading whose camera check is OK.
  const face = lastFace && t - lastFace.t < SCORE.faceStaleSeconds * 1000 && lastFace.status === 0
    ? lastFace : null;
  if (!face) return parts;

  // Calibrated: lookingAt is a screen number or 'away'. Not calibrated: eyes seen = on the screen.
  if (typeof face.lookingAt === 'number') parts.eyesOnScreen = 100;
  else if (face.lookingAt === 'away') parts.eyesOnScreen = 0;
  else parts.eyesOnScreen = face.gazeH !== null ? 100 : 0;

  if (typeof face.eyesClosedMs === 'number') parts.eyesShut = ramp(face.eyesClosedMs, SCORE.eyesClosedMs);
  if (talkingHistory.length) {
    const share = talkingHistory.filter((h) => h.talking).length / talkingHistory.length;
    parts.talking = ramp(share, SCORE.talkingShare);
  }

  const pulseUsual = usualMean('pulse');
  if (typeof face.pulse === 'number' && pulseUsual !== null) {
    parts.heartRate = ramp(face.pulse - pulseUsual, SCORE.heartAboveUsual);
  }
  const breathingUsual = usualMean('breathing');
  if (typeof face.breathing === 'number' && breathingUsual !== null) {
    parts.breathing = ramp(face.breathing - breathingUsual, SCORE.breathingAboveUsual);
  }
  const hrvUsual = usualMean('hrv');
  if (typeof face.hrv === 'number' && hrvUsual) {
    parts.hrv = ramp(face.hrv / hrvUsual, SCORE.hrvOfUsual);
  }
  return parts;
}

// Weighted average of the part scores that are present.
function weightedScore(parts) {
  let total = 0;
  let weights = 0;
  for (const [name, value] of Object.entries(parts)) {
    total += WEIGHTS[name] * value;
    weights += WEIGHTS[name];
  }
  return total / weights;
}

// Feed every reading in. Returns { t, source: 'focus', focus, state, onDashboard, parts } once per
// second (on input readings), otherwise null. focus is null when there's nothing to judge yet (no
// window seen). parts = each measure's part score, for debugging and training.
function updateFocusScore(reading) {
  const t = reading.t;
  const minuteAgo = t - 60 * 1000;
  if (reading.source === 'window') {
    lastWindow = reading;
    if (reading.switched) switchTimes.push(t);
  }
  if (reading.source === 'face') {
    lastFace = reading;
    if (reading.status === 0) talkingHistory.push({ t, talking: reading.talking });
  }
  if (reading.source !== 'input') return null;

  // Keep only the last minute.
  while (switchTimes.length && switchTimes[0] < minuteAgo) switchTimes.shift();
  while (talkingHistory.length && talkingHistory[0].t < minuteAgo) talkingHistory.shift();

  if (usualTime === null || t - usualTime >= SCORE.baselineRefreshSeconds * 1000) {
    usual = Object.fromEntries(['pulse', 'breathing', 'hrv'].map((name) => [name, baselineOf(name, undefined, t)]));
    usualTime = t;
  }

  if (reading.keys || reading.clicks || reading.scrolls || reading.mouseMoved) lastActive = t;
  const engaged = t - lastActive < SCORE.idleStateSeconds * 1000;

  const category = lastWindow ? lastWindow.category : 'unknown';
  if (category === 'unknown') return { t, source: 'focus', focus: null, state: 'unknown', onDashboard: false };

  const parts = partScores(t, category);
  const target = weightedScore(parts);

  // Exponential smoothing: new = old + k * (target - old). Small k = slow, smooth changes.
  smoothed = smoothed === null ? target : smoothed + SCORE.smoothing * (target - smoothed);

  // The four states from the brief: body engaged/disengaged x on-task/distraction app.
  // Time on this dashboard ('self') counts as time away from work, like a distraction.
  // Other neutral apps keep the previous state for a short grace period, then 'neutral'.
  const offTask = category === 'distraction' || category === 'self';
  neutralSince = category === 'neutral' ? (neutralSince ?? t) : null;
  if (category === 'on-task') state = engaged ? 'flow' : 'zonedOut';
  else if (offTask) state = engaged ? 'hooked' : 'break';
  // (Only real states are kept, so a neutral app after 'unknown' is 'neutral' straight away.)
  else if (!['flow', 'hooked', 'zonedOut', 'break'].includes(state)
    || t - neutralSince >= SCORE.neutralGraceSec * 1000) state = 'neutral';

  for (const name of Object.keys(parts)) parts[name] = Math.round(parts[name]);
  return { t, source: 'focus', focus: Math.round(smoothed), state, onDashboard: category === 'self', parts };
}

module.exports = { WEIGHTS, resetFocusScore, updateFocusScore, refreshUsual };
