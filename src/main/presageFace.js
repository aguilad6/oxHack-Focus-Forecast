// Presage face: blinks, eyes shut, talking, where the eyes are pointing, facial expression,
// and the vitals (heart rate, HRV, breathing), from the webcam.
// Tells us if the user is looking at the screen, tired, stressed or chatting.
// (One Presage connection owns the camera, so all webcam data comes from this file.)
//
// Uses the @smartspectra/node-sdk package (Presage). Needs PRESAGE_API_KEY in the environment.
// Each run uses Presage trial minutes.
// Privacy: no video is saved. Only the numbers below leave this file.

const {
  SmartSpectraSDK, CameraSelection, decodeMetrics, faceMetrics, breathingMetrics, MetricType,
} = require('@smartspectra/node-sdk');

// Vitals are only reported once Presage's confidence is above this (it starts at 0 while warming up:
// ~12 s for pulse, ~30 s for breathing, ~60 s for HRV).
const MIN_CONFIDENCE = 0;

let sdk = null;
let lastBlink = false; // was the eye closed in the previous frame? (so one blink isn't counted twice)
let status = null;     // Presage's camera check: 0 = OK, 2 = several faces, 5 = too dark, ...
let expression = null; // latest most-likely expression, e.g. { name: 'neutral', confidence: 82 }
let vitals = { pulse: null, breathing: null, hrv: null }; // latest values (they change slowly)
let closedSince = null; // when the eyes closed (ms), null while open
let lastFrameTime = null; // time of the newest blink frame (ms)
let counts = { blinks: 0, talking: false, gazeH: 0, gazeV: 0, headYaw: 0, headPitch: 0, gazeFrames: 0 };

// Eye gaze from MediaPipe face landmarks (478 points: 0-467 face, 468-477 irises).
// For each eye: [corner, corner, upper lid, lower lid, iris centre].
const EYES = [[33, 133, 159, 145, 468], [362, 263, 386, 374, 473]];

