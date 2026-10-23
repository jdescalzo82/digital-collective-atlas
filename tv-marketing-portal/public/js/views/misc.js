// Home, barcode scan page, notifications, import, and admin screens.
import { state, get, post, patch, can, loadMeta } from '../api.js';
import { h, clear, form, table, statusChip, attempt, modal, toast, fmtDateTime, fmtClock, personOptions } from '../ui.js';
import { menu, onLeave, refreshLookup } from '../app.js';

const go = (hash) => { location.hash = hash; };

// ======================= HOME =======================
export async function home(main) {
  const d = await get('/dashboard');
  const tile = (n, label, href, note) => h('a', { class: 'card tile', href }, h('div', { class: 'n' }, n), h('div', {}, label), note ? h('div', { class: 'muted small' }, note) : null);
  const tiles = [
    tile(d.my_open, 'My open tickets', '#/my'),
    tile(`${d.my_hours_week}h`, 'Logged in the last 7 days', '#/my', 'Tracked automatically'),
    tile(d.active_projects, 'Active projects', '#/projects'),
  ];
  for (const [b, n] of Object.entries(d.drafts)) tiles.push(tile(n, `${state.meta.boards[b].label} drafts to assign`, '#/manage'));
  if (d.hr_pending !== undefined) tiles.push(tile(d.hr_pending, 'People for HR to process', '#/hr'));
  if (d.it_pending !== undefined) tiles.push(tile(d.it_pending, 'Setups for IT', '#/it'));

  const running = d.my_running.length ? h('div', { class: 'card' }, h('h2', {}, 'Your clock is running'),
    d.my_running.map((r) => {
      const base = (Date.now() - new Date(r.started_at).getTime()) / 1000;
      return h('p', {}, h('span', { class: 'dot' }), ' ', h('a', { href: `#/ticket/${r.id}` }, `${r.ticket_number} ${r.title}`), r.track !== 'main' ? ` (${r.track})` : '', ' — ',
        h('b', { 'data-since': new Date().toISOString(), 'data-base': base }, fmtClock(base)));
    }),
    h('p', { class: 'small muted' }, 'Change the ticket status to On Hold or Completed to stop it.')) : null;
  if (running) {
    const id = setInterval(() => document.querySelectorAll('[data-since]').forEach((el) => {
      el.textContent = fmtClock(Number(el.dataset.base) + (Date.now() - new Date(el.dataset.since).getTime()) / 1000);
    }), 1000);
    onLeave(() => clearInterval(id));
  }

  main.append(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, `Hi, ${state.me.display_name.split(' ')[0]}`), h('div', { class: 'muted' }, 'Pick where you want to go — or use the “Go to…” menu at the top.'))),
    running || '',
    h('div', { class: 'grid cols-4', style: 'margin-bottom:14px' }, tiles),
    h('div', { class: 'grid cols-3' }, menu().filter((g) => g.group !== 'Start').map((g) => h('div', { class: 'card menu-group' },
      h('h3', {}, g.group), g.items.map((i) => h('a', { href: i.href }, i.label))))));
}

// ======================= SCAN =======================
export async function scanPage(main) {
  const result = h('div', { style: 'margin-top:14px' });
  const handle = async (code) => {
    if (!code) return;
    const r = await get(`/scan/${encodeURIComponent(code)}`);
    if (r.type) return go(`#/${r.type}/${r.id}`);
    clear(result).append(h('div', { class: 'card' }, h('p', {}, 'No item with number ', h('b', { class: 'mono' }, code), ' yet.'),
      can('onboarding') ? h('div', { class: 'inline' },
        h('a', { class: 'btn primary', href: `#/media/new?code=${encodeURIComponent(code)}` }, 'Register as physical media'),
        h('a', { class: 'btn', href: `#/equipment/new?code=${encodeURIComponent(code)}` }, 'Register as equipment')) : h('p', { class: 'muted' }, 'Ask someone with onboarding access to register it.')));
  };
  const manual = h('input', { placeholder: 'Type or use a handheld scanner, then Enter', autocomplete: 'off',
    onkeydown: (e) => { if (e.key === 'Enter') handle(e.target.value.trim()); } });
  main.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Scan a barcode'),
    h('div', { class: 'muted' }, 'Looks up physical media and equipment by item number.'))),
  h('div', { class: 'card', style: 'max-width:560px' },
    h('button', { class: 'primary', style: 'width:100%;justify-content:center;padding:16px;font-size:16px', onclick: async () => {
      const { scanBarcode } = await import('../scanner.js');
      handle(await scanBarcode());
    } }, '📷 Open camera'),
    h('h3', {}, 'Or enter it'), manual), result);
  manual.focus();
}

