// ComLab dashboard — admin, technician and instructor views. No build step, no CDN:
// everything is served by the Raspberry Pi so it works without internet.
const $ = (s, el = document) => el.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = iso => (iso ? new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const time = iso => (iso ? new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : '');
const today = () => new Date().toLocaleDateString('en-CA');
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STATUS = { IDLE: 'Available', OFF: 'Off', IN_USE: 'In use', MAINTENANCE: 'Maintenance', OFFLINE: 'Offline', DISABLED: 'Disabled', UNKNOWN: 'Unknown' };
const label = s => STATUS[s] ?? String(s ?? '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
const badge = (s, text) => `<span class="badge s-${esc(s)}">${esc(text ?? label(s))}</span>`;

// Inline icon set (stroke icons, 24px grid) — bundled so the dashboard needs no CDN.
const ICONS = {
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  grid: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/>',
  map: '<path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3zM9 3v15M15 6v15"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7l10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V21h16"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  fingerprint: '<path d="M12 11v3a8 8 0 0 1-1 4M8 11a4 4 0 0 1 8 0v1M5 12a7 7 0 0 1 14 0v2a12 12 0 0 1-1 4M7.5 20a12 12 0 0 0 1.5-6v-3M12 2a10 10 0 0 1 10 10M2 12A10 10 0 0 1 6 4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  power: '<path d="M18.4 6.6a9 9 0 1 1-12.8 0M12 2v10"/>',
  wifiOff: '<path d="m2 2 20 20M8.5 16.5a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 4.2-2.7M10.7 5.1A15 15 0 0 1 22 8.8M5 12.9a10 10 0 0 1 5.2-2.8M12 20h.01"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
  tablet: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M12 18h.01"/>',
  move: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
};
const icon = n => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] ?? ''}</svg>`;
const initials = name => String(name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
const person = (name, sub) => `<span class="person"><span class="avatar">${esc(initials(name))}</span><span>${esc(name)}${sub ? `<br><small class="muted">${esc(sub)}</small>` : ''}</span></span>`;
const emptyState = (text, ic = 'inbox') => `<div class="empty">${icon(ic)}${esc(text)}</div>`;
const stat = (value, text, ic, tone = '') => `<div class="stat ${tone}"><b>${esc(value)}</b><span class="ic">${icon(ic)}</span><span>${esc(text)}</span></div>`;
document.querySelectorAll('[data-icon]').forEach(el => (el.innerHTML = icon(el.dataset.icon)));

// Theme: follows the system unless the user picks one (remembered per browser).
const THEME_KEY = 'comlab.theme';
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  $('#theme').innerHTML = `${icon(dark ? 'sun' : 'moon')} ${dark ? 'Light' : 'Dark'} mode`;
}
try { applyTheme(localStorage.getItem(THEME_KEY)); } catch { applyTheme(null); }
$('#theme').onclick = () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  applyTheme(next);
};
$('#logout').innerHTML = `${icon('logout')} Sign out`;

let token = sessionStorage.getItem('comlab.token');
let me = null, timer = null;

// ------------------------------------------------------------------ API
async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (r.status === 401 && path !== '/auth/login') { signOut(); throw new Error('Session expired. Sign in again.'); }
  if (!r.ok) throw new Error(data?.error ?? `Request failed (${r.status})`);
  return data;
}
async function download(path) {
  const r = await fetch(path, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) return toast((await r.json().catch(() => ({}))).error ?? 'Download failed', true);
  const name = /filename="?([^"]+)"?/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'export';
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = `show${err ? ' err' : ''}`;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), 3500);
}
const run = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

// ------------------------------------------------------------------ AUTH
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const r = await api('/auth/login', { method: 'POST', body: { username: f.get('username'), password: f.get('password') } });
    token = r.token; sessionStorage.setItem('comlab.token', token); e.target.reset(); $('#loginError').textContent = '';
    start();
  } catch (err) { $('#loginError').textContent = err.message; }
});
function signOut() {
  if (token) fetch('/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {});
  token = null; me = null; sessionStorage.removeItem('comlab.token'); clearInterval(timer);
  $('#shell').hidden = true; $('#login').hidden = false;
}
$('#logout').onclick = signOut;
$('#menu').onclick = () => $('.side').classList.toggle('open');

// ------------------------------------------------------------------ NAV
const ALL = ['admin', 'technician', 'instructor'], TECH = ['admin', 'technician'], ADMIN = ['admin'];
// [id, title, roles, render, icon, group]
const PAGES = [
  ['Monitoring'],
  ['overview', 'Overview', ALL, overview, 'grid'],
  ['attendance', 'Attendance', ALL, attendancePage, 'calendar'],
  ['class-attendance', 'Class attendance', ALL, classAttendancePage, 'list'],
  ['analytics', 'Analytics', ALL, analyticsPage, 'trend'],
  ['Laboratory'],
  ['workstations', 'Workstations & map', ALL, workstationsPage, 'map'],
  ['issues', 'Error reports', ALL, () => crudPage('issues'), 'alert'],
  ['maintenance', 'Maintenance logs', TECH, () => crudPage('maintenance'), 'wrench'],
  ['inventory', 'Inventory', TECH, () => crudPage('inventory'), 'box'],
  ['reports', 'Reports & analytics', ALL, reportsPage, 'chart'],
  ['Records'],
  ['students', 'Students', ALL, () => crudPage('students'), 'users'],
  ['classes', 'Class schedules', ALL, () => crudPage('classes'), 'clock'],
  ['sections', 'Sections', ALL, () => crudPage('sections'), 'layers'],
  ['subjects', 'Subjects', ALL, () => crudPage('subjects'), 'book'],
  ['System'],
  ['users', 'Staff accounts', ADMIN, () => crudPage('users'), 'shield'],
  ['fingerprints', 'Fingerprint sensor', ADMIN, fingerprintsPage, 'fingerprint'],
  ['settings', 'Settings & backup', ADMIN, settingsPage, 'settings'],
  ['audit', 'Activity log', ADMIN, auditPage, 'activity'],
  ['Account'],
  ['account', 'My account', ALL, accountPage, 'user'],
];
const groupOf = id => { let g = ''; for (const p of PAGES) { if (p.length === 1) g = p[0]; else if (p[0] === id) return g; } return ''; };
function renderNav() {
  let html = '', pending = null;
  for (const p of PAGES) {
    if (p.length === 1) { pending = p[0]; continue; }
    if (!p[2].includes(me.role)) continue;
    if (pending) { html += `<div class="group">${pending}</div>`; pending = null; }
    html += `<a href="#/${p[0]}" data-page="${p[0]}">${icon(p[4])}<span>${p[1]}</span></a>`;
  }
  $('#nav').innerHTML = html;
}
async function route() {
  clearInterval(timer);
  const id = location.hash.slice(2).split('?')[0] || 'overview';
  const page = PAGES.find(p => p[0] === id && p[2]?.includes(me.role)) ?? PAGES[1];
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.page === page[0]));
  $('.side').classList.remove('open');
  $('#title').textContent = page[1];
  $('#crumb').textContent = groupOf(page[0]);
  $('#view').innerHTML = '<p class="muted">Loading…</p>';
  await run(page[3])();
}
window.addEventListener('hashchange', () => me && route());
const tick = () => ($('#clock').textContent = `Live · ${new Date().toLocaleString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`);
tick(); setInterval(tick, 15000);

async function start() {
  try { me = await api('/me'); } catch { return signOut(); }
  $('#avatar').textContent = initials(me.name);
  $('#avatar').title = `${me.name} · ${label(me.role)}`;
  $('#login').hidden = true; $('#shell').hidden = false;
  renderNav(); route();
}

// ------------------------------------------------------------------ SHARED LOOKUPS
const cache = {};
async function lookup(name) {
  if (cache[name] && Date.now() - cache[name].at < 15000) return cache[name].rows;
  const rows = name === 'staff' ? (await api('/api/staff-directory')).rows : (await api(`/api/${name}`)).rows;
  cache[name] = { at: Date.now(), rows };
  return rows;
}
const invalidate = name => delete cache[name];

// ------------------------------------------------------------------ RESOURCE DEFINITIONS
// field: [key, label, type, options]; types: text, number, textarea, password, check, select, ref:<lookup>, time, day
const RES = {
  students: {
    title: 'Student', write: ADMIN,
    fields: [['id', 'Student ID', 'text', { key: true, placeholder: '2024-00123' }], ['name', 'Full name', 'text'], ['sectionId', 'Section', 'ref:sections'],
      ['active', 'Active', 'check', { default: true }]],
    cols: [['name', 'Student', r => person(r.name, r.id)], ['sectionId', 'Section', 'ref:sections'],
      ['fingerprintSlot', 'Fingerprint', r => (r.fingerprintSlot != null ? badge('active', `Enrolled · slot ${r.fingerprintSlot}`) : badge('inactive', 'Not enrolled'))],
      ['active', 'Status', r => badge(r.active ? 'active' : 'inactive', r.active ? 'Active' : 'Inactive')]],
    extra: r => (me.role === 'admin' ? `<button class="btn small" data-enroll="student:${esc(r.id)}">${r.fingerprintSlot != null ? 'Re-enroll' : 'Enroll'} finger</button>` : ''),
  },
  sections: {
    title: 'Section', write: ADMIN,
    fields: [['name', 'Section name', 'text', { placeholder: 'BSIT 2A' }], ['program', 'Program', 'text'], ['yearLevel', 'Year level', 'text']],
    cols: [['name', 'Section'], ['program', 'Program'], ['yearLevel', 'Year']],
  },
  subjects: {
    title: 'Subject', write: ADMIN,
    fields: [['code', 'Subject code', 'text', { placeholder: 'IT 201' }], ['title', 'Descriptive title', 'text']],
    cols: [['code', 'Code'], ['title', 'Title']],
  },
  classes: {
    title: 'Class schedule', write: ADMIN,
    fields: [['subjectId', 'Subject', 'ref:subjects'], ['sectionId', 'Section', 'ref:sections'], ['instructorId', 'Instructor', 'ref:staff'],
      ['dayOfWeek', 'Day', 'day'], ['startTime', 'Start', 'time'], ['endTime', 'End', 'time']],
    cols: [['subjectId', 'Subject', 'ref:subjects'], ['sectionId', 'Section', 'ref:sections'], ['instructorId', 'Instructor', 'ref:staff'],
      ['dayOfWeek', 'Day', r => DAYS[r.dayOfWeek]], ['startTime', 'Time', r => `${r.startTime}–${r.endTime}`]],
    sort: (a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
  },
  workstations: {
    title: 'Workstation', write: TECH,
    fields: [['id', 'PC ID', 'text', { key: true, placeholder: 'PC-01' }], ['label', 'Display name', 'text', { placeholder: 'PC 1' }],
      ['nodeId', 'ESP32 node ID', 'text', { placeholder: 'node-01', optional: true }], ['enabled', 'Enabled', 'check', { default: true }],
      ['maintenance', 'Under maintenance', 'check'], ['notes', 'Notes', 'textarea'], ['mapX', '', 'hidden', { default: 0 }], ['mapY', '', 'hidden', { default: 0 }]],
  },
  inventory: {
    title: 'Inventory item', write: TECH,
    fields: [['assetTag', 'Asset tag', 'text', { placeholder: 'MON-001' }], ['name', 'Item', 'text'],
      ['category', 'Category', 'select', ['system_unit', 'monitor', 'keyboard', 'mouse', 'ups', 'network', 'furniture', 'other']],
      ['condition', 'Condition', 'select', ['working', 'defective', 'under_repair', 'disposed']], ['workstationId', 'Assigned PC', 'ref:workstations'],
      ['serialNo', 'Serial no.', 'text'], ['location', 'Location', 'text'], ['notes', 'Notes', 'textarea']],
    cols: [['assetTag', 'Tag'], ['name', 'Item'], ['category', 'Category', r => label(r.category)], ['workstationId', 'PC'], ['condition', 'Condition', r => badge(r.condition)], ['serialNo', 'Serial']],
    filters: [['condition', ['working', 'defective', 'under_repair', 'disposed']], ['category', ['system_unit', 'monitor', 'keyboard', 'mouse', 'ups', 'network', 'furniture', 'other']]],
  },
  issues: {
    title: 'Error report', write: TECH,
    fields: [['workstationId', 'PC', 'ref:workstations'], ['category', 'Category', 'select', ['hardware', 'software', 'network', 'power', 'other']],
      ['description', 'Problem', 'textarea'], ['status', 'Status', 'select', ['open', 'in_progress', 'resolved']], ['assignedTo', 'Assigned technician', 'ref:staff'],
      ['resolution', 'Resolution', 'textarea']],
    cols: [['createdAt', 'Reported', r => fmt(r.createdAt)], ['workstationId', 'PC'], ['category', 'Category', r => label(r.category)], ['description', 'Problem'],
      ['reportedBy', 'By', r => esc((r.reportedBy ?? '').split(':')[0])], ['assignedTo', 'Technician', 'ref:staff'], ['status', 'Status', r => badge(r.status)]],
    filters: [['status', ['open', 'in_progress', 'resolved']]],
    extra: r => `<button class="btn small" data-history="${esc(r.id)}">${icon('history')} History</button>` + (TECH.includes(me.role) ? ` <button class="btn small" data-log="${esc(r.id)}">Log action</button>` : ''),
  },
  maintenance: {
    title: 'Maintenance entry', write: TECH,
    fields: [['workstationId', 'PC', 'ref:workstations'], ['issueId', 'Related error report', 'ref:issues'], ['inventoryId', 'Inventory item', 'ref:inventory'],
      ['action', 'Action taken', 'text', { placeholder: 'Replaced VGA cable' }], ['remarks', 'Technician remarks', 'textarea']],
    cols: [['createdAt', 'Date', r => fmt(r.createdAt)], ['workstationId', 'PC'], ['action', 'Action'], ['remarks', 'Remarks'], ['technicianId', 'Technician', 'ref:staff']],
  },
  users: {
    title: 'Staff account', write: ADMIN,
    fields: [['username', 'Username', 'text'], ['name', 'Full name', 'text'], ['role', 'Role', 'select', ['admin', 'technician', 'instructor']],
      ['password', 'Password (leave blank to keep)', 'password'], ['active', 'Active', 'check', { default: true }]],
    cols: [['name', 'Name', r => person(r.name, '@' + r.username)], ['role', 'Role', r => badge({ admin: 'in_progress', technician: 'open', instructor: 'active' }[r.role], label(r.role))],
      ['fingerprintSlot', 'Fingerprint', r => (r.fingerprintSlot != null ? badge('active', `Enrolled · slot ${r.fingerprintSlot}`) : badge('inactive', 'Not enrolled'))],
      ['active', 'Status', r => badge(r.active ? 'active' : 'inactive', r.active ? 'Active' : 'Inactive')]],
    extra: r => `<button class="btn small" data-enroll="staff:${esc(r.id)}">${r.fingerprintSlot != null ? 'Re-enroll' : 'Enroll'} finger</button>`,
  },
};
const refName = (lookupName, row) => ({ sections: row.name, subjects: `${row.code} – ${row.title}`, staff: `${row.name} (${row.role})`,
  workstations: row.label ?? row.id, issues: `${row.workstationId ?? ''} ${row.description}`.slice(0, 60), inventory: `${row.assetTag} ${row.name}` })[lookupName] ?? row.id;

// ------------------------------------------------------------------ GENERIC CRUD PAGE
async function crudPage(name, { mount = $('#view'), rowsOverride } = {}) {
  const R = RES[name], canWrite = R.write.includes(me.role);
  const refs = {};
  for (const [, , t] of [...R.fields, ...(R.cols ?? [])]) if (typeof t === 'string' && t.startsWith('ref:')) refs[t.slice(4)] ??= await lookup(t.slice(4)).catch(() => []);
  let rows = rowsOverride ?? (await api(`/api/${name}`)).rows;
  if (R.sort) rows.sort(R.sort);
  const state = { q: '', f: {} };
  mount.innerHTML = `
    <div class="toolbar">
      <label class="grow search">Search${icon('search')}<input id="q" placeholder="Search ${esc(R.title.toLowerCase())}s…"></label>
      ${(R.filters ?? []).map(([k, opts]) => `<label>${label(k)}<select data-filter="${k}"><option value="">All</option>${opts.map(o => `<option value="${o}">${label(o)}</option>`).join('')}</select></label>`).join('')}
      ${canWrite && name === 'students' ? `<button class="btn" type="button" data-import="1">${icon('upload')} Import</button>` : ''}
      ${canWrite ? `<button class="btn primary" id="add">${icon('plus')} Add ${R.title.toLowerCase()}</button>` : ''}
    </div>
    <div class="count" id="count"></div>
    <div class="table-wrap"><table><thead><tr>${(R.cols ?? []).map(c => `<th>${c[1]}</th>`).join('')}<th class="actions"></th></tr></thead><tbody></tbody></table></div>`;
  const cell = (r, [k, , fn]) => {
    if (typeof fn === 'function') return fn(r);
    if (typeof fn === 'string' && fn.startsWith('ref:')) { const ref = refs[fn.slice(4)]?.find(x => x.id === r[k]); return esc(ref ? refName(fn.slice(4), ref) : r[k] ?? ''); }
    return esc(r[k]);
  };
  const draw = () => {
    const q = state.q.toLowerCase();
    const shown = rows.filter(r => Object.entries(state.f).every(([k, v]) => !v || r[k] === v) && (!q || JSON.stringify(r).toLowerCase().includes(q)));
    $('tbody', mount).innerHTML = shown.length ? shown.map(r => `<tr>${R.cols.map(c => `<td>${cell(r, c)}</td>`).join('')}
      <td class="actions">${R.extra?.(r) ?? ''} ${canWrite ? `<button class="btn small" data-edit="${esc(r.id)}">Edit</button> <button class="btn small danger" data-del="${esc(r.id)}">Delete</button>` : ''}</td></tr>`).join('')
      : `<tr><td colspan="${R.cols.length + 1}">${emptyState(rows.length ? 'Nothing matches your search.' : `No ${R.title.toLowerCase()}s yet.`)}</td></tr>`;
    $('#count', mount).textContent = `${shown.length} of ${rows.length} record${rows.length === 1 ? '' : 's'}`;
  };
  draw();
  $('#q', mount).oninput = e => { state.q = e.target.value; draw(); };
  mount.querySelectorAll('[data-filter]').forEach(s => (s.onchange = () => { state.f[s.dataset.filter] = s.value; draw(); }));
  const reload = async () => { invalidate(name); rows = (await api(`/api/${name}`)).rows; if (R.sort) rows.sort(R.sort); draw(); };
  if (canWrite) $('#add', mount).onclick = () => editForm(name, null, reload);
  mount.onclick = run(async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.edit) editForm(name, rows.find(r => r.id === b.dataset.edit), reload);
    if (b.dataset.del && confirm(`Delete this ${R.title.toLowerCase()}? This cannot be undone.`)) {
      await api(`/api/${name}/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' }); toast('Deleted'); reload();
    }
    if (b.dataset.enroll) { const [type, id] = b.dataset.enroll.split(':'); enrollDialog(type, id, rows.find(r => r.id === id)?.name, reload); }
    if (b.dataset.history) historyDialog(rows.find(r => r.id === b.dataset.history));
    if (b.dataset.import) importDialog(reload);
    if (b.dataset.log) editForm('maintenance', { issueId: b.dataset.log, workstationId: rows.find(r => r.id === b.dataset.log)?.workstationId }, () => toast('Action logged'), true);
  });
  return { reload };
}

