// Calibration overlay: shows "Screen 1 of 2" and a ring that shrinks while the face is measured.
// main/calibration.js controls the timing and closes this window. Esc cancels.

const params = new URLSearchParams(location.search);
document.getElementById('progress').textContent =
  `Screen ${params.get('screen')} of ${params.get('total')} · keep your head and eyes on it · Esc to cancel`;

// 1 s to settle + the measuring time.
document.getElementById('ring').style.animationDuration = `${Number(params.get('seconds')) + 1}s`;

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.focusApi.calibration.cancel();
});
