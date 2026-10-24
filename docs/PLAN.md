# Focus Forecast: how it fits together

## How things connect

Every second:

```
windowTracker.js ─┐
inputRate.js ─────┼──► main.js ──► recorder.js        (saves the data)
presage.js ───────┘       │
                          ├──► scoring.js ──► forecast.js ──► bandit.js   (works out focus, risk, advice)
                          │
                          └──► preload.js ──► renderer.js / index.html   (shows it on screen)
```

`main.js` is the boss: it collects data from the sensor files, passes it to the others, and sends the result to the screen.

## What each file does

**Collecting data** (`src/main/`)
- `windowTracker.js`: which app is open, whether it's work or a distraction, and whether you just switched. (Daniel)
- `inputRate.js`: how many keys and clicks per second. Counts only, never which keys. (Daniel)
- `presageFace.js`: blinks, talking, eye gaze and expression from the webcam (Presage). Only runs when
  `.env` has `USE_PRESAGE=1`, because it uses trial minutes. Pulse/HRV/breathing to add if a camera can get them. (Teammate)

**Running and saving** (`src/main/`)
- `main.js`: starts the app and runs the every-second loop. (Shared)
- `recorder.js`: saves every reading as one line in `data/session-<date>_<time>.jsonl`, one file per run.
  All sessions are kept (about 1.5 MB per hour), so sessions can be replayed and used for training. (Daniel)

**Thinking** (`src/engine/`)
- `scoring.js`: turns the data into a focus score and a state (flow, hooked, zoned out, break). (Teammate)
  Uses two baselines:
  - **Long-term** ("normal you"), from all past sessions, updated slowly (90% old + 10% today) so one bad
    day doesn't become the new normal. Used for "you're more stressed than usual today".
  - **This session** ("you today"), from the first few minutes. Used for "focus is dropping right now".
- `forecast.js`: ML. Predicts the chance you'll lose focus in the next 5 minutes. (Teammate)
- `bandit.js`: ML. Picks advice (break, breathing, switch task, push on) and learns what works. (Daniel)

**Showing it**
- `preload.js`: the bridge that lets data pass from `main.js` to the window. (Shared)
- `renderer/index.html` + `renderer.js`: the window: focus chart, current state, advice. (Daniel)

**Settings**
- `config.js`: all the numbers we might want to tweak, in one place. (Shared)
