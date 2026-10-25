// Alert: notices when focus has dropped well below your usual level.
//
// "Usual" = mean and standard deviation of your focus score while in flow, over the last few days,
// today included, so it already works on the first day. (recorder.js only counts flow readings.) "Well below" = more than ALERT.sdBelow standard deviations
// under the mean. FocusDropDetector only reports it once it has lasted a "hold" time,
// so a short dip (e.g. checking a message) doesn't count.
//
// The hold time backs off: it starts short, grows after every alert (so we don't nag),
// and shrinks again after a long stretch without low focus. Those numbers are user settings
// (alerts.* in the settings file, see config.js).

const { readDailySummary, dayKey } = require('./recorder');
const { getConfig } = require('../config');

const ALERT = {
  sdBelow: 1,          // how many standard deviations under the mean counts as low
  days: 7,             // how many past days (today included) make up "usual"
  minSamples: 10,//300,     // need this many focus readings (~5 min) before judging anything TODO: return this
  refreshSeconds: 5,  // FocusDropDetector re-reads the averages this often (today's keep changing)
  minSd: 5,            // standard deviation is never taken as smaller than this (focus points),
                       // so a very steady score doesn't make every tiny dip count as low
};

// Daily summaries of one measure ('focus', 'pulse', 'breathing', 'hrv') for the last `days` days,
// today included, oldest first, e.g. [{ day: '2026-10-24', n: 3600, mean: 64.2, meanSquare: 4290.1, sd: 12.3 }]
function readDays(name, days = ALERT.days, now = Date.now()) {
  const summary = readDailySummary();
  const result = [];
  for (let back = days - 1; back >= 0; back--) {
    // Step back by calendar day (not 24 h) so clock changes don't skip or repeat a day.
    const date = new Date(now);
    date.setDate(date.getDate() - back);
    const day = dayKey(date.getTime());
    if (summary[day]?.[name]) result.push({ day, ...summary[day][name] });
  }
  return result;
}

function readFocusDays(days = ALERT.days, now = Date.now()) {
  return readDays('focus', days, now);
}

// One mean and standard deviation for all readings of a measure across those days, as if they were
// one long day. Returns { n, mean, sd }, or null if there are no readings yet.
function baselineOf(name, days = ALERT.days, now = Date.now()) {
  const list = readDays(name, days, now);
  const n = list.reduce((sum, d) => sum + d.n, 0);
  if (!n) return null;
  // Weight each day by how many readings it has.
  const mean = list.reduce((sum, d) => sum + d.n * d.mean, 0) / n;
  const meanSquare = list.reduce((sum, d) => sum + d.n * d.meanSquare, 0) / n;
  return { n, mean, sd: Math.sqrt(Math.max(0, meanSquare - mean * mean)) };
}

// The focus baseline alerts are judged against (standard deviation at least ALERT.minSd).
function focusBaseline(days = ALERT.days, now = Date.now()) {
  const baseline = baselineOf('focus', days, now);
  return baseline && { ...baseline, sd: Math.max(ALERT.minSd, baseline.sd) };
}

// Is this focus score more than `sdBelow` standard deviations under the mean right now?
// False when there isn't enough history to judge.
function isFocusLow(focus, baseline = focusBaseline(), sdBelow = ALERT.sdBelow) {
  if (typeof focus !== 'number' || !baseline || baseline.n < ALERT.minSamples) return false;
  return focus < baseline.mean - sdBelow * baseline.sd;
}

// Feed it focus readings one at a time; add() returns true while focus has been low for the hold time.
// After showing an alert, call alerted() so the hold time grows and the count starts again.
//   const detector = new FocusDropDetector();
//   if (detector.add(focusReading)) { ...show an alert...; detector.alerted(); }
class FocusDropDetector {
  constructor({ sdBelow = ALERT.sdBelow } = {}) {
    this.sdBelow = sdBelow;
    this.holdSeconds = getConfig().alerts.holdStartSeconds;
    this.lowSince = null;     // when the current low stretch started
    this.calmSince = null;    // when focus was last low (or the start), for shrinking the hold time
    this.baseline = null;
    this.baselineTime = null; // when the baseline was last read
  }

  // reading: { t, focus } from score.js.
  add(reading) {
    const settings = getConfig().alerts;
    // Settings can change at any time: keep the hold time inside the current limits.
    this.holdSeconds = Math.min(settings.holdMaxSeconds, Math.max(settings.holdStartSeconds, this.holdSeconds));

    if (this.baselineTime === null || reading.t - this.baselineTime >= ALERT.refreshSeconds * 1000) {
      this.baseline = focusBaseline(ALERT.days, reading.t);
      this.baselineTime = reading.t;
    }

    if (isFocusLow(reading.focus, this.baseline, this.sdBelow)) {
      this.calmSince = null;
      this.lowSince ??= reading.t;
      return reading.t - this.lowSince >= this.holdSeconds * 1000;
    }

    // Not low. Every calmMinutes without low focus, shorten the hold time again (not below the start).
    this.lowSince = null;
    this.calmSince ??= reading.t;
    if (reading.t - this.calmSince >= settings.calmMinutes * 60 * 1000) {
      this.holdSeconds = Math.max(settings.holdStartSeconds, this.holdSeconds - settings.holdStepDownSeconds);
      this.calmSince = reading.t;
    }
    return false;
  }

  // An alert was shown: wait longer before the next one, and start counting again.
  alerted() {
    const settings = getConfig().alerts;
    this.holdSeconds = Math.min(settings.holdMaxSeconds, this.holdSeconds + settings.holdStepUpSeconds);
    this.lowSince = null;
  }

  // Start counting again without changing the hold time.
  reset() {
    this.lowSince = null;
  }
}

module.exports = { ALERT, readDays, readFocusDays, baselineOf, focusBaseline, isFocusLow, FocusDropDetector };
