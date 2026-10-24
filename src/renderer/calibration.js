// Screen calibration on the dashboard: the banner (first run / setup changed)
// and the "Screens" section in Settings. The calibration itself runs in main/calibration.js.

const calibrationApi = window.focusApi.calibration;
let bannerDismissed = false; // "Later" hides the banner until the app is restarted

function showCalibrationStatus(status) {
  // Banner: only when the webcam is on and calibration is missing or out of date.
  const needed = status.webcam && !status.running && (!status.calibrated || status.setupChanged);
  document.getElementById('calib-banner').hidden = !needed || bannerDismissed;
  document.getElementById('calib-banner-text').textContent = status.setupChanged
    ? 'Your screens have changed since you calibrated. Recalibrate so we know where each one is?'
    : `Set up your ${status.screensNow === 1 ? 'screen' : `${status.screensNow} screens`} (takes about ${status.screensNow * 5} seconds), so looking at another monitor isn't counted as looking away.`;

  // Settings section.
  let text;
  if (status.running) text = 'Calibrating… look at the dot on each screen.';
  else if (!status.calibrated) text = 'Not calibrated yet.';
  else if (status.setupChanged) text = 'Your screens have changed since you calibrated.';
  else text = `${status.savedScreens} screen${status.savedScreens === 1 ? '' : 's'} calibrated on ${new Date(status.savedAt).toLocaleDateString()}.`;
  if (!status.webcam) text += ' Needs the webcam (USE_PRESAGE=1 in .env, during a session).';
  document.getElementById('screens-status').textContent = text;

  const button = document.getElementById('recalibrate');
  button.disabled = !status.webcam || status.running;
  button.textContent = status.calibrated ? 'Recalibrate' : 'Calibrate screens';
}

async function startCalibration() {
  document.getElementById('screens-message').textContent = '';
  const result = await calibrationApi.start();
  if (!result.ok) document.getElementById('screens-message').textContent = result.message;
}

document.getElementById('calib-now').addEventListener('click', startCalibration);
document.getElementById('recalibrate').addEventListener('click', startCalibration);
document.getElementById('calib-later').addEventListener('click', () => {
  bannerDismissed = true;
  document.getElementById('calib-banner').hidden = true;
});

calibrationApi.onStatus(showCalibrationStatus);
calibrationApi.status().then(showCalibrationStatus);
