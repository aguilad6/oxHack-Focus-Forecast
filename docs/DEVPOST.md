# Devpost submission draft: Focus Forecast

> Copy each section into the matching Devpost field. Replace or delete anything in [brackets].
> Prizes to tick: HRT (predictions & decision making), Citadel (best handmade), MLH Best use of Presage,
> MLH Best use of ElevenLabs.

---

## Project name
Focus Forecast

## Tagline (one line)
A desktop app that reads your focus from your webcam and screen, notices when it's slipping, and learns which kind of break actually brings you back.

---

## Inspiration
We lose hours to "just checking something" and only notice when the time is gone. Time trackers tell you afterwards where your day went; they never step in while it's happening. We wanted something that watches the signals of a focus crash as they build up (where your eyes are, how often you blink, whether you've drifted to YouTube) and says something at the right moment, in a way that learns what works for you rather than nagging on a fixed 25-minute timer.

## What it does
- **Reads your body through the webcam** (Presage SmartSpectra): blinks, eye gaze, head direction, facial expression and talking, plus pulse, HRV and breathing when the camera and lighting allow.
- **Reads your screen**: which app is in front, whether it counts as work or a distraction (your own editable lists), how often you switch, and how much you type and click. Counts only, never which keys, window titles or URLs.
- **Turns that into a live focus score** and one of four states: **In flow**, **Hooked** (engaged, but on a distraction), **Zoned out** (work is open, nothing's happening) or **On a break**. The live dashboard shows a 30-minute focus line, coloured by state.
- **Knows when to interrupt.** It compares your focus with *your own* usual level (mean and standard deviation over your last 7 days) and only steps in when you've stayed well below it for a couple of minutes, so a quick glance at a message doesn't trigger anything.
- **Decides what to suggest and learns from it.** A multi-armed bandit chooses between suggestions (a 60-second break, a 5-minute break, a walk, a stretch) and keeps track of which ones actually bring your focus back for you.
- **Says it out loud** with an ElevenLabs voice, so you hear it even when the app is hidden behind your work. If there's no internet, it falls back to the computer's built-in voice.
- **Multi-monitor aware.** A one-time calibration ("look at the dot on each screen") teaches it where each of your monitors is, so looking at your second screen isn't mistaken for looking away. It notices when your screen setup changes and asks you to recalibrate.
- **Asks how you felt at natural moments**: when you come back after being away and when you end a session. Those 1–5 answers check the score against reality.
- **Session summary**: deep-focus %, time hooked, time zoned out, and your own rating.

## How we built it
- **Electron + Node.js** desktop app. The main process collects one reading per second from each sensor; the dashboard is plain HTML/CSS/JS with Chart.js.
- **Presage SmartSpectra Node SDK** for webcam biometrics. We compute **eye gaze** (iris position between the eye corners and lids) and **head yaw/pitch** (nose tip between the cheeks and between forehead and chin) ourselves from the 478 MediaPipe face landmarks the SDK returns.
- **get-windows** and **uiohook-napi** for the active app and keyboard/mouse counts.
- **Everything is recorded locally** as one JSON line per reading (about 1 MB per hour), so sessions can be replayed and used for training without the camera. A running daily summary (count, mean, mean of squares) lets us combine days into an exact mean and standard deviation without re-reading every file.
- **Handmade models, no ML libraries:**
  - *Focus score:* weighted targets per app category and activity, with webcam penalties, smoothed with an exponential moving average (`new = old + k * (target - old)`).
  - *When to interrupt:* a personal z-score test. Alert when focus < mean − 1.5 × standard deviation for 2 minutes.
  - *What to suggest:* an epsilon-greedy bandit. 90% of the time it picks the suggestion with the best average reward so far; 10% of the time it tries another; every option is tried once first. Its state is saved between sessions.
  - *Screen calibration:* nearest-reference-point classification over head and eye direction, with an "away" threshold and smoothing.
- **ElevenLabs text-to-speech** for the spoken suggestion. We send only the sentence, never any biometric data, and cache each clip so repeated suggestions cost nothing.
- **Settings live in one file** (weights, thresholds, app lists, suggestions) and can be edited from a settings panel in the app.

## Challenges we ran into
- **Presage on real hardware:** on one laptop, Windows' TPM couldn't decrypt Presage's saved device key after the first run; on the other, the webcam was too low quality for pulse, breathing and HRV. We designed the score so missing vitals count as "unknown", never "unfocused", and leaned on gaze, blinks and head direction, which worked reliably.
- **A 50-minute Presage trial:** we built a recorder from day one so we could develop and test against recorded sessions instead of burning camera time.
- **"Looking away" vs "looking at my other monitor":** eye position alone isn't enough, because people turn their head to look at a second screen. That's why we added head direction and per-screen calibration.
- **Not being annoying:** a focus app that nags is worse than none. Personal baselines, a 2-minute hold, asking questions only at natural moments, and a voice on/off switch all came from that.
- **Merging two people's work at speed** on shared files, as relatively new git users.

## Accomplishments that we're proud of
- An end-to-end pipeline: webcam + screen → focus score → personal alert → learned suggestion → spoken nudge → feedback, all running locally.
- Every model is written by hand and can be explained line by line.
- Privacy by design: no video stored, no keystrokes, no window titles or URLs, nothing uploaded except the one spoken sentence.
- [Real numbers from our sessions, if you have them, e.g. "In [N] hours of our own sessions it flagged [X] focus drops; we rated [Y]% of them as real."]

## What we learned
- How webcam biometrics work in practice: warm-up times, lighting, and which signals survive a cheap camera.
- Statistics we can actually use: z-scores against a personal baseline, combining means and variances across days, exponential smoothing.
- The explore/exploit trade-off, and why a bandit beats a fixed rule when every person is different.
- Electron's main/renderer split and building safe bridges between them.

## What's next for Focus Forecast
- **Forecasting, not just detecting:** a logistic-regression crash predictor trained on recorded sessions ("chance you lose focus in the next 5 minutes"), evaluated against a fixed 25-minute Pomodoro.
- **Trends:** your best focus hours, your natural work/break rhythm, which apps drain you most.
- **An AI-written weekly summary** of your habits (e.g. with Gemini), kept optional and on top of the handmade models.
- **Lecture mode** (opt-in only): students' own devices give a lecturer an anonymous timeline of where attention dipped.

## Built with
electron, node.js, javascript, html, css, chart.js, presage-smartspectra, elevenlabs, get-windows, uiohook-napi, mediapipe-face-landmarks

## Links
- GitHub: https://github.com/aguilad6/oxHack-Focus-Forecast
- Demo video: [link, once recorded]

## Team
Daniel and Garrett
