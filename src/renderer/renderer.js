// Renderer: the UI code running inside the window (like a normal web page).
// It only sees what preload.js exposed on window.focusApi.

const v = window.focusApi.versions;
document.getElementById('versions').textContent = `Electron ${v.electron} · Node ${v.node}`;
document.getElementById('today-date').textContent =
  new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

// chart.js comes from `npm install`. If it's missing, say so instead of showing a blank dashboard.
if (typeof Chart === 'undefined') {
  document.getElementById('state-label').textContent = 'Setup problem';
  document.getElementById('state-message').textContent =
    "The chart library is missing. Close the app, run 'npm install' in the project folder, then 'npm start' again.";
  throw new Error('chart.js not found: run npm install');
}

const WINDOW_MINUTES = 30; // how much history the chart shows
let sessionStart = Date.now();
let lastOutputTime = sessionStart;
let baseline = null; // debugging: { n, mean, sd } alert.js compares focus against, or null

// How each state is shown: headline, colour, and a plain-language line.
const STATES = {
  flow:     { label: 'In flow.',      color: '#2f7d5b', message: "You're on your work. We'll stay quiet." },
  hooked:   { label: 'Hooked.',       color: '#c2532d', message: "You're busy, but on a distraction." },
  zonedOut: { label: 'Zoned out.',    color: '#4f6d9a', message: "Work is open but nothing's happening. A short break or a change of task might help." },
  break:    { label: 'On a break.',   color: '#8a8378', message: "Take your time. We'll help you ease back in." },
  neutral:  { label: 'Neutral.',      color: '#8a8378', message: 'Not on work or a distraction right now.' },
  unknown:  { label: 'Not sure yet.', color: '#a39d92', message: "Open your work and we'll pick it up." },
};

// What the chart can show, picked in the dropdown.
// get(reading) returns the number, or undefined if this reading doesn't contain it.
// perMinute = show the total over the last 60 seconds (smoother than per-second counts).
// yMin/yMax = fixed axis range (undefined = fit to the data). Counts start at 0, never below.
// Heart rate, breathing and HRV switch on by themselves once readings with those fields arrive.
const SIGNALS = {
  focus:     { label: 'Focus',                   color: '#1d1b18', yMin: 0, yMax: 100 }, // filled in by showOutput()
  pulse:     { label: 'Heart rate (bpm)',        color: '#b03a48', get: (r) => r.pulse },
  breathing: { label: 'Breathing (per min)',     color: '#3f7f8c', get: (r) => r.breathing },
  hrv:       { label: 'HRV (ms)',                color: '#6b5a8e', get: (r) => r.hrv },
  blinks:    { label: 'Blinks per minute',       color: '#6b5a8e', get: (r) => r.blinks, perMinute: true, yMin: 0 },
  gazeH:     { label: 'Gaze left–right',         color: '#3f7f8c', get: (r) => r.gazeH, yMin: 0, yMax: 1 },
  gazeV:     { label: 'Gaze up–down',            color: '#3f7f8c', get: (r) => r.gazeV, yMin: 0, yMax: 1 },
  keys:      { label: 'Keys per minute',         color: '#a8641f', get: (r) => (r.source === 'input' ? r.keys : undefined), perMinute: true, yMin: 0 },
  clicks:    { label: 'Clicks per minute',       color: '#a8641f', get: (r) => (r.source === 'input' ? r.clicks : undefined), perMinute: true, yMin: 0 },
  switches:  { label: 'App switches per minute', color: '#a8641f', get: (r) => (r.source === 'window' ? (r.switched ? 1 : 0) : undefined), perMinute: true, yMin: 0 },
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
  gradient.addColorStop(0, color + '22');
  gradient.addColorStop(1, color + '00');
  return gradient;
}

// The focus line takes the colour of the state at that moment (green in flow, rust when hooked, ...).
// Other signals use their own single colour.
function segmentColor(context) {
  if (selected !== 'focus') return SIGNALS[selected].color;
  return (STATES[context.p1.raw.state] || STATES.unknown).color;
}

