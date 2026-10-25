// Voice on the dashboard: plays the clips main/voice.js sends, and the Voice section in Settings.

const voiceApi = window.focusApi.voice;

// ElevenLabs clip (MP3 bytes): play it, then free the memory.
voiceApi.onPlay((clip) => {
  const url = URL.createObjectURL(new Blob([clip], { type: 'audio/mpeg' }));
  const audio = new Audio(url);
  audio.addEventListener('ended', () => URL.revokeObjectURL(url));
  audio.play().catch((err) => console.error('Could not play the voice clip:', err.message));
});

// Fallback: the computer's built-in voice.
voiceApi.onFallback((text) => {
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
});

// ---- Settings: Voice section ----
const voiceToggle = document.getElementById('voice-enabled');

async function showVoiceStatus() {
  const { hasKey, enabled } = await voiceApi.status();
  voiceToggle.checked = enabled;
  document.getElementById('voice-status').textContent = hasKey
    ? 'Using the ElevenLabs voice. Only the sentence is sent, never your data.'
    : "No ElevenLabs key found, so the computer's built-in voice is used.";
}

voiceToggle.addEventListener('change', async () => {
  await window.focusApi.settings.update({ voice: { enabled: voiceToggle.checked } });
  showVoiceStatus();
});

document.getElementById('voice-test').addEventListener('click', async () => {
  const message = document.getElementById('voice-message');
  message.textContent = 'Speaking…';
  const result = await voiceApi.test();
  message.textContent = result.voice === 'off' ? 'Voice is switched off.'
    : result.voice === 'builtin' ? `Used the built-in voice. ${result.message ?? ''}`
      : '';
});

document.getElementById('open-settings').addEventListener('click', showVoiceStatus);
showVoiceStatus();
