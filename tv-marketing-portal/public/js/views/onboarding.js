// Onboarding portals: personnel (Rolodex), clients, project titles, accounts,
// physical media and equipment.
import { state, get, post, patch, can, opts } from '../api.js';
import {
  h, clear, form, table, filterBar, statusChip, attempt, modal, fmtDate, fmtMoney, fmtDuration, qs,
  personOptions, clientOptions, projectOptions, toast,
} from '../ui.js';
import { refreshLookup } from '../app.js';

const editable = () => can('onboarding');
const go = (hash) => { location.hash = hash; };

async function listPage(main, { title, subtitle, newHref, newLabel, canCreate, filters, load, columns, rowHref, extraActions = [] }) {
  const body = h('div', { class: 'card' });
  const fb = filterBar(filters, (f) => render(f));
  const render = async (f = {}) => {
    const rows = await load(f);
    clear(body).append(table(columns, rows, { onRow: rowHref ? (r) => go(rowHref(r)) : null }),
      h('div', { class: 'muted small', style: 'margin-top:8px' }, `${rows.length} record${rows.length === 1 ? '' : 's'}`));
  };
  main.append(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, title), subtitle ? h('div', { class: 'muted' }, subtitle) : null),
      h('div', { class: 'actions' }, ...extraActions, canCreate ? h('a', { class: 'btn primary', href: newHref }, `+ ${newLabel}`) : null)),
    fb.el, body);
  await render();
}

function detailHead(title, back, backLabel, extra = []) {
  return h('div', { class: 'page-head' },
    h('div', {}, h('a', { href: back, class: 'small' }, `← ${backLabel}`), h('h1', {}, title)),
    h('div', { class: 'actions' }, ...extra));
}

function saveBar(onSave, label = 'Save') {
  return h('div', { style: 'margin-top:14px;display:flex;gap:8px' }, h('button', { class: 'primary', onclick: onSave }, label));
}

// ======================= PERSONNEL =======================
export async function personnelList(main) {
  const seesPay = can('hr') || can('view_financials');
  await listPage(main, {
    title: 'Personnel', subtitle: 'Staff and freelance Rolodex', newHref: '#/personnel/new', newLabel: 'Add person',
    canCreate: editable() || can('hr'),
    filters: [
      { type: 'search', key: 'q', placeholder: 'Search name, email, title…' },
      { key: 'department', label: 'All departments', options: opts('department') },
      { key: 'employment_type', label: 'Staff & freelance', options: opts('employment_type') },
    ],
    load: (f) => get(`/personnel${qs(f)}`),
    rowHref: (r) => `#/personnel/${r.id}`,
    columns: [
      { label: 'Name', render: (r) => h('b', {}, `${r.first_name} ${r.last_name}`) },
      { label: 'Title', key: 'title' },
      { label: 'Department', key: 'department' },
      { label: 'Type', key: 'employment_type' },
      ...(seesPay ? [{ label: 'Rate', render: (r) => (r.rate ? `${fmtMoney(r.rate)} / ${r.rate_frequency || '—'}` : '') }] : []),
      { label: 'Email', render: (r) => (r.email ? h('a', { href: `mailto:${r.email}`, onclick: (e) => e.stopPropagation() }, r.email) : '') },
      { label: 'Phone', render: (r) => r.mobile || r.phone || '' },
      { label: 'Projects', key: 'project_names' },
      { label: 'HR', render: (r) => statusChip(r.hr_status) },
    ],
  });
}

