// Voice: speaks a warning or suggestion out loud, e.g. speak("Your focus has dipped. Try a 5 minute break.")
//
// Uses ElevenLabs text-to-speech: we send ONLY the sentence (never biometrics) and get back an MP3,
// which the dashboard plays. Each sentence is remembered after the first time, so repeating
// a suggestion doesn't use up credits again.
// Fallback: if there's no key, no internet or no credits left, the dashboard uses the computer's
// built-in voice instead, so a warning is never silent.
// Key: ELEVENLABS_API_KEY, from a Windows/Linux environment variable or .env. Never in the code.

const { BrowserWindow, ipcMain } = require('electron');
const { getConfig } = require('../config');

const API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const TIMEOUT_MS = 8000; // give up on ElevenLabs after this and use the built-in voice

const clips = new Map(); // sentence -> MP3 bytes, so each sentence is only paid for once

// Send a message to the dashboard (the only window that plays sound).
function toDashboard(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}

// Ask ElevenLabs for an MP3 of the sentence. Throws if it fails.
async function fetchClip(text) {
  if (clips.has(text)) return clips.get(text);

  const { voiceId, model } = getConfig().voice;
  const response = await fetch(`${API_URL}/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: model }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`ElevenLabs said ${response.status}: ${(await response.text()).slice(0, 200)}`);

  const clip = new Uint8Array(await response.arrayBuffer());
  clips.set(text, clip);
  return clip;
}

// Say a sentence. Returns which voice was used: 'elevenlabs', 'builtin', or 'off' (switched off in Settings).
async function speak(text) {
  if (!getConfig().voice.enabled) return { voice: 'off' };

  if (process.env.ELEVENLABS_API_KEY) {
    try {
      toDashboard('voice-play', await fetchClip(text));
      return { voice: 'elevenlabs' };
    } catch (err) {
      console.error('ElevenLabs failed, using the built-in voice:', err.message);
      toDashboard('voice-fallback', text);
      return { voice: 'builtin', message: err.message };
    }
  }
  toDashboard('voice-fallback', text);
  return { voice: 'builtin', message: 'No ElevenLabs key found.' };
}

// For the Settings panel.
ipcMain.handle('voice-status', () => ({ hasKey: Boolean(process.env.ELEVENLABS_API_KEY), enabled: getConfig().voice.enabled }));
ipcMain.handle('voice-test', () => speak('Your focus has dipped. Try a five minute break.'));

module.exports = { speak };
