// Time cards: every person's logged time, week by week, for payroll and billing.
import { state, get, can } from '../api.js';
import { h, table, attempt, fmtDate, fmtDateTime, personOptions } from '../ui.js';

const go = (hash) => { location.hash = hash; };
const seesOthers = () => can('timecards') || can('hr') || can('view_financials');
const hours = (sec) => (Math.round((sec / 3600) * 100) / 100).toFixed(2);
const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function weekStart(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}
const shift = (d, days) => { const x = new Date(d); x.setDate(x.getDate() + days); return x; };

export async function timecard(main, personnelId) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const pid = Number(personnelId) || state.me.personnel_id;
  let from = params.get('from') ? new Date(`${params.get('from')}T00:00:00`) : weekStart(new Date());
  let to = params.get('to') ? shift(new Date(`${params.get('to')}T00:00:00`), 1) : shift(from, 7);

  const head = h('div', { class: 'page-head' });
  const body = h('div');
  main.append(head, body);
  if (!pid) {
    head.append(h('h1', {}, 'Time card'));
    body.append(h('div', { class: 'card empty' }, 'Your login is not linked to a personnel record yet. Ask an admin to link it under Users & permissions.',
      seesOthers() ? ' You can still pick someone below.' : ''));
    if (!seesOthers()) return;
  }

  const fromInput = h('input', { type: 'date', style: 'width:auto' });
  const toInput = h('input', { type: 'date', style: 'width:auto' });
  const reload = (newPid = pid) => go(`#/timecard${newPid ? `/${newPid}` : ''}?from=${localDay(from)}&to=${localDay(shift(to, -1))}`);
  const setRange = (f, t) => { from = f; to = t; reload(); };

  const personSel = seesOthers() ? h('select', { style: 'width:auto;min-width:220px', onchange: (e) => reload(Number(e.target.value) || null) },
    h('option', { value: '' }, '— Pick a person —'), personOptions().map((o) => h('option', { value: o.value, selected: o.value === pid }, o.label))) : null;

  if (!pid) { head.append(h('div', { class: 'actions' }, personSel)); return; }
  const data = await get(`/timecard?personnel_id=${pid}&from=${from.toISOString()}&to=${to.toISOString()}`);
  fromInput.value = localDay(from);
  toInput.value = localDay(shift(to, -1));
  const applyCustom = () => { if (fromInput.value && toInput.value) setRange(new Date(`${fromInput.value}T00:00:00`), shift(new Date(`${toInput.value}T00:00:00`), 1)); };
  fromInput.addEventListener('change', applyCustom);
  toInput.addEventListener('change', applyCustom);

  const p = data.person;
  const isMine = pid === state.me.personnel_id;
  head.append(
    h('div', {}, h('h1', {}, isMine ? 'My time card' : `Time card — ${p.name}`),
      h('div', { class: 'muted' }, [...new Set([p.position || 'No position set', p.title, p.employment_type].filter(Boolean))].join(' · '))),
    h('div', { class: 'actions' }, personSel,
      h('button', { onclick: () => setRange(shift(from, -7), shift(from, 0)) }, '← Week'),
      h('button', { onclick: () => setRange(weekStart(new Date()), shift(weekStart(new Date()), 7)) }, 'This week'),
      h('button', { onclick: () => setRange(shift(from, 7), shift(from, 14)) }, 'Week →'),
      fromInput, toInput,
      h('button', { onclick: () => exportCsv(p, data.entries, from, to) }, '⬇ Export CSV')));

  const total = data.entries.reduce((s, e) => s + e.seconds, 0);
  const group = (key) => {
    const m = new Map();
    for (const e of data.entries) m.set(e[key] ?? '—', (m.get(e[key] ?? '—') || 0) + e.seconds);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const days = [];
  for (let d = new Date(from); d < to; d = shift(d, 1)) days.push(localDay(d));
  const byDay = Object.fromEntries(days.map((d) => [d, 0]));
  for (const e of data.entries) byDay[localDay(e.started_at)] = (byDay[localDay(e.started_at)] || 0) + e.seconds;

  body.append(
    h('div', { class: 'grid cols-4', style: 'margin-bottom:14px' },
      h('div', { class: 'card' }, h('div', { class: 'timer' }, hours(total)), h('div', { class: 'muted' }, `hours · ${fmtDate(localDay(from))} – ${fmtDate(localDay(shift(to, -1)))}`)),
      h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, 'By billing number'),
        group('billing_code').map(([k, v]) => h('div', { class: 'inline', style: 'justify-content:space-between' }, h('span', { class: 'mono' }, k), h('b', {}, hours(v))))),
      h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, 'By project'),
        group('project_name').map(([k, v]) => h('div', { class: 'inline', style: 'justify-content:space-between' }, h('span', {}, k), h('b', {}, hours(v))))),
      h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, 'Logged as'),
        group('position').map(([k, v]) => h('div', { class: 'inline', style: 'justify-content:space-between' }, h('span', {}, k), h('b', {}, hours(v)))))),
    h('div', { class: 'card' }, h('h2', {}, 'Daily totals'), h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, days.map((d) => h('th', {}, new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' }))), h('th', {}, 'Total'))),
      h('tbody', {}, h('tr', {}, days.map((d) => h('td', {}, byDay[d] ? hours(byDay[d]) : h('span', { class: 'muted' }, '—'))), h('td', {}, h('b', {}, hours(total)))))))),
    h('div', { class: 'card' }, h('h2', {}, 'Entries'), table([
      { label: 'Date', render: (e) => fmtDate(localDay(e.started_at)) },
      { label: 'Ticket', render: (e) => [h('a', { href: `#/ticket/${e.ticket_id}`, onclick: (ev) => ev.stopPropagation() }, e.ticket_number), h('div', { class: 'small' }, e.title)] },
      { label: 'Project / client', render: (e) => [e.project_name, h('div', { class: 'muted small' }, e.client_name)] },
      { label: 'Billing #', render: (e) => h('span', { class: 'mono' }, e.billing_code) },
      { label: 'Logged as', render: (e) => [e.position, e.track !== 'main' ? h('div', { class: 'muted small' }, e.track) : null] },
      { label: 'Start – end', render: (e) => `${fmtDateTime(e.started_at)} – ${e.ended_at ? new Date(e.ended_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'running'}` },
      { label: 'Hours', render: (e) => (e.ended_at ? hours(e.seconds) : [h('span', { class: 'dot' }), ` ${hours(e.seconds)}`]) },
      { label: '', render: (e) => (e.manual ? h('span', { class: 'chip amber', title: e.note || '' }, 'edited') : '') },
    ], data.entries, { empty: 'No time logged in this period.' })));
}