async function editForm(name, row, onSaved, forceCreate = false) {
  const R = RES[name], isNew = forceCreate || !row?.id || (row && !row.createdAt && !row.updatedAt);
  const input = async ([k, lbl, type, opt]) => {
    const v = row?.[k] ?? (opt?.default ?? '');
    if (type === 'hidden') return `<input type="hidden" name="${k}" value="${esc(v)}">`;
    if (type === 'check') return `<label class="check"><input type="checkbox" name="${k}" ${v === true || v === 1 || (v === '' && opt?.default) ? 'checked' : ''}> ${lbl}</label>`;
    if (type === 'textarea') return `<label>${lbl}<textarea name="${k}" rows="3">${esc(v)}</textarea></label>`;
    if (type === 'select') return `<label>${lbl}<select name="${k}">${opt.map(o => `<option value="${o}" ${o === v ? 'selected' : ''}>${label(o)}</option>`).join('')}</select></label>`;
    if (type === 'day') return `<label>${lbl}<select name="${k}">${DAYS.map((d, i) => `<option value="${i}" ${i === v ? 'selected' : ''}>${d}</option>`).join('')}</select></label>`;
    if (type.startsWith('ref:')) {
      const L = type.slice(4), items = await lookup(L).catch(() => []);
      return `<label>${lbl}<select name="${k}"><option value="">— None —</option>${items.map(i => `<option value="${esc(i.id)}" ${i.id === v ? 'selected' : ''}>${esc(refName(L, i))}</option>`).join('')}</select></label>`;
    }
    const t = { password: 'password', time: 'time', number: 'number' }[type] ?? 'text';
    return `<label>${lbl}<input name="${k}" type="${t}" value="${type === 'password' ? '' : esc(v)}" ${opt?.key && !isNew ? 'readonly' : ''} placeholder="${esc(opt?.placeholder ?? '')}"></label>`;
  };
  const html = (await Promise.all(R.fields.map(input))).join('');
  const form = openModal(`<h3>${isNew ? 'Add' : 'Edit'} ${R.title.toLowerCase()}</h3>${html}<p class="error" id="formErr"></p>
    <footer><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" id="save">Save</button></footer>`);
  $('#save', form).onclick = async e => {
    e.preventDefault();
    const body = {};
    for (const [k, , type, opt] of R.fields) {
      const el = form.elements[k];
      if (type === 'check') body[k] = el.checked;
      else if (type === 'day' || type === 'hidden') body[k] = Number(el.value);
      else if (type.startsWith('ref:')) body[k] = el.value || null;
      else if (type === 'password') { if (el.value) body[k] = el.value; }
      else body[k] = opt?.optional && !el.value.trim() ? null : el.value.trim();
    }
    // Keep fields the form does not show (e.g. fingerprintSlot) when editing.
    if (!isNew && 'fingerprintSlot' in (row ?? {})) body.fingerprintSlot = row.fingerprintSlot;
    try {
      await api(isNew ? `/api/${name}` : `/api/${name}/${encodeURIComponent(row.id)}`, { method: isNew ? 'POST' : 'PUT', body });
      closeModal(); toast('Saved'); invalidate(name); onSaved?.();
    } catch (err) { $('#formErr', form).textContent = err.message; }
  };
}

