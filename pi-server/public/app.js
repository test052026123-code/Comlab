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
const badge = s => `<span class="badge s-${esc(s)}">${esc(label(s))}</span>`;

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
const PAGES = [
  ['Monitoring'],
  ['overview', 'Overview', ALL, overview],
  ['attendance', 'Attendance', ALL, attendancePage],
  ['Laboratory'],
  ['workstations', 'Workstations & map', ALL, workstationsPage],
  ['issues', 'Error reports', ALL, () => crudPage('issues')],
  ['maintenance', 'Maintenance logs', TECH, () => crudPage('maintenance')],
  ['inventory', 'Inventory', TECH, () => crudPage('inventory')],
  ['reports', 'Reports & analytics', ALL, reportsPage],
  ['Records'],
  ['students', 'Students', ALL, () => crudPage('students')],
  ['classes', 'Class schedules', ALL, () => crudPage('classes')],
  ['sections', 'Sections', ALL, () => crudPage('sections')],
  ['subjects', 'Subjects', ALL, () => crudPage('subjects')],
  ['System'],
  ['users', 'Staff accounts', ADMIN, () => crudPage('users')],
  ['fingerprints', 'Fingerprint sensor', ADMIN, fingerprintsPage],
  ['settings', 'Settings', ADMIN, settingsPage],
  ['audit', 'Activity log', ADMIN, auditPage],
];
function renderNav() {
  let html = '', pending = null;
  for (const p of PAGES) {
    if (p.length === 1) { pending = p[0]; continue; }
    if (!p[2].includes(me.role)) continue;
    if (pending) { html += `<div class="group">${pending}</div>`; pending = null; }
    html += `<a href="#/${p[0]}" data-page="${p[0]}">${p[1]}</a>`;
  }
  $('#nav').innerHTML = html;
}
async function route() {
  clearInterval(timer);
  const id = location.hash.slice(2) || 'overview';
  const page = PAGES.find(p => p[0] === id && p[2]?.includes(me.role)) ?? PAGES[1];
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.page === page[0]));
  $('.side').classList.remove('open');
  $('#title').textContent = page[1];
  $('#view').innerHTML = '<p class="muted">Loading…</p>';
  await run(page[3])();
}
window.addEventListener('hashchange', () => me && route());
setInterval(() => ($('#clock').textContent = new Date().toLocaleString('en-PH', { weekday: 'short', hour: 'numeric', minute: '2-digit' })), 1000);