function exportCsv(person, entries, from, to) {
  attempt(async () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Date', 'Person', 'Position (when logged)', 'Ticket', 'Title', 'Project #', 'Project', 'Client', 'Billing #', 'Track', 'Start', 'End', 'Hours', 'Edited', 'Note']];
    for (const e of entries) {
      rows.push([localDay(e.started_at), person.name, e.position, e.ticket_number, e.title, e.project_number, e.project_name, e.client_name, e.billing_code,
        e.track, new Date(e.started_at).toLocaleString(), e.ended_at ? new Date(e.ended_at).toLocaleString() : 'running', hours(e.seconds), e.manual ? 'yes' : '', e.note]);
    }
    const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `timecard-${person.name.replace(/\s+/g, '-')}-${localDay(from)}-to-${localDay(shift(to, -1))}.csv` });
    document.body.append(a); a.click(); a.remove();
  });
}

// Project/billing report block: cumulative hours by position, plus per person when allowed.
export async function timeSummaryCard(query, title = 'Time by position') {
  const s = await get(`/time/summary?${new URLSearchParams(query)}`);
  const max = Math.max(1, ...s.by_position.map((r) => r.seconds));
  return h('div', { class: 'card' },
    h('div', { class: 'page-head', style: 'margin-bottom:6px' }, h('h2', {}, title), h('div', { class: 'actions' }, h('b', {}, `${hours(s.total_seconds)} h total`))),
    s.by_position.length ? h('div', {}, s.by_position.map((r) => h('div', { style: 'margin-bottom:8px' },
      h('div', { class: 'inline', style: 'justify-content:space-between' }, h('span', {}, h('b', {}, r.position), h('span', { class: 'muted small' }, ` · ${r.people} ${r.people === 1 ? 'person' : 'people'}`)), h('b', {}, `${hours(r.seconds)} h`)),
      h('div', { style: `height:6px;border-radius:3px;background:var(--accent);opacity:.75;width:${(r.seconds / max) * 100}%` }))))
      : h('p', { class: 'muted' }, 'No time logged yet.'),
    s.by_person ? [h('h3', {}, 'By person'), table([
      { label: 'Person', render: (r) => (r.personnel_id ? h('a', { href: `#/timecard/${r.personnel_id}?from=2000-01-01&to=${localDay(new Date())}` }, r.name) : '—') },
      { label: 'Logged as', key: 'position' },
      { label: 'Type', key: 'employment_type' },
      { label: 'Hours', render: (r) => hours(r.seconds) },
    ], s.by_person, { empty: 'None.' })] : null,
    s.by_account.length > 1 ? [h('h3', {}, 'By billing number'), table([
      { label: 'Billing #', render: (r) => h('span', { class: 'mono' }, r.billing_code) }, { label: 'Department', key: 'department' }, { label: 'Hours', render: (r) => hours(r.seconds) },
    ], s.by_account)] : null);
}