function openModal(html) {
  const d = $('#modal'), f = $('#modalForm');
  f.innerHTML = html; d.showModal();
  return f;
}
const closeModal = () => $('#modal').close();
$('#modal').addEventListener('close', () => $('#modal').dispatchEvent(new Event('closed')));

// ------------------------------------------------------------------ FINGERPRINT ENROLL
function enrollDialog(personType, personId, name, onDone) {
  const f = openModal(`<h3>Enroll fingerprint</h3><p class="muted">${esc(name ?? personId)}</p>
    <div class="fp waiting" id="fp"><div class="ring">${icon('fingerprint')}</div><div class="steps"><span></span><span></span><span></span></div><b id="fpMsg">Starting…</b>
    <span class="muted">Place → lift → place the same finger again</span></div>
    <footer><button class="btn" value="cancel" id="fpCancel">Close</button></footer>`);
  let jobId = null, stop = false;
  $('#modal').addEventListener('closed', () => { stop = true; if (jobId) api(`/fingerprint/requests/${jobId}/cancel`, { method: 'POST' }).catch(() => {}); }, { once: true });
  const show = (msg, step, cls = '') => {
    $('#fpMsg', f).textContent = msg; $('#fp', f).className = `fp ${cls || 'waiting'}`;
    f.querySelectorAll('.steps span').forEach((s, i) => s.classList.toggle('on', i < step));
    $('.ring', f).innerHTML = icon(cls === 'done' ? 'check' : cls === 'error' ? 'alert' : 'fingerprint');
  };
  (async () => {
    try {
      jobId = (await api('/api/fingerprint/enroll', { method: 'POST', body: { personType, personId } })).id;
      while (!stop) {
        await new Promise(r => setTimeout(r, 400));
        const j = await api(`/fingerprint/requests/${jobId}`);
        const step = { waiting: 0, first: 1, remove: 2, second: 2, done: 3 }[j.state] ?? 0;
        if (j.state === 'done') { show(j.message, 3, 'done'); jobId = null; onDone?.(); return; }
        if (['error', 'cancelled'].includes(j.state)) { show(j.message, step, 'error'); jobId = null; return; }
        show(j.message, step);
      }
    } catch (e) { show(e.message, 0, 'error'); jobId = null; }
  })();
}

