// Settings panel: edit the user's settings file from the dashboard.
// Every change is saved straight away (main.js -> config.js -> ~/.config/focus-forecast/config.json)
// and applies within a second, no restart needed.

const settingsApi = window.focusApi.settings;
const drawer = document.getElementById('settings');
const backdrop = document.getElementById('settings-backdrop');
let current = null; // the latest settings from the file

// ---- Open / close ----
function openSettings() {
  settingsApi.get().then(render);
  drawer.hidden = false;
  backdrop.hidden = false;
}
function closeSettings() {
  drawer.hidden = true;
  backdrop.hidden = true;
}
document.getElementById('open-settings').addEventListener('click', openSettings);
document.getElementById('close-settings').addEventListener('click', closeSettings);
backdrop.addEventListener('click', closeSettings);

// ---- Editable lists ----
// Each list: where it lives in the settings, and whether words are lowercased
// (app/site matching is lowercase; suggestions keep their capitals).
const LISTS = {
  onTask:      { get: (s) => s.categories.onTask,      save: (list) => ({ categories: { onTask: list } }),      lower: true },
  distraction: { get: (s) => s.categories.distraction, save: (list) => ({ categories: { distraction: list } }), lower: true },
  suggestions: { get: (s) => s.Iterations || [],       save: (list) => ({ Iterations: list }),                  lower: false },
};

async function saveList(key, list) {
  render(await settingsApi.update(LISTS[key].save(list)));
}

function renderList(key) {
  const container = document.getElementById(`list-${key}`);
  const items = LISTS[key].get(current);
  container.replaceChildren(...items.map((item, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = item;
    const remove = document.createElement('button');
    remove.textContent = '×';
    remove.title = 'Remove';
    remove.addEventListener('click', () => saveList(key, items.filter((_, j) => j !== i)));
    chip.appendChild(remove);
    return chip;
  }));
}

// "Add" forms: <form data-list="onTask"> with one text box.
for (const form of document.querySelectorAll('form[data-list]')) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const key = form.dataset.list;
    const input = form.querySelector('input');
    let value = input.value.trim();
    if (LISTS[key].lower) value = value.toLowerCase();
    const items = LISTS[key].get(current);
    if (value && !items.includes(value)) saveList(key, [...items, value]);
    input.value = '';
  });
}

// ---- Numbers ----
const NUMBERS = {
  'away-minutes':  { get: (s) => s.selfReport.awayMinutes,     save: (n) => ({ selfReport: { awayMinutes: n } }) },
  'popup-seconds': { get: (s) => s.selfReport.popupTimeoutSec, save: (n) => ({ selfReport: { popupTimeoutSec: n } }) },
};
for (const [id, setting] of Object.entries(NUMBERS)) {
  const input = document.getElementById(id);
  input.addEventListener('change', async () => {
    const n = Number(input.value);
    if (n >= Number(input.min)) render(await settingsApi.update(setting.save(n)));
    else input.value = setting.get(current); // invalid: put the saved value back
  });
}

// ---- Reset (click twice to confirm) ----
const resetButton = document.getElementById('reset-settings');
let resetArmed = false;
resetButton.addEventListener('click', async () => {
  if (!resetArmed) {
    resetArmed = true;
    resetButton.textContent = 'Click again to reset everything';
    setTimeout(() => { resetArmed = false; resetButton.textContent = 'Reset to defaults'; }, 4000);
    return;
  }
  resetArmed = false;
  resetButton.textContent = 'Reset to defaults';
  render(await settingsApi.reset());
});

// Show the settings in the panel.
function render(settings) {
  current = settings;
  for (const key of Object.keys(LISTS)) renderList(key);
  for (const [id, setting] of Object.entries(NUMBERS)) document.getElementById(id).value = setting.get(settings);
}
