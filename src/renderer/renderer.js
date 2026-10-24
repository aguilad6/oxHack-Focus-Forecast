// Renderer: the UI code running inside the window (like a normal web page).
// It only sees what preload.js exposed on window.focusApi.

const v = window.focusApi.versions;
document.getElementById('versions').textContent = `Electron ${v.electron} · Node ${v.node}`;

const WINDOW_MINUTES = 30; // how much history the chart shows
let sessionStart = Date.now();
let lastOutputTime = sessionStart;

// How each state is shown: name, colour, and a plain-language line.
const STATES = {
  flow:     { label: 'Flow',      color: '#3ecf8e', message: "You're focused on work. Stay with it — we'll keep quiet." },
  hooked:   { label: 'Hooked',    color: '#f5a524', message: "You're engaged, but on a distraction. Time is slipping by." },
  zonedOut: { label: 'Zoned out', color: '#8f9cf2', message: "Work is open, but you've gone quiet. A short break or a switch might help." },
  break:    { label: 'Break',     color: '#9aa3b5', message: "Taking a break. Enjoy it — we'll help you get back." },
  checkingIn: { label: 'Checking in', color: '#59627a', message: "You're looking at Focus Forecast. Head back to your work when you're ready." },
  neutral:  { label: 'Neutral',   color: '#7a8296', message: 'Not on work or a distraction right now.' },
  unknown:  { label: 'Unknown',   color: '#59627a', message: "Can't tell yet. Open your work and we'll pick it up." },
};

// What the chart can show, picked in the dropdown.
// get(reading) returns the number, or undefined if this reading doesn't contain it.
// perMinute = show the total over the last 60 seconds (smoother than per-second counts).
// yMin/yMax = fixed axis range (undefined = fit to the data). Counts start at 0, never below.
// Heart rate, breathing and HRV switch on by themselves once readings with those fields arrive.
const SIGNALS = {
  focus:     { label: 'Focus',                   color: '#6c8cff', yMin: 0, yMax: 100 }, // filled in by showOutput()
  pulse:     { label: 'Heart rate (bpm)',        color: '#ff6b8a', get: (r) => r.pulse },
  breathing: { label: 'Breathing (per min)',     color: '#4cc9f0', get: (r) => r.breathing },
  hrv:       { label: 'HRV (ms)',                color: '#c77dff', get: (r) => r.hrv },
  blinks:    { label: 'Blinks per minute',       color: '#c77dff', get: (r) => r.blinks, perMinute: true, yMin: 0 },
  gazeH:     { label: 'Gaze left–right',         color: '#4cc9f0', get: (r) => r.gazeH, yMin: 0, yMax: 1 },
  gazeV:     { label: 'Gaze up–down',            color: '#4cc9f0', get: (r) => r.gazeV, yMin: 0, yMax: 1 },
  keys:      { label: 'Keys per minute',         color: '#f5a524', get: (r) => (r.source === 'input' ? r.keys : undefined), perMinute: true, yMin: 0 },
  clicks:    { label: 'Clicks per minute',       color: '#f5a524', get: (r) => (r.source === 'input' ? r.clicks : undefined), perMinute: true, yMin: 0 },
  switches:  { label: 'App switches per minute', color: '#f5a524', get: (r) => (r.source === 'window' ? (r.switched ? 1 : 0) : undefined), perMinute: true, yMin: 0 },
};

let selected = 'focus';
const series = {}; // signal key -> [{ x: time, y: value }] for the last 30 minutes
const recent = {}; // signal key -> last 60 raw values, for per-minute totals

// ---- Chart ----

// "now", "45 s ago", "3 min 10 s ago"
function timeAgo(ms) {
  const s = Math.round(ms / 1000);
  if (s <= 0) return 'now';
  if (s < 60) return `${s} s ago`;
  return `${Math.floor(s / 60)} min ${s % 60} s ago`;
}

// Soft fill under the line: the line's colour fading to transparent towards the bottom.
function fadeFill(context) {
  const { ctx, chartArea } = context.chart;
  if (!chartArea) return 'transparent'; // not laid out yet
  const color = SIGNALS[selected].color;
  const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  gradient.addColorStop(0, color + '55');
  gradient.addColorStop(1, color + '00');
  return gradient;
}

Chart.defaults.color = '#8b93a7';
Chart.defaults.font.family = '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif';