// Expression type numbers from the SDK (ExpressionType enum), in order.
const EXPRESSIONS = ['unspecified', 'angry', 'contempt', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'];

// Where point c sits along the line from a to b: 0 = at a, 1 = at b.
function along(a, b, c) {
  const dx = b.x - a.x, dy = b.y - a.y;
  return ((c.x - a.x) * dx + (c.y - a.y) * dy) / (dx * dx + dy * dy);
}

// Returns { h, v }: h = 0 left .. 1 right of the eye (in the camera image), v = 0 top .. 1 bottom.
function eyeGaze(points) {
  if (!(points?.length >= 478)) return null;
  let h = 0, v = 0;
  for (const [c1, c2, top, bottom, iris] of EYES) {
    // Order the corners left-to-right in the image so both eyes measure in the same direction.
    const [left, right] = points[c1].x < points[c2].x ? [c1, c2] : [c2, c1];
    h += along(points[left], points[right], points[iris]) / 2;
    v += along(points[top], points[bottom], points[iris]) / 2;
  }
  return { h, v };
}

// Head direction from face landmarks: where the nose tip sits between the two cheeks (yaw, left-right)
// and between forehead and chin (pitch, up-down). About 0.5 = facing the camera.
// Looking at another monitor mostly turns the head, so this is what screen calibration relies on.
const HEAD = { nose: 1, cheeks: [234, 454], forehead: 10, chin: 152 };

function headPose(points) {
  if (!(points?.length >= 478)) return null;
  const [c1, c2] = HEAD.cheeks;
  const [left, right] = points[c1].x < points[c2].x ? [c1, c2] : [c2, c1];
  return {
    yaw: along(points[left], points[right], points[HEAD.nose]),
    pitch: along(points[HEAD.forehead], points[HEAD.chin], points[HEAD.nose]),
  };
}

// The most likely expression in a reading, e.g. { name: 'neutral', confidence: 82 }.
function topExpression(reading) {
  const best = reading?.scores?.reduce((a, b) => (b.confidence > a.confidence ? b : a), { confidence: -1 });
  if (!best || best.confidence < 0) return null;
  return { name: EXPRESSIONS[best.type] ?? String(best.type), confidence: Math.round(best.confidence) };
}

// Frame timestamps are microseconds, sometimes as a protobuf Long object. Returns milliseconds.
function frameTime(timestamp) {
  if (timestamp === null || timestamp === undefined) return Date.now();
  const us = typeof timestamp === 'object' ? timestamp.toNumber() : Number(timestamp);
  return us / 1000;
}

// Newest value of a vital, or null if it isn't confident enough yet.
function confident(entry) {
  return entry && typeof entry.value === 'number' && entry.confidence > MIN_CONFIDENCE ? entry.value : null;
}

// Add one batch of Presage data to the running counts.
function addMetrics(buf) {
  const m = decodeMetrics(buf);
  if (Buffer.isBuffer(m)) return;

  // Vitals: keep the newest confident value of each.
  vitals.pulse = confident(m.cardio?.pulseRate?.at(-1)) ?? vitals.pulse;
  vitals.breathing = confident(m.breathing?.rate?.at(-1)) ?? vitals.breathing;
  const rmssd = m.cardio?.hrv?.at(-1)?.rmssd;
  if (typeof rmssd === 'number' && rmssd > 0) vitals.hrv = rmssd;

  if (!m.face) return;

  // A blink = eye goes from open to closed. Each batch holds several frames.
  // Also time how long the eyes stay shut: a long closure is drowsiness, not a blink.
  for (const b of m.face.blinking ?? []) {
    if (b.detected && !lastBlink) counts.blinks += 1;
    lastBlink = Boolean(b.detected);
    lastFrameTime = frameTime(b.timestamp);
    closedSince = b.detected ? (closedSince ?? lastFrameTime) : null;
  }
  if (m.face.talking?.some((t) => t.detected)) counts.talking = true;

  // Average the gaze and head direction over every frame until the next reading.
  for (const frame of m.face.landmarks ?? []) {
    const gaze = eyeGaze(frame.value);
    if (!gaze) continue;
    const head = headPose(frame.value);
    counts.gazeH += gaze.h;
    counts.gazeV += gaze.v;
    counts.headYaw += head.yaw;
    counts.headPitch += head.pitch;
    counts.gazeFrames += 1;
  }

  expression = topExpression(m.face.expression?.at(-1)) ?? expression;
}

// Start the webcam and Presage. Call once when the app starts.
function startPresageFace() {
  const apiKey = process.env.PRESAGE_API_KEY;
  if (!apiKey) throw new Error('PRESAGE_API_KEY is not set');
  vitals = { pulse: null, breathing: null, hrv: null }; // don't carry values over from a last session
  closedSince = null;

  sdk = new SmartSpectraSDK({
    apiKey,
    // Pulse and HRV only from the cardio group: ARTERIAL_PRESSURE_TRACE needs an extra model download
    // that fails when Windows device-key provisioning (TPM) fails.
    requestedMetrics: [...faceMetrics, ...breathingMetrics, MetricType.PULSE_RATE, MetricType.HRV],
  });
  sdk.on('metrics', addMetrics);
  sdk.on('validationStatus', (code) => { status = code; });
  sdk.on('error', (code, message) => console.error('Presage error', code, message));
  sdk.useCamera(CameraSelection.default);
  sdk.start();
}

// Stop the webcam. Call when the app quits.
async function stopPresageFace() {
  if (!sdk) return;
  const old = sdk;
  sdk = null;
  await old.stopAsync();
  await old.destroy();
}

// Returns what happened since the last call, then resets the counts, e.g.
// { t, source: 'face', status: 0, blinks: 2, eyesClosedMs: 0, talking: false, gazeH: 0.51, gazeV: 0.44,
//   expression: 'neutral', expressionConfidence: 82, pulse: 72, breathing: 14.5, hrv: 48 }
// gazeH/gazeV are null when no eyes were seen (face missing or turned away).
// eyesClosedMs = how long the eyes have been shut so far (0 = open).
// pulse (bpm), breathing (per minute), hrv (RMSSD, ms) are null until Presage has warmed up.
function readPresageFace() {
  const n = counts.gazeFrames;
  const reading = {
    t: Date.now(),
    source: 'face',
    status,
    blinks: counts.blinks,
    eyesClosedMs: closedSince === null ? 0 : Math.round(lastFrameTime - closedSince),
    talking: counts.talking,
    gazeH: n ? counts.gazeH / n : null,
    gazeV: n ? counts.gazeV / n : null,
    headYaw: n ? counts.headYaw / n : null,
    headPitch: n ? counts.headPitch / n : null,
    expression: expression?.name ?? null,
    expressionConfidence: expression?.confidence ?? null,
    ...vitals,
  };
  counts = { blinks: 0, talking: false, gazeH: 0, gazeV: 0, headYaw: 0, headPitch: 0, gazeFrames: 0 };
  return reading;
}

module.exports = { startPresageFace, stopPresageFace, readPresageFace, eyeGaze, headPose };
