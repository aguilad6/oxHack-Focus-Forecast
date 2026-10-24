// Recorder: saves every reading to a session file in data/, one JSON object per line (JSONL), e.g.
//   {"t":1792865758282,"source":"window","app":"Visual Studio Code","category":"on-task","switched":false}
// One new file per app run. These files are used to replay sessions without the camera
// and to train the models. data/ is gitignored: recordings never leave the laptop.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

let file = null; // path of the current session file

// Open a new session file, e.g. data/session-2026-10-24_15-30-05.jsonl. Returns its path.
function startRecording() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Local date and time, made safe for a file name: 2026-10-24_15-30-05
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
                `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  file = path.join(DATA_DIR, `session-${stamp}.jsonl`);
  return file;
}

// Add one reading as a new line. Written to disk immediately ("Sync"), so nothing is lost
// if the app quits or crashes straight afterwards. A few lines per second is no strain.
function record(reading) {
  if (file) fs.appendFileSync(file, JSON.stringify(reading) + '\n');
}

// Stop recording. Call when the app quits.
function stopRecording() {
  file = null;
}

module.exports = { startRecording, record, stopRecording };