// ======================= NOTIFICATIONS =======================
export async function notifications(main) {
  const rows = await get('/notifications');
  main.append(h('div', { class: 'page-head' }, h('h1', {}, 'Notifications'),
    h('div', { class: 'actions' }, h('button', { onclick: () => attempt(async () => { await post('/notifications/read'); go(`#/notifications?t=${Date.now()}`); }) }, 'Mark all read'))),
  h('div', { class: 'card' }, table([
    { label: 'When', render: (n) => fmtDateTime(n.created_at) },
    { label: '', render: (n) => h('span', { class: n.read ? '' : 'notif unread' }, n.text) },
    { label: 'Ticket', render: (n) => n.ticket_number || '' },
  ], rows, {
    empty: 'You\'re all caught up.',
    onRow: async (n) => { await post('/notifications/read', { ids: [n.id] }); go(n.ticket_id ? `#/ticket/${n.ticket_id}` : n.text.includes('Setup') ? '#/it' : '#/hr'); },
  })));
}

// ======================= IMPORT =======================
export async function importPage(main) {
  const labels = { personnel: 'Personnel', clients: 'Clients', projects: 'Project titles', media: 'Physical media', equipment: 'Equipment' };
  const entity = h('select', { style: 'width:auto' }, Object.entries(labels).map(([k, v]) => h('option', { value: k }, v)));
  const file = h('input', { type: 'file', accept: '.csv,.tsv,.txt,.json,.pdf,image/*' });
  const paste = h('textarea', { rows: 5, placeholder: 'Or paste rows from a spreadsheet, an email signature, a contact list…' });
  const preview = h('div');
  let records = [];

  const readFile = (f) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(f);
  });
  const parse = (e) => attempt(async () => {
    const btn = e.target;
    let payload;
    if (file.files[0]) {
      const f = file.files[0];
      payload = { name: f.name, mimeType: f.type || '', data: await readFile(f) };
    } else if (paste.value.trim()) payload = { text: paste.value };
    else throw new Error('Choose a file or paste something first');
    btn.disabled = true; btn.textContent = 'Reading…';
    try {
      records = (await post('/import/parse', { entity: entity.value, file: payload })).records;
    } finally { btn.disabled = false; btn.textContent = 'Read records'; }
    renderPreview();
  });

  const renderPreview = () => {
    const fields = state.meta.importFields[entity.value];
    clear(preview);
    if (!records.length) { preview.append(h('div', { class: 'card empty' }, 'No records found.')); return; }
    preview.append(h('div', { class: 'card' },
      h('div', { class: 'page-head' }, h('h2', {}, `Review ${records.length} record(s)`), h('div', { class: 'actions' },
        h('button', { class: 'primary', onclick: commit }, `Import ${records.length}`))),
      h('p', { class: 'muted small' }, 'Check and correct anything before importing. Nothing is saved until you click Import.'),
      h('div', { class: 'table-wrap preview-table' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}), fields.map((f) => h('th', {}, f.replace(/_/g, ' '))))),
        h('tbody', {}, records.map((r, i) => h('tr', {},
          h('td', {}, h('button', { class: 'sm ghost', title: 'Remove row', onclick: () => { records.splice(i, 1); renderPreview(); } }, '✕')),
          fields.map((f) => h('td', {}, h('input', { value: r[f] ?? '', oninput: (e) => { r[f] = e.target.value; } }))))))))));
  };
  const commit = () => attempt(async () => {
    const res = await post('/import/commit', { entity: entity.value, records });
    await refreshLookup();
    toast(`Imported ${res.imported} of ${records.length}`);
    const failed = res.results.filter((r) => !r.ok);
    // Leave only the failed rows in the editor so they can be fixed and retried.
    records = records.filter((_, i) => !res.results[i].ok);
    if (failed.length) {
      renderPreview();
      preview.prepend(h('div', { class: 'card' }, h('h2', {}, `${failed.length} row(s) need attention`),
        h('ul', {}, failed.map((f) => h('li', {}, `Row ${f.row}: ${f.error}`)))));
    } else {
      clear(preview).append(h('div', { class: 'card' }, h('p', {}, '✅ All records imported.'), h('a', { href: `#/${entity.value}` }, `Open ${labels[entity.value]} →`)));
    }
  });

  main.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Import'),
    h('div', { class: 'muted' }, 'Bring records in from spreadsheets, documents or screenshots.'))),
  h('div', { class: 'card' }, h('div', { class: 'form' },
    h('div', { class: 'field' }, h('label', {}, 'What are you importing?'), entity),
    h('div', { class: 'field' }, h('label', {}, 'File'), file,
      h('div', { class: 'help' }, state.meta.aiImport ? 'CSV, TSV, JSON, text, PDF or a screenshot/photo.' : 'CSV, TSV or JSON. (Screenshots and PDFs need ANTHROPIC_API_KEY on the server.)')),
    h('div', { class: 'field full' }, h('label', {}, 'Paste'), paste)),
  h('div', { style: 'margin-top:12px' }, h('button', { class: 'primary', onclick: parse }, 'Read records'))), preview);
}

