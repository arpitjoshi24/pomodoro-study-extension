// Timer lives here (not in the popup) so it keeps running when the popup closes.
const DEFAULTS = { focus: 25, short: 5, long: 15, longEvery: 4, auto: false };
const COLORS = { focus: '#1B6B7A', short: '#D9972B', long: '#6C5B9E' };
const LABELS = { focus: 'Focus session', short: 'Short break', long: 'Long break' };

const dayKey = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

async function load() {
  const s = await chrome.storage.local.get({ settings: DEFAULTS, timer: null, log: {} });
  s.settings = { ...DEFAULTS, ...s.settings };
  if (!s.timer) s.timer = { mode: 'focus', status: 'idle', remaining: s.settings.focus * 60, endTime: null, round: 0 };
  return s;
}
const save = (s) => chrome.storage.local.set(s);
const total = (s, mode = s.timer.mode) => s.settings[mode] * 60;
const left = (t) => t.status === 'running' ? Math.max(0, Math.round((t.endTime - Date.now()) / 1000)) : t.remaining;

function addLog(s, sec, finished) {
  const k = dayKey();
  const e = s.log[k] || { sec: 0, sessions: 0 };
  e.sec += Math.max(0, Math.round(sec));
  if (finished) e.sessions += 1;
  s.log[k] = e;
}

function logPartial(s) {            // keep study time when a focus session is cut short
  if (s.timer.mode === 'focus' && s.timer.status !== 'idle') addLog(s, total(s) - left(s.timer), false);
  else if (s.timer.mode === 'focus' && s.timer.remaining < total(s)) addLog(s, total(s) - s.timer.remaining, false);
}

function setMode(s, mode) {
  s.timer = { ...s.timer, mode, status: 'idle', remaining: total(s, mode), endTime: null };
  chrome.alarms.clearAll();
}

function startTimer(s) {
  s.timer.status = 'running';
  s.timer.endTime = Date.now() + s.timer.remaining * 1000;
  chrome.alarms.create('done', { when: s.timer.endTime });
  chrome.alarms.create('tick', { periodInMinutes: 1 });
}

async function complete() {
  const s = await load();
  if (s.timer.status !== 'running') return;
  const wasFocus = s.timer.mode === 'focus';
  if (wasFocus) { addLog(s, total(s), true); s.timer.round += 1; }
  const next = wasFocus ? (s.timer.round % s.settings.longEvery === 0 ? 'long' : 'short') : 'focus';
  setMode(s, next);
  if (s.settings.auto) startTimer(s);
  await save(s);
  chrome.notifications.create({
    type: 'basic', iconUrl: 'icons/icon128.png',
    title: wasFocus ? 'Focus session done 🎉' : 'Break over',
    message: wasFocus ? `Nice work. Up next: ${LABELS[next].toLowerCase()}.` : 'Ready for the next focus session?'
  });
  badge(s);
}

function badge(s) {
  const t = s.timer;
  if (t.status === 'running') {
    chrome.action.setBadgeText({ text: String(Math.ceil(left(t) / 60)) });
    chrome.action.setBadgeBackgroundColor({ color: COLORS[t.mode] });
  } else chrome.action.setBadgeText({ text: t.status === 'paused' ? '||' : '' });
}

const actions = {
  async get() {},
  async start(s) { if (s.timer.status !== 'running') startTimer(s); },
  async pause(s) {
    if (s.timer.status !== 'running') return;
    s.timer.remaining = left(s.timer); s.timer.status = 'paused'; s.timer.endTime = null;
    chrome.alarms.clearAll();
  },
  async reset(s) { logPartial(s); setMode(s, s.timer.mode); },
  async skip(s) {
    logPartial(s);
    const wasFocus = s.timer.mode === 'focus';
    setMode(s, wasFocus ? 'short' : 'focus');
  },
  async mode(s, m) { logPartial(s); setMode(s, m.mode); },
  async settings(s, m) {
    s.settings = { ...s.settings, ...m.settings };
    if (s.timer.status === 'idle') s.timer.remaining = total(s);
  },
  async clearData(s) { s.log = {}; s.timer.round = 0; }
};

chrome.runtime.onMessage.addListener((m, _sender, reply) => {
  (async () => {
    const s = await load();
    await actions[m.type](s, m);
    await save(s);
    badge(s);
    reply(s);
  })();
  return true;
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'done') complete();
  if (a.name === 'tick') badge(await load());
});

// If the browser was closed when the timer ended, finish it on next start.
(async () => {
  const s = await load();
  if (s.timer.status === 'running' && s.timer.endTime <= Date.now()) complete();
  else badge(s);
})();