export async function personnelDetail(main, id) {
  const isNew = id === 'new';
  const p = isNew ? { employment_type: 'Freelance', project_ids: [] } : await get(`/personnel/${id}`);
  const seesPay = can('hr') || can('view_financials');
  const canEdit = editable() || can('hr');
  const f = form([
    { section: 'Contact' },
    { name: 'first_name', label: 'First name', required: true },
    { name: 'last_name', label: 'Last name' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'mobile', label: 'Mobile', type: 'tel' },
    { name: 'address', label: 'Street address' },
    { name: 'city', label: 'City' }, { name: 'state', label: 'State' }, { name: 'zip', label: 'ZIP' },
    { name: 'emergency_name', label: 'Emergency contact' }, { name: 'emergency_phone', label: 'Emergency phone', type: 'tel' },
    { section: 'Role' },
    { name: 'title', label: 'Title / role', type: 'select', category: 'title' },
    { name: 'department', label: 'Department', type: 'select', category: 'department' },
    { name: 'employment_type', label: 'Staff or freelance', type: 'select', category: 'employment_type' },
    ...(seesPay ? [
      { name: 'rate', label: 'Rate ($)', type: 'number' },
      { name: 'rate_frequency', label: 'Rate frequency', type: 'select', category: 'rate_frequency' },
    ] : []),
    { name: 'start_date', label: 'Start date', type: 'date' },
    { name: 'end_date', label: 'End date', type: 'date' },
    { section: 'Work' },
    { name: 'project_ids', label: 'Projects they will work on', type: 'multi', options: projectOptions(), numeric: true },
    { name: 'equipment_needed', label: 'Equipment / software needed', type: 'textarea', help: 'Passed to IT once HR releases the record.' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ], p);
  if (!canEdit) f.el.querySelectorAll('input, select, textarea').forEach((i) => { i.disabled = true; });

  const save = () => attempt(async () => {
    const v = f.values();
    if (isNew) {
      const r = await post('/personnel', v);
      await refreshLookup();
      toast('Saved — HR has been notified to verify');
      go(`#/personnel/${r.id}`);
    } else {
      await patch(`/personnel/${id}`, v);
      await refreshLookup();
      toast('Saved');
    }
  });

  main.append(detailHead(isNew ? 'New person' : `${p.first_name} ${p.last_name}`, '#/personnel', 'Personnel'));
  const side = isNew ? null : h('div', {},
    h('div', { class: 'card' }, h('h2', {}, 'Status'),
      h('div', { class: 'kv' },
        h('div', {}, h('b', {}, 'HR'), statusChip(p.hr_status)),
        h('div', {}, h('b', {}, 'IT setup'), statusChip(p.it_status)),
        h('div', {}, h('b', {}, 'Hours logged'), `${p.hours_logged} h`)),
      can('hr') ? h('p', {}, h('a', { href: '#/hr' }, 'Open HR board →')) : null),
    h('div', { class: 'card' }, h('h2', {}, 'Assigned equipment'),
      p.equipment.length ? h('ul', {}, p.equipment.map((e) => h('li', {}, h('a', { href: `#/equipment/${e.id}` }, `${e.item_number} · ${e.name}`)))) : h('p', { class: 'muted' }, 'None')),
    h('div', { class: 'card' }, h('h2', {}, 'Open tickets'),
      p.tickets.length ? h('ul', {}, p.tickets.map((t) => h('li', {}, h('a', { href: `#/ticket/${t.id}` }, `${t.ticket_number} ${t.title}`), ' ', statusChip(t.status)))) : h('p', { class: 'muted' }, 'None')));
  main.append(h('div', { class: isNew ? '' : 'split' },
    h('div', { class: 'card' }, f.el, canEdit ? saveBar(save, isNew ? 'Add person' : 'Save changes') : null), side));
}

// ======================= CLIENTS =======================
export async function clientList(main) {
  await listPage(main, {
    title: 'Clients', subtitle: 'Internal client directory — when tagged on work, only the client name is shown',
    newHref: '#/clients/new', newLabel: 'Add client', canCreate: editable(),
    filters: [{ type: 'search', key: 'q', placeholder: 'Search clients…' }, { key: 'sector', label: 'All sectors', options: opts('sector') }],
    load: (f) => get(`/clients${qs(f)}`),
    rowHref: (r) => `#/clients/${r.id}`,
    columns: [
      { label: 'Client', render: (r) => h('b', {}, r.name) },
      { label: 'Prefix', render: (r) => h('span', { class: 'mono' }, r.billing_prefix) },
      { label: 'Point of contact', render: (r) => [r.poc_name, r.poc_email ? h('div', { class: 'muted small' }, r.poc_email) : null] },
      { label: 'Department', key: 'department' },
      { label: 'Sector', key: 'sector' },
      { label: 'Accounting', render: (r) => [r.acct_name, r.acct_email ? h('div', { class: 'muted small' }, r.acct_email) : null] },
      { label: 'Projects', render: (r) => `${r.active_projects} active / ${r.project_count}` },
    ],
  });
}

export async function clientDetail(main, id) {
  const isNew = id === 'new';
  const c = isNew ? {} : await get(`/clients/${id}`);
  const f = form([
    { name: 'name', label: 'Client name', required: true },
    { name: 'billing_prefix', label: 'Billing prefix', required: true, help: 'Unique, e.g. NOVA. Starts every billing number for this client. Changing it affects new numbers only.' },
    { section: 'Point of contact' },
    { name: 'poc_name', label: 'Name' }, { name: 'poc_title', label: 'Title' },
    { name: 'poc_email', label: 'Email', type: 'email' }, { name: 'poc_phone', label: 'Phone', type: 'tel' },
    { name: 'department', label: 'Department', type: 'select', category: 'client_department' },
    { name: 'sector', label: 'Sector', type: 'select', category: 'sector' },
    { name: 'birthday', label: 'Birthday (optional)', type: 'date' },
    { section: 'Accounting department' },
    { name: 'acct_name', label: 'Contact' }, { name: 'acct_email', label: 'Email', type: 'email' }, { name: 'acct_phone', label: 'Phone', type: 'tel' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ], c);
  if (!editable()) f.el.querySelectorAll('input, select, textarea').forEach((i) => { i.disabled = true; });
  const save = () => attempt(async () => {
    const v = f.values();
    if (isNew) { const r = await post('/clients', v); await refreshLookup(); go(`#/clients/${r.id}`); }
    else { await patch(`/clients/${id}`, v); await refreshLookup(); toast('Saved'); }
  });
  main.append(detailHead(isNew ? 'New client' : c.name, '#/clients', 'Clients',
    isNew || !editable() ? [] : [h('a', { class: 'btn', href: `#/projects/new?client=${id}` }, '+ New project for this client')]));
  main.append(h('div', { class: 'card' }, f.el, editable() ? saveBar(save, isNew ? 'Add client' : 'Save changes') : null));
  if (isNew) return;
  main.append(h('div', { class: 'card' },
    h('h2', {}, 'Project history (cumulative)'),
    h('div', { class: 'kv', style: 'margin-bottom:12px' },
      h('div', {}, h('b', {}, 'Projects'), c.totals.projects),
      h('div', {}, h('b', {}, 'Tickets'), c.totals.tickets),
      h('div', {}, h('b', {}, 'Hours logged'), c.totals.hours),
      c.totals.budget !== undefined ? h('div', {}, h('b', {}, 'Total budget'), fmtMoney(c.totals.budget)) : null),
    table([
      { label: '#', render: (p) => h('span', { class: 'mono' }, p.project_number) },
      { label: 'Project', render: (p) => [h('b', {}, p.official_name), p.code_name ? h('div', { class: 'muted small' }, p.code_name) : null] },
      { label: 'Scope', render: (p) => JSON.parse(p.scope || '[]').join(', ') },
      { label: 'Producer', key: 'producer_name' },
      { label: 'Start', render: (p) => fmtDate(p.est_start) },
      { label: 'Delivery', render: (p) => fmtDate(p.est_delivery) },
      { label: 'Tickets', key: 'ticket_count' },
      { label: 'Time', render: (p) => fmtDuration(p.seconds) },
      { label: 'Status', render: (p) => statusChip(p.status) },
    ], c.projects, { onRow: (p) => go(`#/projects/${p.id}`), empty: 'No projects yet.' })),
  h('div', { class: 'card' }, h('h2', {}, 'Billing numbers'),
    table([{ label: 'Billing #', render: (a) => h('span', { class: 'mono' }, a.billing_code) }, { label: 'Project', key: 'official_name' },
      { label: 'Department', key: 'department' }, { label: 'Status', render: (a) => statusChip(a.status) }], c.accounts, { empty: 'None yet.' })));
}

// ======================= PROJECTS =======================
export async function projectList(main) {
  const fin = can('view_financials');
  await listPage(main, {
    title: 'Project titles', newHref: '#/projects/new', newLabel: 'New project', canCreate: editable(),
    filters: [
      { type: 'search', key: 'q', placeholder: 'Search name, code name, number…' },
      { key: 'client_id', label: 'All clients', options: clientOptions },
      { key: 'status', label: 'Any status', options: state.meta.projectStatuses },
      { key: 'scope', label: 'Any scope', options: opts('scope_of_work') },
    ],
    load: (f) => get(`/projects${qs(f)}`),
    rowHref: (r) => `#/projects/${r.id}`,
    columns: [
      { label: '#', render: (r) => h('span', { class: 'mono' }, r.project_number) },
      { label: 'Project', render: (r) => [h('b', {}, r.official_name), r.code_name ? h('div', { class: 'muted small' }, `Code: ${r.code_name}`) : null] },
      { label: 'Client', key: 'client_name' },
      { label: 'Producer', key: 'producer_name' },
      { label: 'Start', render: (r) => fmtDate(r.est_start) },
      { label: 'Lock', render: (r) => fmtDate(r.est_lock) },
      { label: 'Final delivery', render: (r) => fmtDate(r.est_delivery) },
      ...(fin ? [
        { label: 'Budget', render: (r) => fmtMoney(r.budget) },
        { label: 'Est. cost', render: (r) => fmtMoney(r.est_cost) },
        { label: 'Differential', render: (r) => (r.differential == null ? '' : h('b', { style: `color:var(--${r.differential < 0 ? 'danger' : 'ok'})` }, fmtMoney(r.differential))) },
      ] : []),
      { label: 'Scope', render: (r) => h('div', { class: 'chips' }, r.scope.map((s) => h('span', { class: 'chip' }, s))) },
      { label: 'Open tickets', key: 'open_tickets' },
      { label: 'Status', render: (r) => statusChip(r.status) },
    ],
  });
}

export async function projectDetail(main, id) {
  const isNew = id === 'new';
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const p = isNew ? { client_id: params.get('client'), scope: [] } : await get(`/projects/${id}`);
  const fin = can('view_financials');
  const diff = h('b', {}, p.differential == null ? '—' : fmtMoney(p.differential));
  const f = form([
    { name: 'official_name', label: 'Official name', required: true },
    { name: 'code_name', label: 'Code name' },
    { name: 'client_id', label: 'Client', type: 'select', options: clientOptions(), required: true, numeric: true },
    { name: 'producer_id', label: 'Assigned producer', type: 'select', options: personOptions(), numeric: true },
    { name: 'est_start', label: 'Estimated start', type: 'date' },
    { name: 'est_lock', label: 'Estimated lock', type: 'date' },
    { name: 'est_delivery', label: 'Estimated final delivery', type: 'date' },
    ...(fin ? [
      { section: 'Financials (restricted)' },
      { name: 'budget', label: 'Budget ($)', type: 'number' },
      { name: 'est_cost', label: 'Estimated cost ($)', type: 'number' },
    ] : []),
    { name: 'scope', label: 'Scope of work', type: 'multi', category: 'scope_of_work' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ], p);
  if (fin) {
    const upd = () => { const b = Number(f.inputs.budget.value), c = Number(f.inputs.est_cost.value); diff.textContent = f.inputs.budget.value && f.inputs.est_cost.value ? fmtMoney(b - c) : '—'; };
    f.inputs.budget.addEventListener('input', upd); f.inputs.est_cost.addEventListener('input', upd);
    f.inputs.est_cost.closest('.field').after(h('div', { class: 'field' }, h('label', {}, 'Differential (budget − cost)'), diff));
  }
  if (!editable()) f.el.querySelectorAll('input, select, textarea').forEach((i) => { i.disabled = true; });
  const save = () => attempt(async () => {
    const v = f.values();
    if (isNew) { const r = await post('/projects', v); await refreshLookup(); toast(`Created ${r.project_number}`); go(`#/projects/${r.id}`); }
    else { await patch(`/projects/${id}`, v); await refreshLookup(); toast('Saved'); }
  });

  const statusActions = [];
  if (!isNew && editable()) {
    const setStatus = async (status) => {
      let reason = null;
      if (['Killed', 'Cancelled'].includes(status)) {
        const input = h('textarea', { placeholder: 'Reason (required)' });
        const ok = await new Promise((resolve) => {
          const m = modal(`${status === 'Killed' ? 'Kill' : 'Cancel'} project`, h('div', {},
            h('p', {}, `This closes all billing numbers for ${p.official_name}, cancels its open tickets and stops any running clocks.`), input), [
            { label: 'Back', onClick: () => resolve(false) },
            { label: status === 'Killed' ? 'Kill project' : 'Cancel project', class: 'danger', onClick: () => { if (!input.value.trim()) { toast('Give a reason', 'error'); return false; } reason = input.value.trim(); resolve(true); } },
          ]);
          m.closed.then(() => resolve(false));
        });
        if (!ok) return;
      }
      const r = await attempt(() => post(`/projects/${id}/status`, { status, reason }));
      toast(`Project ${status.toLowerCase()}${r.cancelled_tickets ? ` — ${r.cancelled_tickets} ticket(s) cancelled` : ''}`);
      await refreshLookup();
      go(`#/projects/${id}?t=${Date.now()}`);
    };
    if (p.status === 'Active') {
      statusActions.push(h('button', { onclick: () => setStatus('On Hold') }, 'Put on hold'), h('button', { onclick: () => setStatus('Completed') }, 'Mark completed'),
        h('button', { class: 'danger', onclick: () => setStatus('Cancelled') }, 'Cancel'), h('button', { class: 'danger', onclick: () => setStatus('Killed') }, 'Kill'));
    } else {
      statusActions.push(h('button', { onclick: () => setStatus('Active') }, 'Reactivate'));
    }
  }

  main.append(detailHead(isNew ? 'New project' : p.official_name, '#/projects', 'Project titles', statusActions));
  if (!isNew) {
    main.append(h('div', { class: 'card', style: 'margin-bottom:14px' }, h('div', { class: 'kv' },
      h('div', {}, h('b', {}, 'Project #'), h('span', { class: 'mono' }, p.project_number)),
      h('div', {}, h('b', {}, 'Client'), h('a', { href: `#/clients/${p.client_id}` }, p.client_name)),
      h('div', {}, h('b', {}, 'Status'), statusChip(p.status), p.status_reason ? h('div', { class: 'muted small' }, p.status_reason) : null),
      h('div', {}, h('b', {}, 'Time logged'), `${p.hours} h`),
      h('div', {}, h('b', {}, 'Open tickets'), p.open_tickets))));
  }
  main.append(h('div', { class: 'card' }, f.el, editable() ? saveBar(save, isNew ? 'Create project' : 'Save changes') : null));
  if (isNew) return;

  main.append(h('div', { class: 'grid cols-2', style: 'margin-top:14px' },
    h('div', { class: 'card' }, h('div', { class: 'page-head' }, h('h2', {}, 'Billing numbers'),
      editable() && !['Killed', 'Cancelled'].includes(p.status) ? h('div', { class: 'actions' }, h('button', { class: 'sm', onclick: () => newAccountModal(p.id) }, '+ New billing number')) : null),
    table([
      { label: 'Billing #', render: (a) => h('span', { class: 'mono' }, a.billing_code) },
      { label: 'Department', key: 'department' }, { label: 'Lead producer', key: 'lead_producer_name' }, { label: 'Status', render: (a) => statusChip(a.status) },
    ], p.accounts, { empty: 'No billing numbers yet.' })),
    h('div', { class: 'card' }, h('h2', {}, 'Team'),
      p.personnel.length ? h('div', { class: 'chips' }, p.personnel.map((x) => h('a', { class: 'chip blue', href: `#/personnel/${x.id}` }, x.name))) : h('p', { class: 'muted' }, 'Nobody linked yet — add projects on personnel records.'),
      h('h3', {}, 'Physical media'),
      p.media.length ? h('ul', {}, p.media.map((m) => h('li', {}, h('a', { href: `#/media/${m.id}` }, `${m.item_number} · ${m.name}`)))) : h('p', { class: 'muted' }, 'None'))));
  main.append(h('div', { class: 'card' }, h('div', { class: 'page-head' }, h('h2', {}, 'Tickets'),
    h('div', { class: 'actions' }, ['ae', 'editorial'].map((b) => h('a', { class: 'btn sm', href: `#/request/${b}?project=${p.id}` }, `+ ${b === 'ae' ? 'AE ticket' : 'Editor request'}`)))),
  table([
    { label: '#', render: (t) => h('span', { class: 'mono' }, t.ticket_number) }, { label: 'Title', key: 'title' },
    { label: 'Board', render: (t) => state.meta.boards[t.board].label }, { label: 'Assignee', key: 'assignee_name' },
    { label: 'Time', render: (t) => fmtDuration(t.seconds) }, { label: 'Status', render: (t) => statusChip(t.status) },
  ], p.tickets, { onRow: (t) => go(`#/ticket/${t.id}`), empty: 'No tickets yet.' })));
}

export function newAccountModal(projectId, onDone) {
  const f = form([
    { name: 'project_id', label: 'Project', type: 'select', options: projectOptions(), required: true, numeric: true,
      onChange: (v, inputs) => { const pr = state.lookup.projects.find((x) => x.id === Number(v)); if (pr?.producer_id && !inputs.lead_producer_id.value) inputs.lead_producer_id.value = pr.producer_id; } },
    { name: 'department', label: 'Department', type: 'select', required: true,
      options: (state.meta.options.department || []).map((d) => ({ value: d.value, label: `${d.value} (${d.code || 'no code'})` })) },
    { name: 'lead_producer_id', label: 'Lead producer', type: 'select', options: personOptions(), numeric: true },
    { name: 'description', label: 'Description', full: true },
  ], { project_id: projectId, lead_producer_id: state.lookup.projects.find((x) => x.id === Number(projectId))?.producer_id });
  modal('New billing number', h('div', {}, h('p', { class: 'muted small' }, 'Format: CLIENT PREFIX – DEPARTMENT CODE – sequence. Generated automatically.'), f.el), [
    { label: 'Cancel' },
    { label: 'Generate', class: 'primary', onClick: () => attempt(async () => {
      const a = await post('/accounts', f.values());
      await refreshLookup();
      toast(`Billing number ${a.billing_code} created`);
      if (onDone) onDone(a); else go(`${location.hash.split('?')[0]}?t=${Date.now()}`);
    }) },
  ]);
}

// ======================= ACCOUNTS =======================
export async function accountList(main) {
  await listPage(main, {
    title: 'Accounts', subtitle: 'Clients and projects combined, with billing numbers', canCreate: false,
    extraActions: editable() ? [h('button', { class: 'primary', onclick: () => newAccountModal(null) }, '+ New billing number')] : [],
    filters: [
      { type: 'search', key: 'q', placeholder: 'Billing #, project, client…' },
      { key: 'client_id', label: 'All clients', options: clientOptions },
      { key: 'project_id', label: 'All projects', options: () => projectOptions(false) },
      { key: 'department', label: 'All departments', options: opts('department') },
      { key: 'lead_producer_id', label: 'Any lead producer', options: () => personOptions() },
      { key: 'status', label: 'Any status', options: ['Open', 'Closed', 'Killed'] },
    ],
    load: (f) => get(`/accounts${qs(f)}`),
    columns: [
      { label: 'Billing #', render: (a) => h('b', { class: 'mono' }, a.billing_code) },
      { label: 'Project', render: (a) => [h('a', { href: `#/projects/${a.project_id}`, onclick: (e) => e.stopPropagation() }, a.official_name), a.code_name ? h('div', { class: 'muted small' }, a.code_name) : null] },
      { label: 'Project #', render: (a) => h('span', { class: 'mono' }, a.project_number) },
      { label: 'Client', key: 'client_name' },
      { label: 'Department', key: 'department' },
      { label: 'Lead producer', key: 'lead_producer_name' },
      { label: 'Tickets', key: 'ticket_count' },
      { label: 'Time', render: (a) => fmtDuration(a.seconds) },
      { label: 'Status', render: (a) => statusChip(a.status) },
      ...(editable() ? [{ label: '', render: (a) => h('button', { class: 'sm', onclick: () => editAccount(a) }, 'Edit') }] : []),
    ],
  });
}

function editAccount(a) {
  const f = form([
    { name: 'lead_producer_id', label: 'Lead producer', type: 'select', options: personOptions(), numeric: true },
    { name: 'status', label: 'Status', type: 'select', options: ['Open', 'Closed', 'Killed'], required: true },
    { name: 'description', label: 'Description', full: true },
  ], a);
  modal(`Billing number ${a.billing_code}`, f.el, [
    { label: 'Cancel' },
    { label: 'Save', class: 'primary', onClick: () => attempt(async () => { await patch(`/accounts/${a.id}`, f.values()); await refreshLookup(); go(`#/accounts?t=${Date.now()}`); }, 'Saved') },
  ]);
}

// ======================= MEDIA =======================
export async function mediaList(main) {
  await listPage(main, {
    title: 'Physical media', newHref: '#/media/new', newLabel: 'Add media', canCreate: editable(),
    extraActions: [h('a', { class: 'btn', href: '#/scan' }, '📷 Scan')],
    filters: [
      { type: 'search', key: 'q', placeholder: 'Item #, name, project…' },
      { key: 'project_id', label: 'All projects', options: () => projectOptions(false) },
      { key: 'media_type', label: 'All types', options: opts('media_type') },
    ],
    load: (f) => get(`/media${qs(f)}`),
    rowHref: (r) => `#/media/${r.id}`,
    columns: [
      { label: 'Item #', render: (r) => h('b', { class: 'mono' }, r.item_number) },
      { label: 'Name', key: 'name' }, { label: 'Type', key: 'media_type' },
      { label: 'Project', key: 'project_name' }, { label: 'Location', key: 'location' }, { label: 'Tickets', key: 'ticket_numbers' },
    ],
  });
}

export async function mediaDetail(main, id) {
  const isNew = id === 'new';
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const m = isNew ? { item_number: params.get('code') || '', ticket_ids: [] } : await get(`/media/${id}`);
  const openTickets = await get('/tickets?open=1');
  const ticketChoices = [...openTickets, ...(m.tickets || []).filter((t) => !openTickets.some((o) => o.id === t.id))]
    .map((t) => ({ value: t.id, label: `${t.ticket_number} ${t.title}` }));
  const f = form([
    { name: 'item_number', label: 'Item number / barcode', type: 'barcode' },
    { name: 'name', label: 'Name', required: true },
    { name: 'media_type', label: 'Type of media', type: 'select', category: 'media_type' },
    { name: 'project_id', label: 'Project it belongs to', type: 'select', options: projectOptions(false), numeric: true },
    { name: 'location', label: 'Shelf / location' },
    { name: 'ticket_ids', label: 'Tickets associated', type: 'multi', options: ticketChoices, numeric: true },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ], m);
  if (!editable()) f.el.querySelectorAll('input, select, textarea, button').forEach((i) => { i.disabled = true; });
  const save = () => attempt(async () => {
    const v = f.values();
    if (isNew) { const r = await post('/media', v); await refreshLookup(); toast('Saved'); go(`#/media/${r.id}`); }
    else { await patch(`/media/${id}`, v); await refreshLookup(); toast('Saved'); }
  });
  main.append(detailHead(isNew ? 'New physical media' : `${m.item_number} · ${m.name}`, '#/media', 'Physical media'),
    h('div', { class: 'card' }, f.el, editable() ? saveBar(save, isNew ? 'Add media' : 'Save changes') : null));
}

// ======================= EQUIPMENT =======================
export async function equipmentList(main) {
  await listPage(main, {
    title: 'Equipment', newHref: '#/equipment/new', newLabel: 'Add equipment', canCreate: editable() || can('it'),
    extraActions: [h('a', { class: 'btn', href: '#/scan' }, '📷 Scan')],
    filters: [
      { type: 'search', key: 'q', placeholder: 'Item #, name, model…' },
      { key: 'equipment_type', label: 'All types', options: opts('equipment_type') },
      { key: 'assigned_to', label: 'Anyone', options: () => personOptions() },
    ],
    load: (f) => get(`/equipment${qs(f)}`),
    rowHref: (r) => `#/equipment/${r.id}`,
    columns: [
      { label: 'Item #', render: (r) => h('b', { class: 'mono' }, r.item_number) },
      { label: 'Name', key: 'name' }, { label: 'Type', key: 'equipment_type' }, { label: 'Model', key: 'model' },
      { label: 'Year', key: 'year' }, { label: 'Model #', key: 'model_number' }, { label: 'Assigned to', key: 'assigned_name' },
    ],
  });
}

export async function equipmentDetail(main, id) {
  const isNew = id === 'new';
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const e = isNew ? { item_number: params.get('code') || '' } : await get(`/equipment/${id}`);
  const canEdit = editable() || can('it');
  const f = form([
    { name: 'item_number', label: 'Item number / barcode', type: 'barcode' },
    { name: 'name', label: 'Name', required: true },
    { name: 'equipment_type', label: 'Type of equipment', type: 'select', category: 'equipment_type' },
    { name: 'model', label: 'Model' },
    { name: 'year', label: 'Year', type: 'number' },
    { name: 'model_number', label: 'Model number' },
    { name: 'serial_number', label: 'Serial number' },
    { name: 'assigned_to', label: 'Assigned to', type: 'select', options: personOptions(), numeric: true },
    { name: 'specs', label: 'Specs', type: 'textarea' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ], e);
  if (!canEdit) f.el.querySelectorAll('input, select, textarea, button').forEach((i) => { i.disabled = true; });
  const save = () => attempt(async () => {
    const v = f.values();
    if (isNew) { const r = await post('/equipment', v); await refreshLookup(); toast('Saved'); go(`#/equipment/${r.id}`); }
    else { await patch(`/equipment/${id}`, v); await refreshLookup(); toast('Saved'); }
  });
  main.append(detailHead(isNew ? 'New equipment' : `${e.item_number} · ${e.name}`, '#/equipment', 'Equipment'),
    h('div', { class: 'card' }, f.el, canEdit ? saveBar(save, isNew ? 'Add equipment' : 'Save changes') : null));
}

