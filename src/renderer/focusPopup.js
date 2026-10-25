// Refocus pop-up page: shows the suggestion from the URL and plays a short chime.

document.getElementById('suggestion').textContent =
  new URLSearchParams(location.search).get('s');

// Two soft notes (E5 then A5), made with the Web Audio API so no sound file is needed.
function chime() {
  const audio = new AudioContext();
  [659.25, 880].forEach((frequency, i) => {
    const start = audio.currentTime + i * 0.18;
    const tone = audio.createOscillator();
    const volume = audio.createGain();
    tone.type = 'sine';
    tone.frequency.value = frequency;
    // Quick fade in, slow fade out, so it sounds like a bell rather than a beep.
    volume.gain.setValueAtTime(0, start);
    volume.gain.linearRampToValueAtTime(0.25, start + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.001, start + 0.6);
    tone.connect(volume).connect(audio.destination);
    tone.start(start);
    tone.stop(start + 0.6);
  });
}
chime();

const close = () => window.focusApi.closeFocusPopup();
document.getElementById('ok').addEventListener('click', close);
document.getElementById('close').addEventListener('click', close);
