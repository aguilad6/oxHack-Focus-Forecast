// Reset learnt data: start the averages and the suggestion learning from scratch.
// Nothing is deleted or overwritten: the files are moved into a new backup folder,
// e.g. data/backups/2026-10-25_10-30-05/. Session recordings are left where they are.

const fs = require('fs');
const path = require('path');
const { DATA_DIR, dayKey } = require('./recorder');

// What the app has learnt about the user, in data/.
const LEARNT_FILES = [
  'daily-summary.json', // usual focus level and vitals (alert.js, score.js)
  'epsilon-greedy.json', // which suggestions work (intervention.js)
];

// A backup folder that doesn't exist yet: data/backups/<date_time>, adding -2, -3, ... if needed.
function newBackupFolder() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${dayKey(now.getTime())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const base = path.join(DATA_DIR, 'backups', stamp);
  let folder = base;
  for (let i = 2; fs.existsSync(folder); i++) folder = `${base}-${i}`;
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

// Move the learnt files into a new backup folder. Returns { folder, moved: ['daily-summary.json', ...] }.
// folder is null if there was nothing to move.
function resetLearntData() {
  const present = LEARNT_FILES.filter((name) => fs.existsSync(path.join(DATA_DIR, name)));
  if (!present.length) return { folder: null, moved: [] };

  const folder = newBackupFolder();
  for (const name of present) fs.renameSync(path.join(DATA_DIR, name), path.join(folder, name));
  return { folder, moved: present };
}

module.exports = { resetLearntData };
