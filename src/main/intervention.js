// Intervention: when focus stays low, show a "refocus" pop-up with a suggestion, then learn
// whether that suggestion helped.
//
// 1. FocusDropDetector (alert.js) says focus has been low long enough.
// 2. EpsilonGreedy picks a suggestion from the user's Interactions list and the pop-up shows it.
// 3. For the next MEASURE_MINUTES we quietly average the focus score (nothing is shown).
// 4. That average is the suggestion's reward: saved to EpsilonGreedy, so better ones get picked more.
// Both the pop-up and its result are also written to the session file, for training later.

const fs = require('fs');
const path = require('path');
const { getConfig } = require('../config');
const { record } = require('./recorder');
const { FocusDropDetector } = require('./alert');
const { showFocusPopup, closeFocusPopup } = require('./focusPopup');
const {
  EpsilonGreedy, EpsilonGreedySaver, InteractionFactory, EpsilonGreedyFactory,
} = require('./epsilonGreedy');

// How long after a pop-up the focus score is averaged to judge the suggestion.
const MEASURE_MINUTES = 3;

// What EpsilonGreedy has learnt. In data/ (gitignored): it's personal.
const BANDIT_FILE = path.join(__dirname, '..', '..', 'data', 'epsilon-greedy.json');

let detector = null;
let measuring = null; // { interaction, until, sum, n } while a suggestion is being judged

// The bandit for the current suggestions list, with what was learnt so far.
// Built fresh each time so suggestions added or removed in Settings are picked up.
function loadBandit() {
  const { Interactions = [], alerts } = getConfig();
  const bandit = new EpsilonGreedy(InteractionFactory.fromNames(Interactions), alerts.epsilon);
  if (fs.existsSync(BANDIT_FILE)) {
    try {
      // Only suggestions still in the list keep their history.
      bandit.restore(EpsilonGreedyFactory.fromFile(BANDIT_FILE).createMemento());
    } catch (err) {
      console.error(`Can't read ${BANDIT_FILE}, starting fresh:`, err.message);
    }
  }
  bandit.epsilon = alerts.epsilon; // the setting wins over the saved value
  return bandit;
}

function showAlert(t) {
  const bandit = loadBandit();
  detector.alerted();

  // No suggestions in Settings: still nudge, but there's nothing to learn about.
  if (!bandit.interactions.length) {
    showFocusPopup('Take a moment and get back to your work.');
    record({ t, source: 'alert', interaction: null, nextHoldSeconds: detector.holdSeconds });
    return;
  }

  const interaction = bandit.choose();
  showFocusPopup(interaction.name);
  record({ t, source: 'alert', interaction: interaction.name, nextHoldSeconds: detector.holdSeconds });
  measuring = { interaction: interaction.name, until: t + MEASURE_MINUTES * 60 * 1000, sum: 0, n: 0 };
}

function finishMeasuring(t) {
  const meanFocus = measuring.sum / measuring.n;
  const bandit = loadBandit();
  const interaction = bandit.interactions.find((i) => i.name === measuring.interaction);
  if (interaction) { // (skipped if it was removed from Settings in the meantime)
    bandit.record(interaction, meanFocus, t);
    new EpsilonGreedySaver(BANDIT_FILE).save(bandit);
  }
  record({ t, source: 'alertResult', interaction: measuring.interaction, meanFocus });
  measuring = null;
  detector.reset(); // focus has to be low for a full hold time again before the next pop-up
}

// Call when a session starts.
function startInterventions() {
  detector = new FocusDropDetector();
  measuring = null;
}

// Call when a session ends. A half-finished measurement is dropped: it wouldn't be a fair reward.
function stopInterventions() {
  detector = null;
  measuring = null;
  closeFocusPopup();
}

// Feed every focus reading from score.js in.
function feedFocus(reading) {
  if (!detector || typeof reading.focus !== 'number') return;

  const low = detector.add(reading); // always fed, so the hold time can shrink during calm stretches
  if (measuring) {
    measuring.sum += reading.focus;
    measuring.n += 1;
    if (reading.t >= measuring.until) finishMeasuring(reading.t);
  } else if (low) {
    showAlert(reading.t);
  }
}

// The mean and standard deviation the detector is comparing against right now: { n, mean, sd } or null.
function getBaseline() {
  return detector?.baseline ?? null;
}

module.exports = { MEASURE_MINUTES, startInterventions, stopInterventions, feedFocus, getBaseline };