// ------------------------------------------------------------------ LAB MAP
function mapHtml(pcs, { editing = false } = {}) {
  const placed = pcs.some(p => p.mapX || p.mapY) || editing;
  const tile = p => {
    const who = p.session?.studentName ? `${esc(p.session.studentName)} · ${time(p.session.timeIn)}` : (p.online ? `Power ${esc(p.power)}` : 'Node offline');
    const pos = placed ? `left:${Math.min(p.mapX, 87)}%;top:${Math.min(p.mapY, 80)}%` : '';
    const ic = p.status === 'OFFLINE' ? 'wifiOff' : p.status === 'MAINTENANCE' ? 'wrench' : p.status === 'OFF' ? 'power' : 'monitor';
    return `<div class="pc s-${p.status}" data-pc="${esc(p.id)}" style="${pos}"><div class="pc-top"><b>${esc(p.label)}</b><span class="pc-ic">${icon(editing ? 'move' : ic)}</span></div>
      ${badge(p.status)}<small style="margin-top:6px">${who}</small></div>`;
  };
  return `<div class="map ${placed ? '' : 'grid'} ${editing ? 'editing' : ''}" id="map">${pcs.map(tile).join('') || emptyState('No workstations yet. Add them under Workstations & map.', 'monitor')}</div>
    <div class="legend">${Object.keys(STATUS).slice(0, 6).map(s => `<span class="s-${s}"><i></i>${STATUS[s]}</span>`).join('')}</div>`;
}

function pcDialog(p, refresh) {
  const canEnd = !!p.session, canMaint = TECH.includes(me.role);
  const f = openModal(`<h3>${esc(p.label)} <small class="muted">${esc(p.id)}</small></h3>
    <p>${badge(p.status)} ${p.online ? `· power ${esc(p.power)} · signal ${esc(p.rssi ?? '?')} dBm · ${esc(p.ip ?? '')}` : '· node offline'}</p>
    <p class="muted">Last heartbeat: ${p.lastSeen ? fmt(p.lastSeen) : 'never'}</p>
    ${p.session ? `<div class="card"><b>${esc(p.session.studentName)}</b> (${esc(p.session.studentId)})<br><span class="muted">Time in ${fmt(p.session.timeIn)}</span>
      <label style="margin-top:10px">Reason for ending<input id="reason" value="Ended by ${esc(me.role)}"></label></div>` : ''}
    ${p.notes ? `<p class="muted">Notes: ${esc(p.notes)}</p>` : ''}
    <footer>
      ${canMaint ? `<button class="btn" id="maint">${p.maintenance ? 'End maintenance' : 'Set maintenance'}</button>` : ''}
      ${canEnd ? '<button class="btn danger" id="endS">End session</button>' : ''}
      <button class="btn primary" value="ok">Close</button>
    </footer>`);
  if (canEnd) $('#endS', f).onclick = run(async e => {
    e.preventDefault();
    await api(`/sessions/${p.session.id}/end`, { method: 'POST', body: { reason: $('#reason', f).value } });
    closeModal(); toast('Session ended'); refresh();
  });
  if (canMaint) $('#maint', f).onclick = run(async e => {
    e.preventDefault();
    const w = (await api(`/api/workstations/${encodeURIComponent(p.id)}`));
    await api(`/api/workstations/${encodeURIComponent(p.id)}`, { method: 'PUT', body: { ...w, maintenance: !p.maintenance, enabled: !!w.enabled } });
    closeModal(); toast('Updated'); refresh();
  });
}

// ------------------------------------------------------------------ PAGES
async function overview() {
  const v = $('#view');
  const mine = me.role === 'instructor'
    ? `<div class="panel"><div class="panel-head"><h3>${icon('list')} My classes today</h3><a href="#/class-attendance">Open attendance sheet</a></div><div class="panel-body" id="mine"></div></div>`
    : me.role === 'technician'
      ? `<div class="panel"><div class="panel-head"><h3>${icon('wrench')} Assigned to me</h3><a href="#/issues">All error reports</a></div><div class="table-wrap" id="mine"></div></div>` : '';
  v.innerHTML = `<div class="stats" id="stats"></div>
    <div class="two"><div class="panel"><div class="panel-head"><h3>${icon('bell')} Alerts</h3><span class="muted" id="alertCount"></span></div><div class="panel-body" id="alerts"></div></div>
    ${mine || `<div class="panel"><div class="panel-head"><h3>${icon('trend')} Attendance this week</h3><a href="#/analytics">Analytics</a></div><div class="panel-body" id="trend"></div></div>`}</div>
    <div class="panel"><div class="panel-head"><h3>${icon('map')} Interactive laboratory map</h3><span class="muted">Click a PC for details · updates every 5 s</span></div><div class="panel-body" id="mapBox"></div></div>
    <div class="two"><div class="panel"><div class="panel-head"><h3>${icon('users')} Active users</h3></div><div class="table-wrap" id="active"></div></div>
    <div class="panel"><div class="panel-head"><h3>${icon('alert')} Open error reports</h3><a href="#/issues">View all</a></div><div class="table-wrap" id="openIssues"></div></div></div>`;
  let pcs = [];
  const refresh = run(async () => {
    const [s, live, issues] = await Promise.all([api('/api/summary'), api('/workstations/live'), api('/api/issues')]);
    pcs = live.workstations;
    const w = s.workstations;
    $('#stats').innerHTML = stat(s.activeSessions, 'Active users', 'users', 't-blue') + stat(s.attendanceToday, 'Students today', 'calendar', 't-violet')
      + stat(`${w.idle + w.off}/${w.total}`, 'PCs available', 'monitor', 't-green') + stat(w.offline, 'PCs offline', 'wifiOff', 't-grey')
      + stat(w.maintenance, 'Under maintenance', 'wrench', 't-amber') + stat(s.openIssues, 'Open error reports', 'alert', s.openIssues ? 't-red' : 't-green');
    $('#mapBox').innerHTML = mapHtml(pcs);
    const act = pcs.filter(p => p.session);
    $('#active').innerHTML = act.length ? `<table><tr><th>Student</th><th>PC</th><th>Time in</th></tr>${act.map(p => `<tr><td>${person(p.session.studentName, p.session.studentId)}</td><td>${esc(p.label)}</td><td>${time(p.session.timeIn)}</td></tr>`).join('')}</table>` : emptyState('No one is using the lab right now.', 'users');
    await overviewExtras();
    const open = issues.rows.filter(i => i.status !== 'resolved').slice(0, 8);
    $('#openIssues').innerHTML = open.length ? `<table><tr><th>PC</th><th>Problem</th><th>Status</th></tr>${open.map(i => `<tr><td>${esc(i.workstationId ?? '')}</td><td>${esc(i.description)}</td><td>${badge(i.status)}</td></tr>`).join('')}</table>` : emptyState('No open error reports.', 'check');
  });
  await refresh();
  timer = setInterval(refresh, 5000);
  $('#mapBox').onclick = e => { const t = e.target.closest('[data-pc]'); if (t) pcDialog(pcs.find(p => p.id === t.dataset.pc), refresh); };
}