const chart = new Chart(document.getElementById('chart'), {
  type: 'line',
  data: {
    datasets: [{
      data: [],
      borderColor: SIGNALS.focus.color,
      backgroundColor: fadeFill,
      fill: true,
      borderWidth: 2.5,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: '#fff',
      tension: 0.35,
    }],
  },
  options: {
    animation: false,
    responsive: true,
    maintainAspectRatio: false,
    // Hovering anywhere above/below the line picks the nearest point in time.
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        backgroundColor: '#0b0f19',
        borderColor: '#2b3448',
        borderWidth: 1,
        padding: 10,
        callbacks: {
          title: (items) => timeAgo(items[0].chart.options.scales.x.max - items[0].parsed.x),
          label: (item) => `${SIGNALS[selected].label}: ${Number(item.parsed.y.toFixed(2))}`,
        },
      },
    },
    scales: {
      x: {
        type: 'linear', // x = time in ms; min/max slide forward every second
        ticks: {
          stepSize: 5 * 60 * 1000,
          // Label as minutes before now: "-30 min" ... "now". (`this` is the x axis; this.max = now.)
          callback: function (value) {
            const minutes = Math.round((value - this.max) / 60000);
            return minutes === 0 ? 'now' : `${minutes} min`;
          },
        },
        grid: { display: false },
        border: { color: '#232b3c' },
      },
      y: {
        min: 0,
        max: 100,
        grid: { color: '#1f2636' },
        border: { display: false },
      },
    },
  },
});

// Show the chosen signal in the chart.
function showSignal(key) {
  selected = key;
  const signal = SIGNALS[key];
  const dataset = chart.data.datasets[0];
  dataset.data = series[key] || [];
  dataset.borderColor = signal.color;
  chart.options.scales.y.min = signal.yMin;
  chart.options.scales.y.max = signal.yMax;
  chart.update('none');

  document.getElementById('chart-title').textContent = `${signal.label} · last ${WINDOW_MINUTES} minutes`;
  document.getElementById('chart-note').textContent = key === 'focus'
    ? 'Temporary estimate from app and activity only, until the real focus score is ready.'
    : '';
}

// Remove points older than the chart's time window.
function trimOld(points, now) {
  const start = now - WINDOW_MINUTES * 60 * 1000;
  while (points.length && points[0].x < start) points.shift();
}

// Add one value to a signal's history; switch on its dropdown option the first time.
function addPoint(key, t, y) {
  if (!series[key]) {
    series[key] = [];
    const option = select.querySelector(`option[value="${key}"]`);
    option.disabled = false;
    option.textContent = SIGNALS[key].label;
    if (key === selected) chart.data.datasets[0].data = series[key];
  }
  series[key].push({ x: t, y });
  trimOld(series[key], t);
}

// ---- Dropdown ----
const select = document.getElementById('signal-select');
for (const [key, signal] of Object.entries(SIGNALS)) {
  const option = document.createElement('option');
  option.value = key;
  option.textContent = `${signal.label} (no data yet)`;
  option.disabled = true;
  select.appendChild(option);
}
select.value = 'focus';
select.addEventListener('change', () => showSignal(select.value));
showSignal('focus');

// Store every signal found in this reading.
function recordSignals(reading) {
  for (const [key, signal] of Object.entries(SIGNALS)) {
    if (!signal.get) continue;
    const value = signal.get(reading);
    if (value === undefined) continue;

    let y = value; // null = no value this second (e.g. face turned away): leaves a gap in the line
    if (signal.perMinute) {
      recent[key] = recent[key] || [];
      recent[key].push(value || 0);
      if (recent[key].length > 60) recent[key].shift();
      y = recent[key].reduce((sum, n) => sum + n, 0);
    }
    addPoint(key, reading.t, y);
  }
}

// ---- Raw readings: one dropdown per sensor ----
const SOURCE_LABELS = {
  window: 'Screen (window tracker)',
  input: 'Keyboard & mouse',
  face: 'Face (Presage)',
  away: 'Last time away',
  selfReport: 'Last self-report',
};
const FIELD_LABELS = {
  app: 'App', category: 'Category', switched: 'Just switched',
  keys: 'Keys', clicks: 'Clicks', scrolls: 'Scrolls', mouseMoved: 'Mouse moved',
  status: 'Camera check', blinks: 'Blinks', talking: 'Talking', gazeH: 'Gaze left–right', gazeV: 'Gaze up–down',
  expression: 'Expression', expressionConfidence: 'Expression confidence (%)',
  pulse: 'Heart rate (bpm)', breathing: 'Breathing (per min)', hrv: 'HRV (ms)',
  seconds: 'Seconds away', rating: 'Rating (1–5)', trigger: 'Asked when',
};
const CAMERA_CHECK = { 0: 'OK', 2: 'several faces', 5: 'too dark', 7: 'chest not visible' };

