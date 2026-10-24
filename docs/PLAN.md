# Focus Forecast: build plan for 2 people

Hacking ends **Sun 25 Oct, 12:00**. Feature freeze **10:30**. Brief: `Focus_Forecast_Project_Brief.pdf`.

- **Daniel** (Windows laptop): screen activity, recorder/replay, front end.
- **Teammate** (Linux laptop): Presage, scoring engine, crash predictor.

Why this split: live Presage works best on the Linux laptop (Daniel's has a Windows TPM bug and
a webcam without exposure lock). Window tracking and input rate work fine on Windows and don't
use up the Presage trial. Each person mostly owns different files, so merges rarely clash.

---

## How the pieces connect

```
 Presage (presage.js) ──┐
 Window tracker ────────┼──► main.js ──► engine/scoring.js ──► engine/forecast.js ──► engine/bandit.js
 Input rate ────────────┘       │              (focus, stress, state)  (crash probability)  (what to do)
                                │
                          recorder.js ──► data/session-*.jsonl   (replay.js plays them back)
                                │
                     preload.js (IPC bridge)
                                │
                      renderer/ (the UI window)
```

- **Main process** (`src/main/`) runs in Node.js: it reads the camera, the active window and the keyboard/mouse rate.
- **Engine** (`src/engine/`) is pure JavaScript: numbers in, numbers out. No Electron, no camera, so it can be
  tested by replaying recorded sessions.
- **Renderer** (`src/renderer/`) is the UI: plain HTML/CSS/JS plus chart.js. It never touches the camera itself.
  It only receives readings from main through `window.focusApi` (defined in `preload.js`).

## The data contract (agree on this first!)

Every source sends **one reading per second** to main, as a plain object with `t` (ms timestamp) and `source`:

```js
// presage.js (Teammate)
{ t, source: 'presage', status: 0, pulse: 72, pulseConf: 0.9, hrv: 41, breathing: 14.5,
  blinked: true, talking: false }          // status != 0 → face missing → "unknown", never "unfocused"

// windowTracker.js (Daniel)
{ t, source: 'window', app: 'Code', category: 'on-task', switched: false }
                                           // category from the app list in config.js; never store titles/URLs

// inputRate.js (Daniel)
{ t, source: 'input', keys: 3, clicks: 0, mouseMoved: true }   // counts only, never which keys

// self-report pop-up (Daniel)
{ t, source: 'selfReport', rating: 4 }     // 1–5
```

The engine turns those into one output per second, which main sends to the UI:

```js
{ t, focus: 63, stress: 'med', state: 'flow' | 'hooked' | 'zonedOut' | 'break' | 'unknown',
  crashProb: 0.32, minutesToDip: 6, recommendation: 'breathing' }
```

Missing values are `null`, not `0`. All weights, thresholds and window lengths go in **`src/config.js`**.

## The front end (Daniel)

Plain HTML + CSS + JS in `src/renderer/`, with **chart.js** for the timeline. No React: nothing to learn, nothing to build.

How data reaches the screen: main calls `win.webContents.send('tick', output)` every second. `preload.js` exposes
`focusApi.onTick(callback)`. `renderer.js` updates the page and the chart.

Screens, in the order to build them:
1. **Debug panel** (Phase 1): raw readings from each source as text. Proves the streams work.
2. **Live view** (Phase 2): current state badge, focus line for the last 30 min, stress low/med/high.
   Use fake data until scoring.js is ready.
