// Presage test: reads the webcam and prints heart rate, breathing, HRV, blinking, talking
// eye gaze (worked out from face landmarks) and facial expression.
// Reference for src/main/presage.js. Run from the project folder:
//   put your key in .env (copy .env.example), then:  npm run presage-test
// Each run uses Presage trial minutes. Press Ctrl+C to stop.

import { writeFileSync, mkdirSync } from 'node:fs';
import {
  SmartSpectraSDK, CameraSelection, decodeMetrics,
  breathingMetrics, faceMetrics,
} from '@smartspectra/node-sdk';

// The key comes from an environment variable so it never ends up in a file.
const apiKey = process.env.PRESAGE_API_KEY;
if (!apiKey) {
  console.error('No API key. Copy .env.example to .env and put your key after PRESAGE_API_KEY=');
  process.exit(1);
}

console.log('Cameras found:', SmartSpectraSDK.availableCameras());

const sdk = new SmartSpectraSDK({
  apiKey,
  // Pulse (15) and HRV (17) only: skip ARTERIAL_PRESSURE_TRACE (16), which needs an extra
  // model download that fails when Windows device-key provisioning (TPM) fails.
  requestedMetrics: [...breathingMetrics, 15, 17, ...faceMetrics],
});

sdk.on('processingStatus', (status) => console.log('Status:', status));
// Only print the camera check when it changes, so it doesn't flood the screen. 0 = OK.
let lastCheck = null;
sdk.on('validationStatus', (code, ts, hint) => {
  if (code !== lastCheck) console.log(code === 0 ? 'Check: OK - framing is good' : `Check: ${code} ${hint}`);
  lastCheck = code;
});
const startTime = Date.now();
sdk.on('error', (code, message, retryable) =>
  console.error('ERROR', code, message, 'retryable =', retryable));

let savedSample = false;

// Eye gaze from MediaPipe face landmarks (478 points: 0-467 face, 468-477 irises).
// For each eye: [corner, corner, upper lid, lower lid, iris centre].
const EYES = [[33, 133, 159, 145, 468], [362, 263, 386, 374, 473]];

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

// Expression type numbers from the SDK (ExpressionType enum), in order.
const EXPRESSIONS = ['unspecified', 'angry', 'contempt', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'];

// The most likely expression in a reading, e.g. "neutral 82%".
function topExpression(expression) {
  const best = expression?.scores?.reduce((a, b) => (b.confidence > a.confidence ? b : a), { confidence: -1 });
  if (!best || best.confidence < 0) return '-';
  return `${EXPRESSIONS[best.type] ?? best.type} ${best.confidence.toFixed(0)}%`;
}

sdk.on('metrics', (buf, ts) => {
  const m = decodeMetrics(buf);
  if (Buffer.isBuffer(m)) return;

  // Keep the latest full payload on disk so we can see the real field names (brief: don't assume them).
  // Saved in data/ (gitignored): it contains biometrics.
  mkdirSync('data', { recursive: true });
  writeFileSync('data/sample-metrics.json', JSON.stringify(m, null, 2));
  if (!savedSample) {
    console.log('Saving the latest full reading to data/sample-metrics.json');
    savedSample = true;
  }

  // Each field is a list of recent readings; .at(-1) takes the newest one.
  const pulse = m.cardio?.pulseRate?.at(-1);
  const breathing = m.breathing?.rate?.at(-1);
  const hrv = m.cardio?.hrv?.at(-1)?.rmssd;
  // A blink is very short, so check every reading in this batch, not just the newest.
  const blinked = m.face?.blinking?.some((b) => b.detected) ?? false;
  const talking = m.face?.talking?.some((t) => t.detected) ?? false;
  const gaze = eyeGaze(m.face?.landmarks?.at(-1)?.value);
  const expression = topExpression(m.face?.expression?.at(-1));
  const secs = Math.round((Date.now() - startTime) / 1000);

  // Confidence starts at 0 and needs a warm-up: ~12 s pulse, ~30 s breathing, ~60 s HRV.
  console.log(
    `${secs}s | pulse ${pulse?.value?.toFixed(0) ?? '-'} bpm (conf ${pulse?.confidence?.toFixed(0) ?? '-'}) | ` +
    `breathing ${breathing?.value?.toFixed(1) ?? '-'} /min (conf ${breathing?.confidence?.toFixed(0) ?? '-'}) | ` +
    `HRV ${hrv?.toFixed(0) ?? '-'} ms | blinked ${blinked} | talking ${talking} | ` +
    `gaze ${gaze ? `h ${gaze.h.toFixed(2)} v ${gaze.v.toFixed(2)}` : '-'} | expression ${expression}`
  );
});

sdk.useCamera(CameraSelection.default);
try {
  sdk.start();
} catch (e) {
  // If startup fails, quit straight away; otherwise SDK background threads can freeze the terminal.
  console.error('Presage failed to start:', e.message);
  process.exit(1);
}
console.log('Measuring... sit still, face the camera in good light. Ctrl+C to stop.');

// Ctrl+C: try to shut down cleanly, but force-quit after 3 s (or on a second Ctrl+C)
// so a stuck SDK can never trap the terminal.
let stopping = false;
process.on('SIGINT', async () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log('Stopping...');
  setTimeout(() => process.exit(1), 3000).unref();
  try {
    await sdk.stopAsync();
    await sdk.destroy();
  } catch (e) {
    console.error('Error while stopping:', e.message);
  }
  process.exit(0);
});