// ======================= ADMIN: OPTIONS =======================
const CATEGORY_LABELS = {
  department: 'Departments (with billing codes)', title: 'Titles / roles', employment_type: 'Employment types', rate_frequency: 'Rate frequencies',
  sector: 'Client sectors', client_department: 'Client departments', scope_of_work: 'Scope of work', media_type: 'Media types',
  equipment_type: 'Equipment types', ae_category: 'AE ticket categories', duration: 'Spot durations', workstation_location: 'Workstation locations',
  software: 'Software (IT)', hardware: 'Hardware (IT)',
};
export async function adminOptions(main) {
  const all = await get('/options');
  const cat = h('select', { style: 'width:auto', onchange: () => render() }, Object.entries(CATEGORY_LABELS).map(([k, v]) => h('option', { value: k }, v)));
  const body = h('div', { class: 'card' });
  const render = () => {
    const c = cat.value;
    const list = all.filter((o) => o.category === c);
    const value = h('input', { placeholder: 'New option' });
    const code = h('input', { placeholder: 'Billing code (e.g. ED)', style: 'max-width:180px' });
    clear(body).append(
      table([
        { label: 'Value', render: (o) => h('input', { value: o.value, onchange: (e) => attempt(() => patch(`/options/${o.id}`, { value: e.target.value }), 'Saved') }) },
        ...(c === 'department' ? [{ label: 'Billing code', render: (o) => h('input', { value: o.code || '', style: 'max-width:120px', onchange: (e) => attempt(() => patch(`/options/${o.id}`, { code: e.target.value }), 'Saved') }) }] : []),
        { label: 'Active', render: (o) => h('input', { type: 'checkbox', checked: o.active, onchange: (e) => attempt(async () => { await patch(`/options/${o.id}`, { active: e.target.checked }); o.active = e.target.checked ? 1 : 0; }, 'Saved') }) },
      ], list),
      h('div', { class: 'inline', style: 'margin-top:12px' }, value, c === 'department' ? code : null,
        h('button', { class: 'primary', onclick: () => attempt(async () => {
          const o = await post('/options', { category: c, value: value.value, code: code.value });
          all.push(o); render();
        }, 'Added') }, 'Add')));
  };
  main.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Dropdown options'),
    h('div', { class: 'muted' }, 'Every standardized field pulls from these lists. Deactivate instead of deleting so old records keep their value.')),
  h('div', { class: 'actions' }, cat)), body);
  render();
  onLeave(() => { loadMeta(); });
}

// ======================= ADMIN: USERS =======================
export async function adminUsers(main) {
  const users = await get('/users');
  const perms = state.meta.permissions;
  const userForm = (u = {}) => form([
    { name: 'display_name', label: 'Name', required: true },
    ...(u.id ? [] : [{ name: 'username', label: 'Username', required: true }]),
    { name: 'role', label: 'Role label', placeholder: 'e.g. AE Lead' },
    { name: 'personnel_id', label: 'Linked personnel record', type: 'select', options: personOptions(), numeric: true,
      help: 'Links their login to tickets assigned to them and to their time.' },
    { name: 'password', label: u.id ? 'Reset password' : 'Password', type: 'password', required: !u.id },
    { name: 'permissions', label: 'Permissions', type: 'multi', options: Object.entries(perms).map(([k, v]) => ({ value: k, label: `${k} — ${v}` })) },
  ], { ...u, permissions: String(u.permissions || '').split(',').filter(Boolean) });
  const open = (u) => {
    const f = userForm(u);
    modal(u ? `Edit ${u.display_name}` : 'New user', f.el, [
      ...(u ? [{ label: u.active ? 'Deactivate' : 'Reactivate', class: u.active ? 'danger' : '', onClick: () => attempt(async () => { await patch(`/users/${u.id}`, { active: !u.active }); go(`#/admin/users?t=${Date.now()}`); }) }] : []),
      { label: 'Cancel' },
      { label: 'Save', class: 'primary', onClick: () => attempt(async () => {
        const v = f.values();
        if (!v.password) delete v.password;
        if (u) await patch(`/users/${u.id}`, v); else await post('/users', v);
        go(`#/admin/users?t=${Date.now()}`);
      }, 'Saved') },
    ]);
  };
  main.append(h('div', { class: 'page-head' }, h('h1', {}, 'Users & permissions'),
    h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => open() }, '+ New user'))),
  h('div', { class: 'card' }, table([
    { label: 'Name', render: (u) => h('b', {}, u.display_name) },
    { label: 'Username', key: 'username' }, { label: 'Role', key: 'role' },
    { label: 'Personnel', key: 'personnel_name' },
    { label: 'Permissions', render: (u) => h('div', { class: 'chips' }, String(u.permissions).split(',').filter(Boolean).map((p) => h('span', { class: 'chip' }, p))) },
    { label: 'Status', render: (u) => statusChip(u.active ? 'Active' : 'Closed') },
  ], users, { onRow: open })));
}

