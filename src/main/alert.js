// Alert: notices when focus has dropped well below your usual level.
//
// "Usual" = mean and standard deviation of your focus score over the last few days, today included,
// so it already works on the first day. "Well below" = more than ALERT.sdBelow standard deviations
// under the mean. FocusDropDetector only reports it once it has lasted ALERT.holdSeconds,
// so a short dip (e.g. checking a message) doesn't count.

const { readDailySummary, dayKey } = require('./recorder');

const ALERT = {
  sdBelow: 1.5,        // how many standard deviations under the mean counts as low
  holdSeconds: 120,    // low for this long before FocusDropDetector reports it
  days: 7,             // how many past days (today included) make up "usual"
  minSamples: 300,     // need this many focus readings (~5 min) before judging anything
  refreshSeconds: 60,  // FocusDropDetector re-reads the averages this often (today's keep changing)
};

// Daily focus summaries for the last `days` days, today included, oldest first,
// e.g. [{ day: '2026-10-24', n: 3600, mean: 64.2, meanSquare: 4290.1, sd: 12.3 }]
function readFocusDays(days = ALERT.days, now = Date.now()) {
  const summary = readDailySummary();
  const result = [];
  for (let back = days - 1; back >= 0; back--) {
    // Step back by calendar day (not 24 h) so clock changes don't skip or repeat a day.
    const date = new Date(now);
    date.setDate(date.getDate() - back);
    const day = dayKey(date.getTime());
    if (summary[day]?.focus) result.push({ day, ...summary[day].focus });
  }
  return result;
}

// One mean and standard deviation for all readings across those days, as if they were one long day.
// Returns { n, mean, sd }, or null if there are no readings yet.
function focusBaseline(days = ALERT.days, now = Date.now()) {
  const list = readFocusDays(days, now);
  const n = list.reduce((sum, d) => sum + d.n, 0);
  if (!n) return null;
  // Weight each day by how many readings it has.
  const mean = list.reduce((sum, d) => sum + d.n * d.mean, 0) / n;
  const meanSquare = list.reduce((sum, d) => sum + d.n * d.meanSquare, 0) / n;
  return { n, mean, sd: Math.sqrt(Math.max(0, meanSquare - mean * mean)) };
}

// Is this focus score more than `sdBelow` standard deviations under the mean right now?
// False when there isn't enough history to judge.
function isFocusLow(focus, baseline = focusBaseline(), sdBelow = ALERT.sdBelow) {
  if (typeof focus !== 'number' || !baseline || baseline.n < ALERT.minSamples) return false;
  return focus < baseline.mean - sdBelow * baseline.sd;
}

// Feed it focus readings one at a time; add() returns true once focus has been low for holdSeconds.
//   const detector = new FocusDropDetector();
//   if (detector.add(focusReading)) { ...recommend something... }
class FocusDropDetector {
  constructor({ sdBelow = ALERT.sdBelow, holdSeconds = ALERT.holdSeconds } = {}) {
    this.sdBelow = sdBelow;
    this.holdSeconds = holdSeconds;
    this.lowSince = null;     // when the current low stretch started
    this.baseline = null;
    this.baselineTime = null; // when the baseline was last read
  }

  // reading: { t, focus } from score.js.
  add(reading) {
    if (this.baselineTime === null || reading.t - this.baselineTime >= ALERT.refreshSeconds * 1000) {
      this.baseline = focusBaseline(ALERT.days, reading.t);
      this.baselineTime = reading.t;
    }

    if (!isFocusLow(reading.focus, this.baseline, this.sdBelow)) {
      this.lowSince = null;
      return false;
    }
    this.lowSince ??= reading.t;
    return reading.t - this.lowSince >= this.holdSeconds * 1000;
  }

  // Start counting again, e.g. after an alert was shown.
  reset() {
    this.lowSince = null;
  }
}

module.exports = { ALERT, readFocusDays, focusBaseline, isFocusLow, FocusDropDetector };