function formatValue(key, value) {
  if (value === null || value === undefined) return '–';
  if (key === 'status') return CAMERA_CHECK[value] ? `${value} (${CAMERA_CHECK[value]})` : String(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number' && !Number.isInteger(value)) return value.toFixed(2);
  return String(value);
}

const rawPanels = {}; // source -> { time, table }, created the first time that sensor reports

function showRaw(reading) {
  let panel = rawPanels[reading.source];
  if (!panel) {
    if (!Object.keys(rawPanels).length) document.getElementById('raw').replaceChildren(); // drop "Waiting…"
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    const name = document.createElement('span');
    name.textContent = SOURCE_LABELS[reading.source] || reading.source;
    const time = document.createElement('span');
    time.className = 'time';
    summary.append(name, time);
    const table = document.createElement('table');
    details.append(summary, table);
    document.getElementById('raw').appendChild(details);
    panel = rawPanels[reading.source] = { time, table };
  }

  panel.time.textContent = new Date(reading.t).toLocaleTimeString();
  const rows = Object.entries(reading)
    .filter(([key]) => key !== 't' && key !== 'source')
    .map(([key, value]) => {
      const row = document.createElement('tr');
      const label = document.createElement('th');
      label.textContent = FIELD_LABELS[key] || key;
      const cell = document.createElement('td');
      cell.textContent = formatValue(key, value);
      row.append(label, cell);
      return row;
    });
  panel.table.replaceChildren(...rows);
}

// ---- Session tiles and timer ----
const stateSeconds = { flow: 0, hooked: 0, zonedOut: 0 };

// 75 s -> "1 min", 3700 s -> "1 h 1 min"
function formatMinutes(seconds) {
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function updateSession(output) {
  if (output.state in stateSeconds) stateSeconds[output.state] += 1;
  for (const state of Object.keys(stateSeconds)) {
    document.getElementById(`time-${state}`).textContent = formatMinutes(stateSeconds[state]);
  }

  const s = Math.floor((output.t - sessionStart) / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  document.getElementById('session-time').textContent =
    `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

// ---- Focus output: { t, focus, state } once per second ----
function showOutput(output) {
  lastOutputTime = output.t;
  addPoint('focus', output.t, output.focus);

  // Slide the chart's time window so "now" is at the right edge.
  chart.options.scales.x.min = output.t - WINDOW_MINUTES * 60 * 1000;
  chart.options.scales.x.max = output.t;
  chart.update('none');

  // Ring and state text.
  const state = STATES[output.state] || STATES.unknown;
  const root = document.documentElement.style;
  root.setProperty('--state', state.color);
  document.getElementById('ring').style.setProperty('--p', output.focus ?? 0);
  document.getElementById('ring-label').textContent = state.label;
  document.getElementById('state-label').textContent = state.label;
  document.getElementById('state-message').textContent = state.message;

  updateSession(output);
}

// ---- Sessions ----
document.getElementById('end-session').addEventListener('click', () => window.focusApi.endSession());
document.getElementById('start-session').addEventListener('click', () => window.focusApi.startSession());

// Session over: swap the live state for a summary.
window.focusApi.onSessionEnded(({ rating }) => {
  const total = Math.max(1, Math.round((lastOutputTime - sessionStart) / 1000));
  document.getElementById('sum-deep').textContent = `${Math.round((stateSeconds.flow / total) * 100)}%`;
  const parts = [
    `${formatMinutes(total)} session`,
    `${formatMinutes(stateSeconds.flow)} deep focus`,
    `${formatMinutes(stateSeconds.hooked)} hooked`,
    `${formatMinutes(stateSeconds.zonedOut)} zoned out`,
  ];
  if (rating) parts.push(`you rated it ${rating}/5`);
  document.getElementById('sum-detail').textContent = parts.join(' · ');

  document.getElementById('summary').hidden = false;
  document.getElementById('hero').hidden = true;
  document.getElementById('end-session').hidden = true;
  document.getElementById('live').hidden = true;
});

// New session: clear the chart, tiles and timer, and show the live state again.
window.focusApi.onSessionStarted(({ t }) => {
  sessionStart = t;
  lastOutputTime = t;
  for (const key of Object.keys(series)) delete series[key];
  for (const key of Object.keys(recent)) delete recent[key];
  chart.data.datasets[0].data = [];
  chart.update('none');
  for (const state of Object.keys(stateSeconds)) stateSeconds[state] = 0;
  updateSession({ t, state: null });
  resetFakeScore();

  document.getElementById('state-label').textContent = 'Starting…';
  document.getElementById('ring-label').textContent = '…';
  document.getElementById('state-message').textContent = 'Waiting for data…';
  document.getElementById('summary').hidden = true;
  document.getElementById('hero').hidden = false;
  document.getElementById('end-session').hidden = false;
  document.getElementById('live').hidden = false;
});

// ---- Incoming readings ----
window.focusApi.onReading((reading) => {
  showRaw(reading);
  recordSignals(reading);

  // TEMPORARY: fake score until main.js sends the real one from scoring.js.
  const output = fakeScore(reading);
  if (output) showOutput(output);
});