async function workstationsPage() {
  const v = $('#view'), canEdit = TECH.includes(me.role);
  v.innerHTML = `<div class="panel"><div class="panel-head"><h3>${icon('map')} Laboratory layout</h3>
      ${canEdit ? `<span><button class="btn" id="editMap">${icon('move')} Arrange layout</button> <button class="btn primary" id="saveMap" hidden>${icon('check')} Save layout</button></span>` : ''}</div>
      <div class="panel-body"><p class="muted no-print" id="mapHint" hidden>Drag each PC to where it sits in the room, then press Save layout. The tablet shows the same map.</p>
      <div id="mapBox"></div></div></div>
    <div class="panel"><div class="panel-head"><h3>${icon('monitor')} Workstations & network status</h3><button class="btn primary" id="addWs" ${canEdit ? '' : 'hidden'}>${icon('plus')} Add workstation</button></div><div class="table-wrap" id="wsTable"></div></div>`;
  let pcs = [], editing = false;
  const draw = () => {
    $('#mapBox').innerHTML = mapHtml(pcs, { editing });
    $('#wsTable').innerHTML = pcs.length ? `<table><tr><th>PC</th><th>Name</th><th>Node</th><th>Status</th><th>Power</th><th>Network</th><th>Last heartbeat</th><th class="actions"></th></tr>
      ${pcs.map(p => `<tr><td>${esc(p.id)}</td><td>${esc(p.label)}</td><td>${esc(p.nodeId ?? '—')}</td><td>${badge(p.status)}</td><td>${esc(p.power)}</td>
        <td>${p.online ? badge('active', `Connected · ${p.rssi ?? '?'} dBm`) : badge('OFFLINE', 'Disconnected')}</td><td>${p.lastSeen ? fmt(p.lastSeen) : 'never'}</td>
        <td class="actions">${canEdit ? `<button class="btn small" data-edit="${esc(p.id)}">Edit</button> <button class="btn small danger" data-del="${esc(p.id)}">Delete</button>` : ''}</td></tr>`).join('')}</table>`
      : emptyState('No workstations yet. Add PC-01, PC-02 … to get started.', 'monitor');
  };
  const load = run(async () => { if (editing) return; pcs = (await api('/workstations/live')).workstations; draw(); });
  await load();
  timer = setInterval(load, 5000);
  const full = async id => api(`/api/workstations/${encodeURIComponent(id)}`);
  $('#wsTable').onclick = run(async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.edit) editForm('workstations', await full(b.dataset.edit), load);
    if (b.dataset.del && confirm('Delete this workstation? Its history must be removed first.')) { await api(`/api/workstations/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' }); load(); }
  });
  $('#addWs').onclick = () => editForm('workstations', null, load);
  $('#mapBox').onclick = e => { if (editing) return; const t = e.target.closest('[data-pc]'); if (t) pcDialog(pcs.find(p => p.id === t.dataset.pc), load); };
  if (!canEdit) return;
  $('#editMap').onclick = () => {
    editing = true; $('#editMap').hidden = true; $('#saveMap').hidden = false; $('#mapHint').hidden = false;
    pcs.forEach((p, i) => { if (!p.mapX && !p.mapY) { p.mapX = 3 + (i % 6) * 16; p.mapY = 5 + Math.floor(i / 6) * 25; } });
    draw();
    const map = $('#map');
    map.onpointerdown = e => {
      const el = e.target.closest('.pc'); if (!el) return;
      const box = map.getBoundingClientRect(), p = pcs.find(x => x.id === el.dataset.pc);
      el.setPointerCapture(e.pointerId);
      el.onpointermove = m => {
        p.mapX = Math.round(Math.max(0, Math.min(87, ((m.clientX - box.left) / box.width) * 100 - 6)));
        p.mapY = Math.round(Math.max(0, Math.min(82, ((m.clientY - box.top) / box.height) * 100 - 6)));
        el.style.left = `${p.mapX}%`; el.style.top = `${p.mapY}%`;
      };
      el.onpointerup = () => (el.onpointermove = null);
    };
  };
  $('#saveMap').onclick = run(async () => {
    for (const p of pcs) {
      const w = await full(p.id);
      await api(`/api/workstations/${encodeURIComponent(p.id)}`, { method: 'PUT', body: { ...w, enabled: !!w.enabled, maintenance: !!w.maintenance, mapX: p.mapX, mapY: p.mapY } });
    }
    editing = false; $('#editMap').hidden = false; $('#saveMap').hidden = true; $('#mapHint').hidden = true; toast('Layout saved'); load();
  });
}

function reportTable(r) {
  return `<h3 class="print-title">ComLab — ${esc(r.title)} (${new Date().toLocaleDateString('en-PH')})</h3>
    <div class="table-wrap"><table><thead><tr>${r.columns.map(c => `<th>${esc(c[1])}</th>`).join('')}</tr></thead><tbody>
    ${r.rows.length ? r.rows.map(row => `<tr>${r.columns.map(([k]) => `<td>${k === 'status' || k === 'condition' ? badge(row[k]) : esc(row[k])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${r.columns.length}">${emptyState('No records for this filter.', 'calendar')}</td></tr>`}
    </tbody></table></div>`;
}
const exportButtons = `<span class="spacer"></span><span class="no-print" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-x="xlsx">${icon('download')} Excel</button><button class="btn" data-x="csv">${icon('download')} CSV</button><button class="btn" data-x="pdf">${icon('printer')} Print / PDF</button></span>`;

async function attendancePage() {
  const [sections, subjects] = await Promise.all([lookup('sections').catch(() => []), lookup('subjects').catch(() => [])]);
  const v = $('#view');
  v.innerHTML = `<form class="toolbar" id="flt">
      <label>From<input type="date" name="from" value="${today()}"></label><label>To<input type="date" name="to" value="${today()}"></label>
      <label>Section<select name="section"><option value="">All</option>${sections.map(s => `<option>${esc(s.name)}</option>`).join('')}</select></label>
      <label>Subject<select name="subject"><option value="">All</option>${subjects.map(s => `<option>${esc(s.code)}</option>`).join('')}</select></label>
      <label class="grow">Student<input name="student" placeholder="ID or name"></label>
      <button class="btn primary">Apply</button>${exportButtons}</form><div id="out"></div>`;
  const qs = () => new URLSearchParams([...new FormData($('#flt'))].filter(([, val]) => val)).toString();
  const load = run(async () => {
    const r = await api(`/api/reports/attendance?${qs()}`);
    $('#out').innerHTML = `<div class="stats">${stat(r.rows.length, 'Sessions', 'calendar', 't-blue')}${stat(new Set(r.rows.map(x => x.studentId)).size, 'Students', 'users', 't-violet')}
      ${stat(r.rows.filter(x => x.timeOutLocal === 'Active').length, 'Still in the lab', 'monitor', 't-green')}${stat(r.rows.filter(x => x.assignment === 'auto').length, 'Auto-assigned PCs', 'grid', 't-amber')}</div>${reportTable(r)}`;
  });
  $('#flt').onsubmit = e => { e.preventDefault(); load(); };
  $('#flt').onclick = e => { const x = e.target.dataset.x; if (!x) return; e.preventDefault(); x === 'pdf' ? print() : download(`/api/reports/attendance.${x}?${qs()}`); };
  load();
}

async function reportsPage() {
  const avail = [['usage', 'Computer usage', ALL], ['maintenance', 'Maintenance', TECH], ['inventory', 'Inventory', TECH], ['attendance', 'Attendance', ALL]].filter(r => r[2].includes(me.role));
  const v = $('#view');
  v.innerHTML = `<form class="toolbar" id="flt">
      <label>Report<select name="report">${avail.map(r => `<option value="${r[0]}">${r[1]}</option>`).join('')}</select></label>
      <label>From<input type="date" name="from"></label><label>To<input type="date" name="to"></label>
      <button class="btn primary">Show</button>${exportButtons}</form><div class="stats" id="kpi"></div><div id="out"></div>`;
  const params = () => { const f = new FormData($('#flt')); const rep = f.get('report'); f.delete('report'); return [rep, new URLSearchParams([...f].filter(([, x]) => x)).toString()]; };
  const load = run(async () => {
    const [rep, q] = params(), r = await api(`/api/reports/${rep}?${q}`);
    const sum = k => r.rows.reduce((a, x) => a + (Number(x[k]) || 0), 0);
    const kpi = { usage: [[sum('sessions'), 'Sessions'], [Math.round(sum('hours') * 10) / 10, 'Hours used'], [sum('issues'), 'Issues reported'],
        [r.rows.slice().sort((a, b) => b.hours - a.hours)[0]?.label ?? '—', 'Most used PC']],
      maintenance: [[r.rows.length, 'Reports'], [r.rows.filter(x => x.status === 'resolved').length, 'Resolved'], [r.rows.filter(x => x.status !== 'resolved').length, 'Pending']],
      inventory: [[r.rows.length, 'Items'], [r.rows.filter(x => x.condition === 'working').length, 'Working'], [r.rows.filter(x => x.condition !== 'working').length, 'Need attention']],
      attendance: [[r.rows.length, 'Sessions'], [new Set(r.rows.map(x => x.studentId)).size, 'Students'], [r.rows.filter(x => x.assignment === 'auto').length, 'Auto-assigned']] }[rep];
    const tones = ['t-blue', 't-green', 't-amber', 't-violet'], ics = ['chart', 'clock', 'alert', 'monitor'];
    $('#kpi').innerHTML = kpi.map(([n, l], i) => stat(n, l, ics[i], tones[i])).join('');
    if (rep === 'usage') {
      const max = Math.max(1, ...r.rows.map(x => x.hours));
      $('#out').innerHTML = `<div class="panel"><div class="panel-head"><h3>${icon('chart')} Hours used per PC</h3></div><div class="panel-body">${r.rows.map(x => `<div class="bar-row">
        <span>${esc(x.label)}</span><span class="bar"><span style="width:${Math.max(1, (x.hours / max) * 100)}%"></span></span><span class="muted">${x.hours} h</span></div>`).join('') || emptyState('No workstations yet.', 'monitor')}</div></div>${reportTable(r)}`;
    } else $('#out').innerHTML = reportTable(r);
  });
  $('#flt').onsubmit = e => { e.preventDefault(); load(); };
  $('#flt').onchange = e => { if (e.target.name === 'report') load(); };
  $('#flt').onclick = e => { const x = e.target.dataset.x; if (!x) return; e.preventDefault(); const [rep, q] = params(); x === 'pdf' ? print() : download(`/api/reports/${rep}.${x}?${q}`); };
  load();
}

async function fingerprintsPage() {
  const v = $('#view');
  const draw = run(async () => {
    const st = await api('/fingerprint/status');
    if (!st.ready) { v.innerHTML = `<div class="notice">${icon('alert')}<div><b>Sensor not ready</b><p style="margin:4px 0 10px">${esc(st.error ?? 'Check the AS608 wiring and power.')}</p><button class="btn" id="retry">Retry</button></div></div>`; $('#retry').onclick = draw; return; }
    const s = await api('/api/fingerprint/slots');
    const orphans = s.slots.filter(x => !x.owner).length;
    v.innerHTML = `<div class="stats">${stat(s.slots.length, 'Stored fingerprints', 'fingerprint', 't-blue')}${stat(s.capacity - s.slots.length, 'Free slots', 'box', 't-green')}
      ${stat(orphans, 'Unlinked slots', 'alert', orphans ? 't-amber' : 't-grey')}</div>
      ${s.missingOnSensor.length ? `<div class="notice">${icon('alert')}<div><b>Missing on sensor:</b> ${s.missingOnSensor.map(m => esc(m.name)).join(', ')} — re-enroll them.</div></div>` : ''}
      <div class="panel"><div class="panel-head"><h3>${icon('fingerprint')} Sensor slots</h3><span class="muted">Enroll from <a href="#/students">Students</a> or <a href="#/users">Staff accounts</a></span></div>
      <div class="table-wrap"><table><tr><th>Slot</th><th>Linked to</th><th class="actions"></th></tr>${s.slots.map(x => `<tr><td>#${x.slot}</td>
        <td>${x.owner ? person(x.owner.name, `${x.owner.type} · ${x.owner.id}`) : badge('open', 'Not linked')}</td>
        <td class="actions"><button class="btn small danger" data-slot="${x.slot}">Delete</button></td></tr>`).join('') || `<tr><td colspan="3">${emptyState('The sensor is empty.', 'fingerprint')}</td></tr>`}</table></div></div>`;
  });
  v.onclick = run(async e => {
    const slot = e.target.dataset.slot;
    if (slot && confirm(`Delete fingerprint slot ${slot}? The person will need to re-enroll.`)) { await api(`/api/fingerprint/slots/${slot}`, { method: 'DELETE' }); toast('Deleted'); draw(); }
  });
  await draw();
}

async function settingsPage() {
  const s = await api('/settings/kiosk');
  const v = $('#view');
  v.innerHTML = `<form class="card" id="set" style="max-width:560px;display:grid;gap:16px"><h3 style="display:flex;gap:10px;align-items:center">${icon('monitor')} Kiosk tablet</h3>
    <label>Auto-assign a PC after (seconds)<input type="number" name="autoAssignAfterSeconds" min="10" max="300" value="${s.autoAssignAfterSeconds}"></label>
    <label>Welcome screen timeout (seconds)<input type="number" name="welcomeTimeoutSeconds" min="10" max="120" value="${s.welcomeTimeoutSeconds}"></label>
    <button class="btn primary">Save</button></form>
    <div class="panel"><div class="panel-head"><h3>${icon('tablet')} Kiosk tablets</h3><span class="muted">Unpair a lost or replaced tablet</span></div><div class="table-wrap" id="kiosks"></div></div>
    <div class="card" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><span class="stat t-blue" style="border:0;box-shadow:none;padding:0;display:block"><span class="ic">${icon('database')}</span></span>
      <div style="flex:1;min-width:220px"><b>Database backup</b><p class="muted" style="margin:4px 0 0">Download a complete copy of all records (students, attendance, reports, inventory). Keep it on a USB drive.</p></div>
      <button class="btn primary" id="backup">${icon('download')} Download backup</button></div>`;
  const drawKiosks = run(async () => {
    const k = (await api('/api/kiosks')).rows;
    $('#kiosks').innerHTML = k.length ? `<table><tr><th>Tablet</th><th>Paired</th><th>Login valid until</th><th class="actions"></th></tr>${k.map(x => `<tr><td>${esc(x.name)}</td><td>${fmt(x.createdAt)}</td><td>${x.expiresAt ? fmt(x.expiresAt) : badge('inactive', 'Signed out')}</td>
      <td class="actions"><button class="btn small danger" data-unpair="${esc(x.id)}">Unpair</button></td></tr>`).join('')}</table>` : emptyState('No tablets paired yet.', 'tablet');
  });
  drawKiosks();
  $('#kiosks').onclick = run(async e => { const id = e.target.dataset.unpair; if (id && confirm('Unpair this tablet? It will need admin setup again.')) { await api(`/api/kiosks/${id}`, { method: 'DELETE' }); toast('Tablet unpaired'); drawKiosks(); } });
  $('#backup').onclick = () => download('/api/backup');
  $('#set').onsubmit = run(async e => {
    e.preventDefault(); const f = new FormData(e.target);
    await api('/api/settings/kiosk', { method: 'PUT', body: { autoAssignAfterSeconds: Number(f.get('autoAssignAfterSeconds')), welcomeTimeoutSeconds: Number(f.get('welcomeTimeoutSeconds')) } });
    toast('Settings saved');
  });
}

async function auditPage() {
  const r = await api('/api/audit');
  const tone = { admin: 'in_progress', technician: 'open', instructor: 'active', kiosk: 'IDLE' };
  $('#view').innerHTML = `<div class="panel"><div class="panel-head"><h3>${icon('activity')} Recent activity</h3><span class="muted">Last 500 events</span></div><div class="table-wrap"><table><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Detail</th></tr>
    ${r.rows.map(a => { const who = String(a.actor).split(':')[0]; return `<tr><td>${fmt(a.at)}</td><td>${badge(tone[who] ?? 'inactive', who)}</td>
      <td><b>${esc(a.action)}</b></td><td class="muted">${esc(String(a.target ?? '').slice(0, 13))}</td><td class="muted">${esc(a.detail ?? '')}</td></tr>`; }).join('')}</table></div></div>`;
}

// ------------------------------------------------------------------ CHARTS (inline SVG)
function lineChart(points, { key = 'sessions', height = 180 } = {}) {
  if (!points.length) return emptyState('No data yet.', 'trend');
  const w = 640, h = height, pad = 28, max = Math.max(1, ...points.map(p => p[key]));
  const x = i => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1), y = v => h - pad - (v / max) * (h - pad * 2);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1)},${h - pad} L${x(0)},${h - pad} Z`;
  const ticks = [0, Math.round(max / 2), max];
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block" role="img" aria-label="Trend chart">
    <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--brand-2)" stop-opacity=".35"/><stop offset="1" stop-color="var(--brand-2)" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map(t => `<line x1="${pad}" x2="${w - pad}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-dasharray="3 4"/><text x="${pad - 6}" y="${y(t) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${t}</text>`).join('')}
    <path d="${area}" fill="url(#g)"/><path d="${line}" fill="none" stroke="var(--brand)" stroke-width="2.5" stroke-linejoin="round"/>
    ${points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p[key])}" r="3.5" fill="var(--surface)" stroke="var(--brand)" stroke-width="2"><title>${esc(p.date ?? p.hour)}: ${p[key]}</title></circle>`).join('')}
    ${points.map((p, i) => (i % Math.ceil(points.length / 7) === 0 || i === points.length - 1 ? `<text x="${x(i)}" y="${h - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(p.date ? new Date(p.date + 'T00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : p.hour)}</text>` : '')).join('')}
  </svg>`;
}
function columnChart(items, { labelKey, valueKey, fmtLabel = v => v }) {
  const max = Math.max(1, ...items.map(i => i[valueKey]));
  return `<div style="display:flex;align-items:flex-end;gap:6px;height:170px;padding-top:10px">${items.map(i => `<div style="flex:1;display:grid;justify-items:center;gap:6px;align-self:stretch;align-content:end" title="${esc(fmtLabel(i[labelKey]))}: ${i[valueKey]}">
    <span class="muted" style="font-size:11px">${i[valueKey] || ''}</span>
    <span style="width:100%;max-width:28px;height:${Math.max(2, (i[valueKey] / max) * 120)}px;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,var(--brand-2),var(--brand))"></span>
    <span class="muted" style="font-size:11px">${esc(fmtLabel(i[labelKey]))}</span></div>`).join('')}</div>`;
}
function barList(items, unit = 'sessions') {
  if (!items.length) return emptyState('No data yet.', 'chart');
  const max = Math.max(1, ...items.map(i => i.sessions));
  return items.slice(0, 8).map(i => `<div class="bar-row"><span title="${esc(i.name)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.name)}</span>
    <span class="bar"><span style="width:${Math.max(2, (i.sessions / max) * 100)}%"></span></span><span class="muted">${i.sessions} ${unit}</span></div>`).join('');
}

// ------------------------------------------------------------------ OVERVIEW EXTRAS (role-based)
async function overviewExtras() {
  const a = (await api('/api/alerts')).rows;
  const tone = { danger: 't-red', warning: 't-amber', info: 't-blue' };
  $('#alertCount').textContent = a.length ? `${a.length} active` : '';
  $('#alerts').innerHTML = a.length ? `<div style="display:grid;gap:10px;max-height:260px;overflow:auto">${a.map(x => `<div class="stat ${tone[x.level]}" style="grid-template-columns:auto 1fr;box-shadow:none;padding:10px 12px;align-items:center">
      <span class="ic" style="grid-row:auto;width:34px;height:34px">${icon(x.level === 'danger' ? 'alert' : x.kind === 'offline' ? 'wifiOff' : x.kind === 'maintenance' ? 'wrench' : x.kind === 'defective' ? 'box' : 'clock')}</span>
      <span style="color:var(--ink);font-size:14px">${esc(x.text)}</span></div>`).join('')}</div>` : emptyState('All clear — no alerts.', 'check');
  if ($('#trend')) $('#trend').innerHTML = lineChart((await api('/api/analytics?days=7')).daily);
  if ($('#mine') && me.role === 'instructor') {
    const c = (await api('/api/my/classes')).rows;
    $('#mine').innerHTML = c.length ? `<div style="display:grid;gap:10px">${c.map(x => `<a href="#/class-attendance?class=${esc(x.id)}" class="stat t-violet" style="text-decoration:none;color:inherit;box-shadow:none;grid-template-columns:1fr auto">
      <span><b style="font-size:16px">${esc(x.code)} · ${esc(x.section)}</b><br><span class="muted">${esc(x.start_time)}–${esc(x.end_time)} · ${esc(x.title)}</span></span>
      <span style="text-align:right">${badge('active', `${x.present + x.late} present`)}<br>${badge('inactive', `${x.absent} absent`)}</span></a>`).join('')}</div>`
      : emptyState('You have no classes scheduled today.', 'calendar');
  }
  if ($('#mine') && me.role === 'technician') {
    const r = (await api('/api/my/issues')).rows;
    $('#mine').innerHTML = r.length ? `<table><tr><th>PC</th><th>Problem</th><th>Reported</th><th>Status</th></tr>${r.map(i => `<tr><td>${esc(i.workstationId ?? '')}</td><td>${esc(i.description)}</td><td>${fmt(i.createdAt)}</td><td>${badge(i.status)}</td></tr>`).join('')}</table>`
      : emptyState('Nothing assigned to you. 👍', 'check');
  }
}

// ------------------------------------------------------------------ ANALYTICS
async function analyticsPage() {
  const v = $('#view');
  v.innerHTML = `<form class="toolbar" id="flt"><label>Period<select name="days"><option value="7">Last 7 days</option><option value="14" selected>Last 14 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>
    <span class="spacer"></span><button class="btn" type="button" id="pr">${icon('printer')} Print / PDF</button></form><div id="out" style="display:grid;gap:22px"></div>`;
  const load = run(async () => {
    const a = await api(`/api/analytics?days=${$('#flt').days.value}`);
    $('#out').innerHTML = `<h3 class="print-title">ComLab analytics · ${a.from} to ${a.to}</h3>
      <div class="stats">${stat(a.totals.sessions, 'Lab sessions', 'calendar', 't-blue')}${stat(a.totals.students, 'Unique students', 'users', 't-violet')}
        ${stat(a.totals.hours, 'Computer hours', 'clock', 't-green')}${stat(`${a.totals.avgMinutes} min`, 'Average session', 'activity', 't-amber')}${stat(`${a.totals.autoAssignedPct}%`, 'Auto-assigned', 'grid', 't-grey')}</div>
      <div class="panel"><div class="panel-head"><h3>${icon('trend')} Daily attendance</h3><span class="muted">${a.from} → ${a.to}</span></div><div class="panel-body">${lineChart(a.daily)}</div></div>
      <div class="two"><div class="panel"><div class="panel-head"><h3>${icon('clock')} Busiest hours</h3><span class="muted">Check-ins by hour</span></div><div class="panel-body">${columnChart(a.hours, { labelKey: 'hour', valueKey: 'sessions', fmtLabel: hr => (hr % 12 || 12) + (hr < 12 ? 'a' : 'p') })}</div></div>
      <div class="panel"><div class="panel-head"><h3>${icon('layers')} By section</h3></div><div class="panel-body">${barList(a.sections)}</div></div></div>
      <div class="panel"><div class="panel-head"><h3>${icon('book')} By subject</h3></div><div class="panel-body">${barList(a.subjects)}</div></div>`;
  });
  $('#flt').onchange = load;
  $('#pr').onclick = () => print();
  await load();
}

// ------------------------------------------------------------------ CLASS ATTENDANCE SHEET
async function classAttendancePage() {
  const [classes, subjects, sections] = await Promise.all([lookup('classes'), lookup('subjects'), lookup('sections')]);
  const name = c => `${subjects.find(s => s.id === c.subjectId)?.code ?? '?'} · ${sections.find(s => s.id === c.sectionId)?.name ?? '?'} · ${DAYS[c.dayOfWeek].slice(0, 3)} ${c.startTime}–${c.endTime}`;
  const mineFirst = classes.slice().sort((a, b) => (b.instructorId === me.id) - (a.instructorId === me.id) || a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
  const todayDow = new Date().getDay();
  const wanted = new URLSearchParams(location.hash.split('?')[1] ?? '').get('class')
    ?? (mineFirst.find(c => c.dayOfWeek === todayDow && c.instructorId === me.id) ?? mineFirst.find(c => c.dayOfWeek === todayDow) ?? mineFirst[0]).id;
  const v = $('#view');
  if (!classes.length) { v.innerHTML = `<div class="card">${emptyState('No class schedules yet. Add them under Class schedules.', 'clock')}</div>`; return; }
  v.innerHTML = `<form class="toolbar" id="flt"><label class="grow">Class<select name="classId">${mineFirst.map(c => `<option value="${esc(c.id)}" ${c.id === wanted ? 'selected' : ''}>${esc(name(c))}${c.instructorId === me.id ? ' (mine)' : ''}</option>`).join('')}</select></label>
    <label>Date<input type="date" name="date" value="${today()}"></label><span class="spacer"></span>
    <button class="btn" type="button" id="csv">${icon('download')} CSV</button><button class="btn" type="button" id="pr">${icon('printer')} Print / PDF</button></form><div id="out" style="display:grid;gap:22px"></div>`;
  let last = null;
  const load = run(async () => {
    const f = $('#flt');
    last = await api(`/api/class-attendance?classId=${encodeURIComponent(f.classId.value)}&date=${f.date.value}`);
    const c = last.class, n = last.counts, total = last.roster.length;
    const wrongDay = new Date(f.date.value + 'T12:00').getDay() !== c.day;
    $('#out').innerHTML = `<h3 class="print-title">Attendance — ${esc(c.subject)} ${esc(c.title)} · ${esc(c.section)} · ${esc(f.date.value)} (${esc(c.start)}–${esc(c.end)})</h3>
      ${wrongDay ? `<div class="notice">${icon('alert')}<div>This class meets on <b>${DAYS[c.day]}</b>, but the selected date is a ${DAYS[new Date(f.date.value + 'T12:00').getDay()]}.</div></div>` : ''}
      <div class="stats">${stat(n.present, 'Present', 'check', 't-green')}${stat(n.late, 'Late (15+ min)', 'clock', 't-amber')}${stat(n.absent, 'Absent', 'user', 't-red')}
        ${stat(total ? `${Math.round(((n.present + n.late) / total) * 100)}%` : '—', 'Attendance rate', 'trend', 't-blue')}</div>
      <div class="panel"><div class="panel-head"><h3>${icon('list')} ${esc(c.subject)} · ${esc(c.section)}</h3><span class="muted">${esc(c.instructor ?? 'No instructor')} · ${DAYS[c.day]} ${esc(c.start)}–${esc(c.end)}</span></div>
      <div class="table-wrap"><table><tr><th>#</th><th>Student</th><th>Status</th><th>PC</th><th>Time in</th><th>Time out</th></tr>
      ${last.roster.map((r, i) => `<tr><td class="muted">${i + 1}</td><td>${person(r.name, r.studentId)}</td><td>${badge({ present: 'active', late: 'open', absent: 'defective' }[r.status], label(r.status))}</td>
        <td>${esc(r.workstationId ?? '—')}</td><td>${r.timeIn ? time(r.timeIn) : '—'}</td><td>${r.timeOut ? time(r.timeOut) : r.timeIn ? badge('IN_USE', 'In lab') : '—'}</td></tr>`).join('')
        || `<tr><td colspan="6">${emptyState('No students in this section yet.', 'users')}</td></tr>`}</table></div></div>`;
  });
  $('#flt').onchange = load;
  $('#pr').onclick = () => print();
  $('#csv').onclick = () => {
    if (!last) return;
    const rows = [['No.', 'Student ID', 'Name', 'Status', 'PC', 'Time in', 'Time out'], ...last.roster.map((r, i) => [i + 1, r.studentId, r.name, r.status, r.workstationId ?? '', r.timeIn ? fmt(r.timeIn) : '', r.timeOut ? fmt(r.timeOut) : ''])];
    const csv = '﻿' + rows.map(r => r.map(c => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `Attendance ${last.class.subject} ${last.class.section} ${last.date}.csv` });
    a.click();
  };
  await load();
}

// ------------------------------------------------------------------ ISSUE HISTORY
async function historyDialog(issue) {
  if (!issue) return;
  const h = await api(`/api/issues/${issue.id}/history`);
  const events = [
    { at: issue.createdAt, title: 'Reported', text: `${issue.description} — by ${String(issue.reportedBy ?? '').split(':')[0] || 'staff'}`, tone: 't-red', ic: 'alert' },
    ...h.rows.map(m => ({ at: m.at, title: m.action, text: [m.remarks, m.technician].filter(Boolean).join(' — '), tone: 't-blue', ic: 'wrench' })),
    ...(issue.status === 'resolved' ? [{ at: issue.resolvedAt ?? issue.updatedAt, title: 'Resolved', text: issue.resolution, tone: 't-green', ic: 'check' }] : []),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  openModal(`<h3>Error report history</h3><p class="muted" style="margin:0">${esc(issue.workstationId ?? 'Lab')} · ${label(issue.category)} · ${badge(issue.status)}</p>
    <div style="display:grid;gap:4px">${events.map(e => `<div class="stat ${e.tone}" style="grid-template-columns:auto 1fr;box-shadow:none;border:0;padding:8px 0;align-items:start">
      <span class="ic" style="grid-row:auto;width:34px;height:34px">${icon(e.ic)}</span><span><b style="font-size:14px">${esc(e.title)}</b> <span class="muted" style="font-size:12px">${fmt(e.at)}</span><br><span style="color:var(--ink-2);font-size:14px">${esc(e.text ?? '')}</span></span></div>`).join('')}</div>
    <footer><button class="btn primary" value="ok">Close</button></footer>`);
}

// ------------------------------------------------------------------ STUDENT IMPORT
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some(x => x.trim())) rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  return rows;
}
function importDialog(onDone) {
  const f = openModal(`<h3>Import students</h3>
    <p class="muted" style="margin:0">Upload a CSV file with columns <b>Student ID, Name, Section</b>. In Excel use <i>File → Save As → CSV</i>. Existing students are updated; missing sections are created.</p>
    <p style="margin:0"><a href="#" id="tpl">${icon('download')} Download template</a></p>
    <label>CSV file<input type="file" id="file" accept=".csv,text/csv"></label><div id="preview"></div><p class="error" id="formErr"></p>
    <footer><button class="btn" value="cancel">Cancel</button><button class="btn primary" id="go" disabled>Import</button></footer>`);
  let rows = [];
  $('#tpl', f).onclick = e => { e.preventDefault(); const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(['﻿Student ID,Name,Section\r\n2024-00001,Juan Dela Cruz,BSIT 2A\r\n'], { type: 'text/csv' })), download: 'students-template.csv' }); a.click(); };
  $('#file', f).onchange = async e => {
    const all = parseCsv((await e.target.files[0].text()).replace(/^﻿/, ''));
    const head = all[0]?.map(h => h.toLowerCase()) ?? [];
    const hasHead = head.some(h => /name|student|section|id/.test(h));
    const idx = k => (hasHead ? head.findIndex(h => h.includes(k)) : { id: 0, name: 1, section: 2 }[k]);
    const iId = hasHead ? head.findIndex(h => /id|no|number/.test(h)) : 0, iName = idx('name'), iSec = idx('section');
    rows = all.slice(hasHead ? 1 : 0).map(r => ({ id: (r[iId] ?? '').trim(), name: (r[iName] ?? '').trim(), section: iSec >= 0 ? (r[iSec] ?? '').trim() : '' })).filter(r => r.id && r.name);
    $('#preview', f).innerHTML = rows.length ? `<p class="muted">${rows.length} student(s) found. First rows:</p><div class="table-wrap"><table><tr><th>ID</th><th>Name</th><th>Section</th></tr>${rows.slice(0, 5).map(r => `<tr><td>${esc(r.id)}</td><td>${esc(r.name)}</td><td>${esc(r.section)}</td></tr>`).join('')}</table></div>` : '<p class="error">No rows with both an ID and a name were found.</p>';
    $('#go', f).disabled = !rows.length;
  };
  $('#go', f).onclick = async e => {
    e.preventDefault();
    try {
      const r = await api('/api/students/import', { method: 'POST', body: { rows } });
      closeModal(); toast(`Imported: ${r.created} new, ${r.updated} updated, ${r.sectionsCreated} new section(s)`); invalidate('sections'); onDone?.();
    } catch (err) { $('#formErr', f).textContent = err.message; }
  };
}

// ------------------------------------------------------------------ MY ACCOUNT
async function accountPage() {
  $('#view').innerHTML = `<div class="two"><div class="card" style="display:grid;gap:14px;align-content:start">
      <div class="person"><span class="avatar" style="width:56px;height:56px;font-size:20px">${esc(initials(me.name))}</span><span><b style="font-size:18px">${esc(me.name)}</b><br>${badge('in_progress', label(me.role))}</span></div>
      <p class="muted" style="margin:0">${{ admin: 'Full access to users, records, settings and reports.', technician: 'Workstations, error reports, maintenance and inventory.', instructor: 'Attendance, class sheets, live lab monitoring and reports.' }[me.role]}</p>
      <p class="muted" style="margin:0">Tip: ask the administrator to enroll your fingerprint so you can unlock staff tools at the kiosk.</p></div>
    <form class="card" id="pw" style="display:grid;gap:14px"><h3 style="display:flex;gap:10px;align-items:center">${icon('shield')} Change password</h3>
      <label>Current password<input type="password" name="current" required autocomplete="current-password"></label>
      <label>New password<input type="password" name="next" required minlength="8" autocomplete="new-password"></label>
      <label>Repeat new password<input type="password" name="again" required minlength="8" autocomplete="new-password"></label>
      <p class="error" id="pwErr"></p><button class="btn primary">Update password</button></form></div>`;
  $('#pw').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    if (f.get('next') !== f.get('again')) return ($('#pwErr').textContent = 'The new passwords do not match.');
    try { await api('/api/me/password', { method: 'POST', body: { current: f.get('current'), next: f.get('next') } }); toast('Password changed. Please sign in again.'); setTimeout(signOut, 1200); }
    catch (err) { $('#pwErr').textContent = err.message; }
  };
}

// ------------------------------------------------------------------ BOOT
if (token) start(); else $('#login').hidden = false;
