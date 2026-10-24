// Recorder: saves every reading to a session file in data/, one JSON object per line (JSONL), e.g.
//   {"t":1792865758282,"source":"window","app":"Visual Studio Code","category":"on-task","switched":false}
// One new file per app run. These files are used to replay sessions without the camera
// and to train the models. data/ is gitignored: recordings never leave the laptop.
//
// It also keeps a summary per day in data/daily-summary.json, for the focus score and heart rate:
//   { "2026-10-24": { "focus": { "n": 3600, "mean": 64.2, "meanSquare": 4290.1, "sd": 12.3 }, "pulse": ... } }
// n = number of readings. meanSquare = mean of the squared values: with n and mean it lets
// alert.js combine several days into one exact mean and standard deviation.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SUMMARY_FILE = path.join(DATA_DIR, 'daily-summary.json');

let file = null; // path of the current session file

const pad = (n) => String(n).padStart(2, '0');

// Local date of a timestamp, e.g. '2026-10-24'.
function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Open a new session file, e.g. data/session-2026-10-24_15-30-05.jsonl. Returns its path.
function startRecording() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Local date and time, made safe for a file name: 2026-10-24_15-30-05
  const now = new Date();
  const stamp = `${dayKey(now)}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  file = path.join(DATA_DIR, `session-${stamp}.jsonl`);
  return file;
}

// All daily summaries, or {} if there are none yet.
function readDailySummary() {
  try {
    return JSON.parse(fs.readFileSync(SUMMARY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// Add one value to a { n, mean, meanSquare, sd } summary (or start one).
function addToStats(stats, value) {
  const n = (stats?.n ?? 0) + 1;
  const mean = ((stats?.mean ?? 0) * (n - 1) + value) / n;
  const meanSquare = ((stats?.meanSquare ?? 0) * (n - 1) + value * value) / n;
  // Variance = mean of squares - square of mean. Rounding can make it a hair below 0, hence max().
  const sd = Math.sqrt(Math.max(0, meanSquare - mean * mean));
  return { n, mean, meanSquare, sd };
}

// Update today's summary if this reading has a focus score or a heart rate.
function updateDailySummary(reading) {
  const values = { focus: reading.focus, pulse: reading.pulse };
  if (!Object.values(values).some((v) => typeof v === 'number')) return;

  const summary = readDailySummary();
  const day = (summary[dayKey(reading.t)] ??= {});
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === 'number') day[name] = addToStats(day[name], value);
  }
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
}

// Add one reading as a new line. Written to disk immediately ("Sync"), so nothing is lost
// if the app quits or crashes straight afterwards. A few lines per second is no strain.
function record(reading) {
  if (!file) return;
  fs.appendFileSync(file, JSON.stringify(reading) + '\n');
  updateDailySummary(reading);
}

// Stop recording. Call when the app quits.
function stopRecording() {
  file = null;
}

module.exports = { startRecording, record, stopRecording, readDailySummary, dayKey };