3. **Self-report pop-up** (Phase 2): every 15 min, "How focused were you? 1–5". Saved as a reading.
4. **Forecast + advice** (Phase 4): dotted forecast line ahead of "now", countdown to the next dip,
   one recommended action with "did it / skip" buttons (feeds the bandit's reward).
5. **Session summary** (Phase 4): deep-focus minutes and %, time lost to Hooked + top apps,
   forecast accuracy vs Pomodoro, the threshold trade-off chart.

Design rules from the brief: plain-language numbers, always relative to the user's own baseline,
no single "productivity score", raw biometrics only as a drill-down.

---

## Timeline

### Phase 0: together, ~15 min, now
- [ ] Both: read this file and agree on the data contract above.
- [ ] Teammate: `git pull`, `npm install`, `npm start` (the window opens), then `npm run presage-test`
      with their own key in `.env` (see "Presage setup" below).
- [ ] **Decide:** does each of you have your own Presage trial key? The trial is 50 minutes per key, which
      limits overnight recording. Ask the organisers/MLH mentors for more if needed.

### Phase 1: get every stream into main (Sat afternoon/evening)
| Daniel (`daniel/streams`) | Teammate (`teammate/presage`) |
|---|---|
| `src/config.js`: app → category list (on-task / distraction), tick length | `src/main/presage.js`: move `scripts/presage-test.mjs` into a module that starts the SDK and emits one `presage` reading per second |
| `src/main/windowTracker.js` with `get-windows`: poll every 1 s | Handle `validationStatus` (0 = OK, 7 = chest not visible, 2 = several faces, 5 = too dark) |
| `src/main/inputRate.js` with `uiohook-napi`: counts per second | Read the key from `.env`, never hard-code it |
| `main.js` → `preload.js` → debug panel showing all readings live | Blink **rate** per minute from the `blinked` flags |

**Done when:** `npm start` shows live window + input readings (Daniel's laptop) and live Presage readings (Teammate's laptop).
Merge both branches into `main`.

### Phase 2: end-to-end by midnight
| Daniel | Teammate |
|---|---|
| `src/main/recorder.js`: append every reading to `data/session-<date>.jsonl` | `src/engine/scoring.js`: baseline from the first ~3 min, z-scores, weighted focus score 0–100 and stress score, 1–2 min rolling average |
| `src/main/replay.js`: feed a recorded file in instead of live sources (saves Presage minutes) | Four states (body engaged/disengaged × on-task/distraction app) |
| Live view with chart.js (fake data first, then real scores) | Crash event: score below the personal threshold (bottom 20%) for 2+ min |
| Self-report pop-up | Test scoring by replaying Daniel's recordings |

**Done when:** one laptop runs camera → score → live chart, and every session is recorded.

### Phase 3: overnight
- [ ] Both record real work sessions with self-reports (as many Presage minutes as the trial allows).
- [ ] Record a "dull reading, then gripping reading, then LinkedIn" session: this is the demo script.

### Phase 4: Sunday until 10:30
| Daniel | Teammate |
|---|---|
| `src/engine/bandit.js`: epsilon-greedy over 4 arms (5-min break, 60-s breathing, switch task, push on); reward = how fast focus recovers | `src/engine/forecast.js`: logistic regression from scratch (sigmoid, log loss, gradient descent), label = "crash starts within 5 min" |
| Simulated user over 30 days, to show the bandit learning | `scripts/evaluate.js`: train on earlier sessions, test on later ones; compare with a fixed 25-min Pomodoro ("caught 7 of 9 vs 3") |
| Forecast line, countdown and recommendation in the live view | Threshold trade-off: false alarms vs missed crashes, pick and justify the point |
| Session summary screen | Hand the eval numbers and chart data to Daniel for the summary screen |

**Stretch, only if ahead:** multi-monitor calibration (brief section 4).

### 10:30 to 12:00
Feature freeze. Rehearse the demo, record a backup video, submit on Devpost **before 12:00**.

---

## Git workflow
1. Start of each task: `git switch main`, `git pull`, `git switch -c <yourname>/<task>`.
2. Commit small and often: `git add .`, `git commit -m "what you did"`.
3. Push your branch: `git push -u origin <yourname>/<task>`, then open a Pull Request on GitHub and merge it into `main`.
4. The other person then runs `git switch main`, `git pull` and carries on.
5. **Shared files** (`main.js`, `preload.js`, `config.js`, `package.json`): keep edits small and tell each other before
   changing them. These are where merge conflicts happen.

## Presage setup (Teammate)
1. Get an API key from physiology.presagetech.com.
2. Copy `.env.example` to `.env` and put the key after `PRESAGE_API_KEY=` (`.env` is gitignored; never commit it).
3. `npm install`, then `npm run presage-test`. Sit facing the camera in good light, chest visible.
4. Warm-up: pulse ~12 s, breathing ~30 s, HRV ~60 s. Vitals only flow while the check says OK (status 0).
5. Each run uses trial minutes: stop with Ctrl+C as soon as you've seen what you need.

## Open decision
- ML in plain JS (one runtime, runs live in the app; recommended) or Python + NumPy for offline training only?
  This plan assumes JS. Decide before Phase 4.