Chart.defaults.color = '#6f6a60';
Chart.defaults.font.family = '"Segoe UI", system-ui, -apple-system, sans-serif';

const chart = new Chart(document.getElementById('chart'), {
  type: 'line',
  data: {
    datasets: [{
      data: [],
      borderColor: SIGNALS.focus.color,
      segment: { borderColor: segmentColor },
      backgroundColor: fadeFill,
      fill: true,
      borderWidth: 2.5,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: '#f6f3ec',
      pointHoverBorderWidth: 2,
      tension: 0.3,
    },
    // Debugging: the mean focus alert.js compares against, with a ±1 standard deviation band.
    // Each is a flat line across the chart; see showBaseline().
    { data: [], borderWidth: 0, pointRadius: 0, fill: false },                      // 1: mean - sd
    { data: [], borderWidth: 0, pointRadius: 0, fill: '-1', backgroundColor: '#4f6d9a22' }, // 2: mean + sd, shaded down to 1
    { data: [], borderWidth: 1.5, borderDash: [6, 4], borderColor: '#4f6d9a', pointRadius: 0, fill: false }, // 3: mean
    ],
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
        filter: (item) => item.datasetIndex === 0, // only the signal itself, not the baseline lines
        displayColors: false,
        backgroundColor: '#fffdf8',
        titleColor: '#6f6a60',
        bodyColor: '#1d1b18',
        borderColor: '#ddd6c8',
        borderWidth: 1,
        cornerRadius: 3,
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
        border: { color: '#1d1b18' },
      },
      y: {
        min: 0,
        max: 100,
        grid: { color: '#e6e0d3' },
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
  showBaseline();
  chart.update('none');

  document.getElementById('chart-title').textContent = `${signal.label}, last ${WINDOW_MINUTES} minutes`;
  document.getElementById('chart-note').textContent = key === 'focus'
    ? 'For now this is a rough estimate from your apps and activity. The full focus score is on its way.'
    : '';
}

// Remove points older than the chart's time window.
function trimOld(points, now) {
  const start = now - WINDOW_MINUTES * 60 * 1000;
  while (points.length && points[0].x < start) points.shift();
}

// Add one value to a signal's history; switch on its dropdown option the first time.
function addPoint(key, t, y, state) {
  if (!series[key]) {
    series[key] = [];
    const option = select.querySelector(`option[value="${key}"]`);
    option.disabled = false;
    option.textContent = SIGNALS[key].label;
    if (key === selected) chart.data.datasets[0].data = series[key];
  }
  series[key].push({ x: t, y, state }); // state: only for focus points, to colour the line
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

// ---- Sensors: one card per sensor, in plain words ----

// Turning raw values into readable text.
const CATEGORY_TEXT = { 'on-task': 'Work', distraction: 'Distraction', neutral: 'Neutral', self: 'Focus Forecast', unknown: 'Unknown' };
const TRIGGER_TEXT = { endOfSession: 'At the end of a session', returnFromAway: 'After coming back from a break' };
const CAMERA_TEXT = { 0: 'OK', 2: 'Several faces', 5: 'Too dark', 7: 'Chest not visible' };
const yesNo = (value) => (value ? 'Yes' : 'No');
const twoDecimals = (value) => (value === null || value === undefined ? '–' : value.toFixed(2));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const duration = (s) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`);
const cameraText = (r) => (r.status === null ? 'Starting' : CAMERA_TEXT[r.status] ?? `Code ${r.status}`);
const lookingText = (r) => (r.lookingAt === null || r.lookingAt === undefined ? 'Not calibrated'
  : r.lookingAt === 'away' ? 'Away from screens' : `Screen ${r.lookingAt + 1}`);
const expressionText = (r) => (r.expression
  ? `${r.expression[0].toUpperCase()}${r.expression.slice(1)} (${r.expressionConfidence}%)` : '–');

// For each sensor: name, colour, a one-line summary (shown while closed) and the fields (shown when opened).
const SENSORS = {
  window: {
    name: 'Screen',
    color: '#4f6d9a',
    summary: (r) => `${r.app ?? 'No window'} · ${CATEGORY_TEXT[r.category] ?? r.category}`,
    fields: [
      ['App in front', (r) => r.app ?? '–'],
      ['Counts as', (r) => CATEGORY_TEXT[r.category] ?? r.category],
      ['Just switched app', (r) => yesNo(r.switched)],
    ],
  },
  input: {
    name: 'Keyboard & mouse',
    color: '#a8641f',
    summary: (r) => `${plural(r.keys, 'key')} · ${plural(r.clicks, 'click')} in the last second`,
    fields: [
      ['Keys pressed', (r) => r.keys],
      ['Clicks', (r) => r.clicks],
      ['Scrolls', (r) => r.scrolls],
      ['Mouse moved', (r) => yesNo(r.mouseMoved)],
    ],
  },
  face: {
    name: 'Face (webcam)',
    color: '#6b5a8e',
    summary: (r) => (r.status === 0 ? `${lookingText(r)} · ${expressionText(r)}` : `Camera: ${cameraText(r)}`),
    fields: [
      ['Camera check', cameraText],
      ['Looking at', lookingText],
      ['Expression', expressionText],
      ['Blinks', (r) => r.blinks],
      ['Eyes shut for', (r) => (r.eyesClosedMs ? `${(r.eyesClosedMs / 1000).toFixed(1)} s` : 'Open')],
      ['Heart rate', (r) => (r.pulse === null || r.pulse === undefined ? 'Warming up' : `${Math.round(r.pulse)} bpm`)],
      ['Breathing', (r) => (r.breathing === null || r.breathing === undefined ? 'Warming up' : `${r.breathing.toFixed(1)} per min`)],
      ['HRV', (r) => (r.hrv === null || r.hrv === undefined ? 'Warming up' : `${Math.round(r.hrv)} ms`)],
      ['Talking', (r) => yesNo(r.talking)],
      ['Eyes left–right', (r) => twoDecimals(r.gazeH)],
      ['Eyes up–down', (r) => twoDecimals(r.gazeV)],
      ['Head left–right', (r) => twoDecimals(r.headYaw)],
      ['Head up–down', (r) => twoDecimals(r.headPitch)],
    ],
  },
  away: {
    name: 'Last break',
    color: '#8a8378',
    summary: (r) => `Away for ${duration(r.seconds)}`,
    fields: [
      ['Away for', (r) => duration(r.seconds)],
      ['Came back at', (r) => new Date(r.t).toLocaleTimeString()],
    ],
  },
  selfReport: {
    name: 'Last self-report',
    color: '#2f7d5b',
    summary: (r) => `${r.rating}/5 · ${TRIGGER_TEXT[r.trigger] ?? r.trigger}`,
    fields: [
      ['Your rating', (r) => `${r.rating} out of 5`],
      ['Asked', (r) => TRIGGER_TEXT[r.trigger] ?? r.trigger],
      ['Answered at', (r) => new Date(r.t).toLocaleTimeString()],
    ],
  },
};
const SENSOR_ORDER = Object.keys(SENSORS); // cards always appear in this order

// Any other source (e.g. heart-rate readings added later): show its fields as they are.
function genericSensor(source) {
  return {
    name: source,
    color: '#a39d92',
    summary: () => '',
    fields: null, // null = list every field
  };
}

const rawPanels = {}; // source -> { summary, time, grid, sensor }, created the first time that sensor reports

function makeElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function createPanel(source) {
  const sensor = SENSORS[source] || genericSensor(source);
  const container = document.getElementById('raw');
  if (!Object.keys(rawPanels).length) container.replaceChildren(); // drop "Waiting…"

  const details = makeElement('details', 'sensor');
  details.style.setProperty('--sensor', sensor.color);
  const head = makeElement('summary');
  const title = makeElement('div', 'sensor-title');
  title.append(makeElement('span', 'sensor-dot'), makeElement('strong', '', sensor.name));
  const summary = makeElement('span', 'sensor-summary');
  const time = makeElement('span', 'sensor-time');
  head.append(title, summary, time, makeElement('span', 'chevron', '›'));
  const grid = makeElement('div', 'sensor-grid');
  details.append(head, grid);

  // Insert in SENSOR_ORDER position (unknown sources go last).
  const order = (s) => (SENSOR_ORDER.includes(s) ? SENSOR_ORDER.indexOf(s) : SENSOR_ORDER.length);
  details.dataset.order = order(source);
  const after = [...container.children].find((el) => Number(el.dataset.order) > order(source));
  container.insertBefore(details, after || null);

  return (rawPanels[source] = { summary, time, grid, sensor });
}

function showRaw(reading) {
  const panel = rawPanels[reading.source] || createPanel(reading.source);
  const { sensor } = panel;

  panel.summary.textContent = sensor.summary(reading);
  panel.time.textContent = new Date(reading.t).toLocaleTimeString();

  const fields = sensor.fields || Object.keys(reading)
    .filter((key) => key !== 't' && key !== 'source')
    .map((key) => [key, (r) => (typeof r[key] === 'number' ? twoDecimals(r[key]) : String(r[key] ?? '–'))]);
  panel.grid.replaceChildren(...fields.map(([label, value]) => {
    const cell = makeElement('div', 'field');
    cell.append(makeElement('span', 'field-label', label), makeElement('span', 'field-value', String(value(reading))));
    return cell;
  }));
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
let currentState = null;
let stateSince = null; // when the current state started, for "for 12 min"

function showOutput(output) {
  lastOutputTime = output.t;
  addPoint('focus', output.t, output.focus, output.state);

  // Slide the chart's time window so "now" is at the right edge.
  chart.options.scales.x.min = output.t - WINDOW_MINUTES * 60 * 1000;
  chart.options.scales.x.max = output.t;
  showBaseline();
  chart.update('none');

  // "Right now": headline in the state's colour, a plain-language line, and how long it's lasted.
  if (output.state !== currentState) {
    currentState = output.state;
    stateSince = output.t;
  }
  const state = STATES[output.state] || STATES.unknown;
  document.documentElement.style.setProperty('--state', state.color);
  document.getElementById('state-label').textContent = state.label;
  document.getElementById('state-message').textContent = output.onDashboard && output.state === 'hooked'
    ? "You're looking at Focus Forecast. Time here counts as time away from work."
    : state.message;
  const minutes = Math.floor((output.t - stateSince) / 60000);
  document.getElementById('state-for').textContent = minutes >= 1 ? `For ${minutes} min so far.` : '';

  updateSession(output);
}

// ---- Debugging: focus baseline from alert.js ----
// Draw the mean and ±1 sd as flat lines across the visible time range (focus chart only).
function showBaseline() {
  const { min, max } = chart.options.scales.x;
  const visible = selected === 'focus' && baseline && min !== undefined;
  const flat = (y) => (visible ? [{ x: min, y }, { x: max, y }] : []);
  chart.data.datasets[1].data = flat(baseline?.mean - baseline?.sd);
  chart.data.datasets[2].data = flat(baseline?.mean + baseline?.sd);
  chart.data.datasets[3].data = flat(baseline?.mean);
}

window.focusApi.onFocusBaseline((value) => { baseline = value; });

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

  currentState = null;
  document.documentElement.style.removeProperty('--state');
  document.getElementById('state-label').textContent = 'Starting…';
  document.getElementById('state-message').textContent = 'Waiting for data…';
  document.getElementById('state-for').textContent = '';
  document.getElementById('summary').hidden = true;
  document.getElementById('hero').hidden = false;
  document.getElementById('end-session').hidden = false;
  document.getElementById('live').hidden = false;
});

// ---- Incoming readings ----
window.focusApi.onReading((reading) => {
  // The focus score from score.js drives the headline, ring and chart rather than a sensor card.
  if (reading.source === 'focus') {
    showOutput(reading);
    return;
  }
  showRaw(reading);
  recordSignals(reading);
});
