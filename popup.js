const $ = (s) => document.querySelector(s);
const send = (m) => chrome.runtime.sendMessage(m);
const CIRC = 2 * Math.PI * 88;
const STATUS = { focus: 'Time to focus', short: 'Take a breather', long: 'Rest up' };
let S = null;

const pad = (n) => String(n).padStart(2, '0');
const clock = (sec) => `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
const dur = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };
const dayKey = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const remaining = (t) => t.status === 'running' ? Math.max(0, Math.round((t.endTime - Date.now()) / 1000)) : t.remaining;

function liveFocusSec() {   // time from the focus session in progress (not logged until it ends)
  const t = S.timer, tot = S.settings.focus * 60;
  return t.mode === 'focus' && t.status !== 'idle' ? tot - remaining(t) : 0;
}

function renderClock() {
  const t = S.timer, tot = S.settings[t.mode] * 60, r = remaining(t);
  $('#time').textContent = clock(r);
  $('#arc').style.strokeDashoffset = CIRC * (1 - r / tot) * 1;
  $('#arc').style.strokeDasharray = CIRC;
  document.title = t.status === 'running' ? `${clock(r)} · Pomodoro` : 'Pomodoro Study Tracker';
}

function renderStats() {
  const today = dayKey(new Date()), live = liveFocusSec();
  let week = 0, max = 1; const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = dayKey(d), sec = (S.log[k]?.sec || 0) + (k === today ? live : 0);
    days.push({ k, sec, label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), today: k === today });
    week += sec; max = Math.max(max, sec);
  }
  $('#today').textContent = dur((S.log[today]?.sec || 0) + live);
  $('#sessions').textContent = S.log[today]?.sessions || 0;
  $('#week').textContent = dur(week);
  $('#chart').innerHTML = days.map((d) =>
    `<div class="bar ${d.sec ? 'has' : ''} ${d.today ? 'today' : ''}" title="${d.k}: ${dur(d.sec)}">` +
    `<i style="height:${Math.max(3, (d.sec / max) * 60)}px"></i>${d.label}</div>`).join('');
}

function render() {
  const t = S.timer;
  document.body.dataset.mode = t.mode;
  $('#toggle').textContent = t.status === 'running' ? 'Pause' : t.status === 'paused' ? 'Resume' : 'Start';
  $('#status').textContent = t.status === 'paused' ? 'Paused' : STATUS[t.mode];
  renderClock(); renderStats();
}

function fillSettings() {
  for (const k of ['focus', 'short', 'long', 'longEvery']) $('#s-' + k).value = S.settings[k];
  $('#s-auto').checked = S.settings.auto;
}

async function act(m) { S = await send(m); render(); }

document.querySelectorAll('.modes button').forEach((b) => b.onclick = () => act({ type: 'mode', mode: b.dataset.mode }));
$('#toggle').onclick = () => act({ type: S.timer.status === 'running' ? 'pause' : 'start' });
$('#reset').onclick = () => act({ type: 'reset' });
$('#skip').onclick = () => act({ type: 'skip' });
$('#clear').onclick = () => confirm('Delete all study history?') && act({ type: 'clearData' });

document.querySelectorAll('.settings input').forEach((el) => el.onchange = () => {
  const n = (id, lo, hi, d) => Math.min(hi, Math.max(lo, parseInt($(id).value) || d));
  act({ type: 'settings', settings: {
    focus: n('#s-focus', 1, 180, 25), short: n('#s-short', 1, 60, 5), long: n('#s-long', 1, 90, 15),
    longEvery: n('#s-longEvery', 2, 10, 4), auto: $('#s-auto').checked } }).then(fillSettings);
});

(async () => {
  S = await send({ type: 'get' });
  fillSettings(); render();
  setInterval(() => { renderClock(); if (S.timer.status === 'running') renderStats(); }, 500);
  chrome.storage.onChanged.addListener(async () => { S = await send({ type: 'get' }); render(); });
})();