async function start() {
  try { me = await api('/me'); } catch { return signOut(); }
  $('#who').textContent = `${me.name} · ${me.role}`;
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
    cols: [['id', 'Student ID'], ['name', 'Name'], ['sectionId', 'Section', 'ref:sections'], ['fingerprintSlot', 'Fingerprint', r => (r.fingerprintSlot != null ? `✅ Slot ${r.fingerprintSlot}` : '<span class="muted">Not enrolled</span>')],
      ['active', 'Status', r => badge(r.active ? 'working' : 'disposed').replace(/Working|Disposed/, r.active ? 'Active' : 'Inactive')]],
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
    extra: r => (TECH.includes(me.role) ? `<button class="btn small" data-log="${esc(r.id)}">Log action</button>` : ''),
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
    cols: [['username', 'Username'], ['name', 'Name'], ['role', 'Role', r => label(r.role)],
      ['fingerprintSlot', 'Fingerprint', r => (r.fingerprintSlot != null ? `✅ Slot ${r.fingerprintSlot}` : '<span class="muted">—</span>')], ['active', 'Active', r => (r.active ? 'Yes' : 'No')]],
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
      <label class="grow">Search<input id="q" placeholder="Type to filter…"></label>
      ${(R.filters ?? []).map(([k, opts]) => `<label>${label(k)}<select data-filter="${k}"><option value="">All</option>${opts.map(o => `<option value="${o}">${label(o)}</option>`).join('')}</select></label>`).join('')}
      ${canWrite ? `<button class="btn primary" id="add">+ Add ${R.title.toLowerCase()}</button>` : ''}
    </div>
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
      : `<tr><td colspan="${R.cols.length + 1}" class="empty">No records yet.</td></tr>`;
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
    <div class="fp" id="fp"><div class="icon">☝️</div><div class="steps"><span></span><span></span><span></span></div><b id="fpMsg">Starting…</b></div>
    <footer><button class="btn" value="cancel" id="fpCancel">Close</button></footer>`);
  let jobId = null, stop = false;
  $('#modal').addEventListener('closed', () => { stop = true; if (jobId) api(`/fingerprint/requests/${jobId}/cancel`, { method: 'POST' }).catch(() => {}); }, { once: true });
  const show = (msg, step, cls = '') => {
    $('#fpMsg', f).textContent = msg; $('#fp', f).className = `fp ${cls}`;
    f.querySelectorAll('.steps span').forEach((s, i) => s.classList.toggle('on', i < step));
    $('.icon', f).textContent = cls === 'done' ? '✅' : cls === 'error' ? '⚠️' : step === 2 ? '✋' : '☝️';
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
    const who = p.session?.studentName ? `${esc(p.session.studentName)} · since ${time(p.session.timeIn)}` : (p.online ? `Power ${p.power}` : 'Node offline');
    const pos = placed ? `left:${Math.min(p.mapX, 87)}%;top:${Math.min(p.mapY, 82)}%` : '';
    return `<div class="pc s-${p.status}" data-pc="${esc(p.id)}" style="${pos}"><b>${esc(p.label)}</b><small>${esc(label(p.status))}</small><small>${who}</small></div>`;
  };
  return `<div class="map ${placed ? '' : 'grid'} ${editing ? 'editing' : ''}" id="map">${pcs.map(tile).join('') || '<p class="empty">No workstations yet. Add them under Workstations & map.</p>'}</div>
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
  v.innerHTML = `<div class="stats" id="stats"></div>
    <div><div class="section-head"><h3>Interactive laboratory map</h3><span class="muted">Live · updates every 5 s</span></div><div id="mapBox"></div></div>
    <div class="two"><div><div class="section-head"><h3>Active users</h3></div><div class="table-wrap" id="active"></div></div>
    <div><div class="section-head"><h3>Open error reports</h3><a href="#/issues">View all</a></div><div class="table-wrap" id="openIssues"></div></div></div>`;
  let pcs = [];
  const refresh = run(async () => {
    const [s, live, issues] = await Promise.all([api('/api/summary'), api('/workstations/live'), api('/api/issues')]);
    pcs = live.workstations;
    const w = s.workstations;
    $('#stats').innerHTML = [[s.activeSessions, 'Active users'], [s.attendanceToday, 'Students today'], [`${w.idle + w.off}/${w.total}`, 'PCs available'],
      [w.inUse, 'PCs in use'], [w.offline, 'PCs offline'], [w.maintenance, 'Maintenance'], [s.openIssues, 'Open error reports']]
      .map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
    $('#mapBox').innerHTML = mapHtml(pcs);
    const act = pcs.filter(p => p.session);
    $('#active').innerHTML = act.length ? `<table><tr><th>PC</th><th>Student</th><th>Since</th></tr>${act.map(p => `<tr><td>${esc(p.label)}</td><td>${esc(p.session.studentName)}</td><td>${time(p.session.timeIn)}</td></tr>`).join('')}</table>` : '<p class="empty">No one is using the lab.</p>';
    const open = issues.rows.filter(i => i.status !== 'resolved').slice(0, 8);
    $('#openIssues').innerHTML = open.length ? `<table><tr><th>PC</th><th>Problem</th><th>Status</th></tr>${open.map(i => `<tr><td>${esc(i.workstationId ?? '')}</td><td>${esc(i.description)}</td><td>${badge(i.status)}</td></tr>`).join('')}</table>` : '<p class="empty">No open reports. 🎉</p>';
  });
  await refresh();
  timer = setInterval(refresh, 5000);
  $('#mapBox').onclick = e => { const t = e.target.closest('[data-pc]'); if (t) pcDialog(pcs.find(p => p.id === t.dataset.pc), refresh); };
}

