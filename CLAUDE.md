# Focus Forecast (OxHack 26)

Laptop app that reads attention and stress from the webcam (Presage SmartSpectra), combines it with
on-screen activity, predicts focus crashes, recommends an intervention and learns what works.
Hacking ends Sun 25 Oct 2026, 12:00. Team of 2 (work split and timeline: docs/PLAN.md). Full brief: Focus_Forecast_Project_Brief.pdf (ask the user for it).

## Working with Daniel
- New to git and terminals: give one step at a time, wait for their output before the next step.
- Works in Windows PowerShell + Windows VS Code (moved off WSL: no webcam/GUI there).
- Never ask for or print the Presage API key; it goes in `.env` / `$env:PRESAGE_API_KEY`.

## Stack (decided)
- Electron app, Node.js 24, Presage `@smartspectra/node-sdk` in the Electron main process.
- Handmade ML (logistic regression, epsilon-greedy bandit) written from scratch, no ML libraries.
  Language not decided yet: plain JS (recommended, single runtime) vs Python+NumPy for offline training only.
- Planned packages: electron, @smartspectra/node-sdk, chart.js, get-windows, uiohook-napi.
- All weights, thresholds and window lengths go in one config file.

## Planned layout
src/main/ (main.js, presage.js, windowTracker.js, inputRate.js, recorder.js),
src/engine/ (scoring.js, forecast.js, bandit.js: pure JS, testable on recorded sessions),
src/preload.js, src/renderer/ (UI), scripts/ (training/eval), data/ (gitignored recordings).

## Presage findings (from testing in C:\Users\danie\presage-test\test.mjs)
- Decoded fields: metrics.cardio.pulseRate[-1].value/.confidence, metrics.cardio.hrv[-1].rmssd,
  metrics.breathing.rate[-1].value, metrics.face.blinking[].detected, metrics.face.talking[].detected.
- Vitals only flow while validationStatus is 0 (OK). Code 7 = chest not visible (needed for breathing),
  2 = multiple faces, 5 = too dark. Warm-up: pulse ~12 s, breathing ~30 s, HRV ~60 s.
- Daniel's laptop: Windows TPM fails to decrypt Presage's saved device key on every run after the first
  ("NCryptDecrypt failed ... -2144845823" then "SmartSpectra configuration failed"). Workaround: rename
  %LOCALAPPDATA%\Presage\Physiology\com_presagetech_smartspectra_emd\emd\device_keys.secure before a run.
  Its ASUS webcam also has no auto-exposure lock. Prefer the Linux teammate's laptop for live Presage.
- Trial is 50 minutes of Presage use: develop against recorded sessions, not live camera.