async function workstationsPage() {
  const v = $('#view'), canEdit = TECH.includes(me.role);
  v.innerHTML = `<div><div class="section-head"><h3>Laboratory layout</h3>
      ${canEdit ? '<span><button class="btn" id="editMap">Arrange layout</button> <button class="btn primary" id="saveMap" hidden>Save layout</button></span>' : ''}</div>
      <p class="muted no-print" id="mapHint" hidden>Drag each PC to where it is in the room, then press Save layout. The tablet shows the same map.</p>
      <div id="mapBox"></div></div>
    <div><div class="section-head"><h3>Workstations</h3><button class="btn" id="addWs" ${canEdit ? '' : 'hidden'}>+ Add workstation</button></div><div class="table-wrap" id="wsTable"></div></div>`;
  let pcs = [], editing = false;
  const draw = () => {
    $('#mapBox').innerHTML = mapHtml(pcs, { editing });
    $('#wsTable').innerHTML = pcs.length ? `<table><tr><th>PC</th><th>Name</th><th>Node</th><th>Status</th><th>Power</th><th>Network</th><th>Last heartbeat</th><th class="actions"></th></tr>
      ${pcs.map(p => `<tr><td>${esc(p.id)}</td><td>${esc(p.label)}</td><td>${esc(p.nodeId ?? '—')}</td><td>${badge(p.status)}</td><td>${esc(p.power)}</td>
        <td>${p.online ? `Connected · ${esc(p.rssi ?? '?')} dBm` : '<span class="badge s-OFFLINE">Disconnected</span>'}</td><td>${p.lastSeen ? fmt(p.lastSeen) : 'never'}</td>
        <td class="actions">${canEdit ? `<button class="btn small" data-edit="${esc(p.id)}">Edit</button> <button class="btn small danger" data-del="${esc(p.id)}">Delete</button>` : ''}</td></tr>`).join('')}</table>`
      : '<p class="empty">No workstations yet.</p>';
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
    ${r.rows.length ? r.rows.map(row => `<tr>${r.columns.map(([k]) => `<td>${k === 'status' || k === 'condition' ? badge(row[k]) : esc(row[k])}</td>`).join('')}</tr>`).join('') : `<tr><td class="empty" colspan="${r.columns.length}">No records for this filter.</td></tr>`}
    </tbody></table></div>`;
}
const exportButtons = `<span class="no-print"><button class="btn" data-x="xlsx">⬇ Excel</button> <button class="btn" data-x="csv">⬇ CSV</button> <button class="btn" data-x="pdf">🖨 Print / PDF</button></span>`;

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
    $('#out').innerHTML = `<p class="muted">${r.rows.length} record(s) · ${new Set(r.rows.map(x => x.studentId)).size} student(s)</p>${reportTable(r)}`;
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
    $('#kpi').innerHTML = kpi.map(([n, l]) => `<div class="stat"><b>${esc(n)}</b><span>${l}</span></div>`).join('');
    if (rep === 'usage') {
      const max = Math.max(1, ...r.rows.map(x => x.hours));
      $('#out').innerHTML = `<div class="card"><h3 style="margin-bottom:12px">Hours used per PC</h3>${r.rows.map(x => `<div style="display:grid;grid-template-columns:90px 1fr 60px;gap:10px;align-items:center;margin:6px 0">
        <span>${esc(x.label)}</span><span style="height:14px;border-radius:7px;background:var(--teal);width:${(x.hours / max) * 100}%;min-width:2px"></span><span class="muted">${x.hours} h</span></div>`).join('')}</div>${reportTable(r)}`;
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
    if (!st.ready) { v.innerHTML = `<div class="card"><h3>⚠️ Sensor not ready</h3><p>${esc(st.error ?? 'Check the AS608 wiring and power.')}</p><button class="btn" id="retry">Retry</button></div>`; $('#retry').onclick = draw; return; }
    const s = await api('/api/fingerprint/slots');
    v.innerHTML = `<div class="stats"><div class="stat"><b>${s.slots.length}</b><span>Stored fingerprints</span></div><div class="stat"><b>${s.capacity}</b><span>Sensor capacity</span></div>
      <div class="stat"><b>${s.slots.filter(x => !x.owner).length}</b><span>Unlinked (orphan) slots</span></div></div>
      ${s.missingOnSensor.length ? `<div class="card"><b>⚠️ Missing on sensor:</b> ${s.missingOnSensor.map(m => esc(m.name)).join(', ')} — re-enroll them.</div>` : ''}
      <p class="muted">To enroll, open <a href="#/students">Students</a> or <a href="#/users">Staff accounts</a> and press “Enroll finger”.</p>
      <div class="table-wrap"><table><tr><th>Slot</th><th>Linked to</th><th class="actions"></th></tr>${s.slots.map(x => `<tr><td>${x.slot}</td>
        <td>${x.owner ? `${esc(x.owner.name)} <span class="muted">(${x.owner.type} ${esc(x.owner.id)})</span>` : '<span class="badge s-open">Not linked</span>'}</td>
        <td class="actions"><button class="btn small danger" data-slot="${x.slot}">Delete</button></td></tr>`).join('') || '<tr><td colspan="3" class="empty">Sensor is empty.</td></tr>'}</table></div>`;
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
  v.innerHTML = `<form class="card" id="set" style="max-width:520px;display:grid;gap:14px"><h3>Kiosk tablet</h3>
    <label>Auto-assign a PC after (seconds)<input type="number" name="autoAssignAfterSeconds" min="10" max="300" value="${s.autoAssignAfterSeconds}"></label>
    <label>Welcome screen timeout (seconds)<input type="number" name="welcomeTimeoutSeconds" min="10" max="120" value="${s.welcomeTimeoutSeconds}"></label>
    <button class="btn primary">Save</button></form>`;
  $('#set').onsubmit = run(async e => {
    e.preventDefault(); const f = new FormData(e.target);
    await api('/api/settings/kiosk', { method: 'PUT', body: { autoAssignAfterSeconds: Number(f.get('autoAssignAfterSeconds')), welcomeTimeoutSeconds: Number(f.get('welcomeTimeoutSeconds')) } });
    toast('Settings saved');
  });
}

async function auditPage() {
  const r = await api('/api/audit');
  $('#view').innerHTML = `<div class="table-wrap"><table><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Detail</th></tr>
    ${r.rows.map(a => `<tr><td>${fmt(a.at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td>${esc(a.target ?? '')}</td><td class="muted">${esc(a.detail ?? '')}</td></tr>`).join('')}</table></div>`;
}

// ------------------------------------------------------------------ BOOT
if (token) start(); else $('#login').hidden = false;
