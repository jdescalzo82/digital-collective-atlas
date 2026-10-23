// Ticketing: the request switchboard, boards, the ticket page (wall, message board,
// time log), the manager's assignment queue and the editor schedule.
import { state, get, post, patch, del, can, opts } from '../api.js';
import {
  h, clear, form, table, filterBar, statusChip, attempt, modal, toast, confirmBox, tagPicker,
  fmtDate, fmtDateTime, fmtDuration, fmtClock, fmtMoney, toLocalInput, qs,
  personOptions, projectOptions, accountOptions, clientOptions,
} from '../ui.js';
import { onLeave } from '../app.js';

const go = (hash) => { location.hash = hash; };
const BOARD = () => state.meta.boards;
const CLOSED = ['Completed', 'Cancelled', 'Archived'];
const addDays = (d, n) => { if (!d) return null; const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const hashParams = () => new URLSearchParams(location.hash.split('?')[1] || '');

// Live clocks: any element with data-since (ISO) and data-base (seconds) ticks every second.
function startClocks() {
  const id = setInterval(() => {
    document.querySelectorAll('[data-since]').forEach((el) => {
      const sec = Number(el.dataset.base || 0) + (Date.now() - new Date(el.dataset.since).getTime()) / 1000;
      el.textContent = el.dataset.format === 'short' ? fmtDuration(sec) : fmtClock(sec);
    });
  }, 1000);
  onLeave(() => clearInterval(id));
}

// ======================= REQUEST SWITCHBOARD =======================
export async function requestForm(main, type) {
  const cfg = BOARD()[type];
  const params = hashParams();
  if (type === 'finishing') return finishingRequestForm(main);

  let projectId = params.get('project') ? Number(params.get('project')) : null;
  let allAccounts = false;
  const wall = h('div', { class: 'card wall' });
  const accountSel = h('select', {});
  const mediaBox = h('div', { class: 'checks' });
  const tags = tagPicker();

  const project = () => state.lookup.projects.find((p) => p.id === projectId);
  const fillAccounts = () => {
    const list = accountOptions(allAccounts ? null : projectId);
    const current = accountSel.value;
    clear(accountSel).append(h('option', { value: '' }, list.length ? '— Select billing number —' : (projectId ? 'No open billing numbers — create one' : 'Pick a project first')),
      ...list.map((o) => h('option', { value: o.value }, o.label)));
    if (list.some((o) => String(o.value) === current)) accountSel.value = current;
    else if (list.length === 1) accountSel.value = list[0].value;
    else {
      // Prefer the department that matches this board.
      const dept = type === 'editorial' ? 'Editorial' : 'Assistant Editorial';
      const match = state.lookup.accounts.find((a) => a.project_id === projectId && a.status === 'Open' && a.department === dept);
      if (match) accountSel.value = match.id;
    }
  };
  const fillProject = async () => {
    fillAccounts();
    clear(mediaBox);
    clear(wall);
    const p = project();
    if (!p) { wall.append(h('p', { class: 'muted' }, 'Select a project and its details carry over here.')); return; }
    const full = await get(`/projects/${p.id}`);
    wall.append(h('h2', {}, full.official_name, full.code_name ? h('span', { class: 'muted' }, ` · ${full.code_name}`) : null),
      h('div', { class: 'kv' },
        h('div', {}, h('b', {}, 'Client'), full.client_name), h('div', {}, h('b', {}, 'Producer'), full.producer_name || '—'),
        h('div', {}, h('b', {}, 'Project #'), full.project_number), h('div', {}, h('b', {}, 'Est. start'), fmtDate(full.est_start) || '—'),
        h('div', {}, h('b', {}, 'Est. lock'), fmtDate(full.est_lock) || '—'), h('div', {}, h('b', {}, 'Final delivery'), fmtDate(full.est_delivery) || '—'),
        h('div', {}, h('b', {}, 'Scope'), full.scope.join(', ') || '—')));
    const media = state.lookup.media.filter((m) => m.project_id === p.id);
    mediaBox.append(...(media.length ? media.map((m) => h('label', {}, h('input', { type: 'checkbox', value: m.id }), `${m.item_number} · ${m.name}`))
      : [h('span', { class: 'muted small' }, 'No media logged for this project.')]));
    if (type === 'editorial') {
      if (!f.inputs.start_date.value && full.est_start) f.inputs.start_date.value = full.est_start;
      if (!f.inputs.final_lock_date.value && full.est_lock) f.inputs.final_lock_date.value = full.est_lock;
      updateBooking();
    }
  };

  const projectSel = h('select', { onchange: (e) => { projectId = Number(e.target.value) || null; fillProject(); } },
    h('option', { value: '' }, '— Select project —'), projectOptions().map((o) => h('option', { value: o.value, selected: o.value === projectId }, o.label)));
  const booking = h('div', { class: 'help' });
  const updateBooking = () => {
    if (type !== 'editorial') return;
    const s = f.inputs.start_date.value, l = f.inputs.final_lock_date.value;
    booking.textContent = s && l ? `Editor will be booked ${fmtDate(s)} → ${fmtDate(addDays(l, state.meta.boards.editorial.bookingCushionDays))} (final lock + ${state.meta.boards.editorial.bookingCushionDays}-day cushion)` : '';
  };

  const fields = type === 'ae' ? [
    { name: 'title', label: 'Ticket title', required: true, full: true },
    { name: 'category', label: 'Category', type: 'select', category: 'ae_category', required: true },
    { name: 'due_date', label: 'Needed by', type: 'date' },
    { name: 'brief', label: 'Instructions', type: 'textarea', rows: 5 },
  ] : [
    { name: 'title', label: 'Request title', required: true, full: true },
    { name: 'creative_name', label: 'Creative name', placeholder: 'e.g. Trailer 1 "Tide"' },
    { name: 'duration', label: 'Duration', type: 'select', category: 'duration' },
    { name: 'desired_editor_id', label: 'Desired editor', type: 'select', numeric: true,
      options: [...personOptions((p) => p.department === 'Editorial'), ...personOptions((p) => p.department !== 'Editorial')] },
    { name: 'start_date', label: 'Start date', type: 'date', required: true, onChange: () => updateBooking() },
    { name: 'first_cut_date', label: 'First cut to client', type: 'date' },
    { name: 'final_lock_date', label: 'Final lock', type: 'date', required: true, onChange: () => updateBooking() },
    { name: 'brief', label: 'Creative briefing', type: 'textarea', rows: 6 },
  ];
  const f = form(fields, {});
  if (type === 'editorial') f.inputs.final_lock_date.parentElement.append(booking);

  const submit = () => attempt(async () => {
    const v = f.values();
    if (!accountSel.value) throw new Error('Pick a billing number');
    const t = await post('/tickets', {
      board: type, ...v, project_id: projectId, account_id: Number(accountSel.value),
      media_ids: [...mediaBox.querySelectorAll('input:checked')].map((c) => Number(c.value)), tags: tags.value(),
    });
    toast(`${t.ticket_number} submitted as Draft — the board manager has been notified`);
    go(`#/ticket/${t.id}`);
  });

  main.append(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, `New ${cfg.label.toLowerCase()} ${type === 'ae' ? 'ticket' : 'request'}`),
      h('div', { class: 'muted' }, 'Pick from the databases — details carry over and you can mix and match.'))),
    h('div', { class: 'split' },
      h('div', {},
        h('div', { class: 'card' }, h('div', { class: 'form' },
          h('div', { class: 'field' }, h('label', {}, 'Project ', h('span', { class: 'req' }, '*')), projectSel),
          h('div', { class: 'field' }, h('label', {}, 'Billing number ', h('span', { class: 'req' }, '*')), h('div', { class: 'inline' }, accountSel,
            can('onboarding') ? h('button', { type: 'button', title: 'New billing number', onclick: async () => {
              const { newAccountModal } = await import('./onboarding.js');
              newAccountModal(projectId, (a) => { fillAccounts(); accountSel.value = a.id; });
            } }, '+') : null),
          h('label', { class: 'small muted', style: 'display:flex;gap:6px;align-items:center;margin-top:4px' },
            h('input', { type: 'checkbox', onchange: (e) => { allAccounts = e.target.checked; fillAccounts(); } }), 'Show billing numbers from all projects'))),
        h('div', { style: 'margin-top:14px' }, f.el)),
        h('div', { class: 'card' }, h('h2', {}, 'Physical media'), mediaBox, h('h3', {}, 'Tags'), tags.el),
        h('div', { style: 'margin-top:14px' }, h('button', { class: 'primary', onclick: submit }, 'Submit request'))),
      wall));
  await fillProject();
}

async function finishingRequestForm(main) {
  const eds = (await get('/tickets?board=editorial&open=1'));
  const pre = Number(hashParams().get('editorial')) || null;
  const f = form([
    { name: 'editorial_id', label: 'Editorial ticket', type: 'select', required: true, numeric: true,
      options: eds.map((t) => ({ value: t.id, label: `${t.ticket_number} ${t.title} · ${t.billing_code}` })) },
    { name: 'tracks', label: 'What needs finishing', type: 'multi', options: ['Picture', 'Sound'], required: true },
    { name: 'notes', label: 'Finishing notes', type: 'textarea' },
  ], { editorial_id: pre, tracks: ['Picture', 'Sound'] });
  main.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'New finishing request'),
    h('div', { class: 'muted' }, 'Finishing requests are compiled from an editorial ticket — all its details, media and tags carry over and stay linked.'))),
  h('div', { class: 'card' }, f.el, h('div', { style: 'margin-top:14px' }, h('button', { class: 'primary', onclick: () => attempt(async () => {
    const v = f.values();
    const t = await post(`/tickets/${v.editorial_id}/finishing`, { picture: v.tracks.includes('Picture'), sound: v.tracks.includes('Sound'), notes: v.notes });
    toast(`${t.ticket_number} created`);
    go(`#/ticket/${t.id}`);
  }) }, 'Create finishing request'))));
}

// ======================= BOARDS =======================
function ticketCard(t) {
  const running = t.running > 0;
  return h('div', { class: 'tcard', onclick: () => go(`#/ticket/${t.id}`) },
    h('div', { class: 'num' }, h('span', { class: 'mono' }, t.ticket_number), h('span', { class: 'mono' }, t.billing_code || '')),
    h('div', { class: 'title' }, t.title),
    h('div', { class: 'meta' },
      h('span', {}, t.code_name || t.project_name || ''), t.client_name ? h('span', {}, `· ${t.client_name}`) : null),
    h('div', { class: 'meta', style: 'margin-top:6px' },
      t.category ? h('span', { class: 'chip' }, t.category) : null,
      t.duration ? h('span', { class: 'chip' }, t.duration) : null,
      t.derivative_type ? h('span', { class: 'chip purple' }, t.derivative_type === 'cutdown' ? 'Cut-Down' : 'Unarchive') : null,
      h('span', {}, t.assignee_name ? `👤 ${t.assignee_name}` : (t.desired_editor_name ? `wants ${t.desired_editor_name}` : 'Unassigned')),
      running ? h('span', {}, h('span', { class: 'dot' }), ' ', h('span', { 'data-since': new Date().toISOString(), 'data-base': t.seconds, 'data-format': 'short' }, fmtDuration(t.seconds)))
        : (t.seconds ? h('span', {}, `⏱ ${fmtDuration(t.seconds)}`) : null),
      t.due_date ? h('span', {}, `due ${fmtDate(t.due_date)}`) : null,
      t.booking_start ? h('span', {}, `${fmtDate(t.booking_start)} → ${fmtDate(t.booking_end)}`) : null),
    t.board === 'editorial' && t.fin_id ? h('div', { class: 'meta', style: 'margin-top:6px' }, 'Pic ', statusChip(t.fin_picture), ' Snd ', statusChip(t.fin_sound)) : null,
    t.board === 'finishing' ? h('div', { class: 'meta', style: 'margin-top:6px' }, 'Pic ', statusChip(t.picture_status), ' Snd ', statusChip(t.sound_status)) : null);
}

export async function board(main, boardKey) {
  const cfg = BOARD()[boardKey];
  let groupBy = boardKey === 'ae' ? 'assignee' : 'status';
  let showClosed = false;
  const body = h('div');
  const fb = filterBar([
    { type: 'search', key: 'q', placeholder: 'Search tickets…' },
    { key: 'project_id', label: 'All projects', options: () => projectOptions(false) },
    { key: 'client_id', label: 'All clients', options: clientOptions },
    { key: 'assignee_id', label: 'Anyone', options: () => personOptions() },
    ...(boardKey === 'ae' ? [{ key: 'category', label: 'All categories', options: opts('ae_category') }] : []),
  ], () => render());
  const groupSel = h('select', { style: 'width:auto', onchange: (e) => { groupBy = e.target.value; render(); } },
    h('option', { value: 'status', selected: groupBy === 'status' }, 'Columns by status'),
    h('option', { value: 'assignee', selected: groupBy === 'assignee' }, 'Sections by assignee'));
  const closedToggle = h('label', { class: 'small', style: 'display:flex;gap:6px;align-items:center' },
    h('input', { type: 'checkbox', onchange: (e) => { showClosed = e.target.checked; render(); } }), 'Show closed');

  const render = async () => {
    const rows = await get(`/tickets${qs({ board: boardKey, ...fb.read() })}`);
    const visible = rows.filter((t) => showClosed || !CLOSED.includes(t.status));
    clear(body);
    if (groupBy === 'status') {
      const statuses = cfg.statuses.filter((s) => showClosed || !CLOSED.includes(s));
      body.append(h('div', { class: 'board' }, statuses.map((s) => {
        const list = visible.filter((t) => t.status === s);
        return h('div', { class: 'column' }, h('h4', {}, h('span', {}, s), h('span', {}, list.length)), list.map(ticketCard));
      })));
    } else {
      const lanes = new Map();
      for (const t of visible) {
        const k = t.assignee_name || '';
        if (!lanes.has(k)) lanes.set(k, []);
        lanes.get(k).push(t);
      }
      const keys = [...lanes.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
      if (!keys.length) body.append(h('div', { class: 'card empty' }, 'No tickets.'));
      for (const k of keys) {
        const list = lanes.get(k);
        const statuses = cfg.statuses.filter((s) => list.some((t) => t.status === s));
        body.append(h('div', { class: 'lane-head' }, k || 'Unassigned — waiting for the lead', h('span', { class: 'chip' }, list.length)),
          h('div', { class: 'board' }, statuses.map((s) => h('div', { class: 'column' },
            h('h4', {}, h('span', {}, s), h('span', {}, list.filter((t) => t.status === s).length)), list.filter((t) => t.status === s).map(ticketCard)))));
      }
    }
  };
  main.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, `${cfg.label} board`)),
    h('div', { class: 'actions' }, groupSel, closedToggle,
      boardKey === 'editorial' ? h('a', { class: 'btn', href: '#/schedule' }, '📅 Schedule') : null,
      h('a', { class: 'btn primary', href: `#/request/${boardKey}` }, '+ New'))),
  fb.el, body);
  startClocks();
  await render();
}

// Managers: everything sitting in Draft on the boards they run.
export async function manageBoard(main) {
  const boards = Object.keys(BOARD()).filter((b) => can(BOARD()[b].manageCategory));
  main.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Needs assignment'),
    h('div', { class: 'muted' }, 'New requests land here as Draft. Assigning moves them into the assignee\'s queue.'))));
  for (const b of boards) {
    const rows = await get(`/tickets?board=${b}&status=Draft`);
    const card = h('div', { class: 'card' }, h('h2', {}, `${BOARD()[b].label} (${rows.length})`));
    card.append(table([
      { label: '#', render: (t) => h('a', { class: 'mono', href: `#/ticket/${t.id}` }, t.ticket_number) },
      { label: 'Title', render: (t) => [h('b', {}, t.title), t.derivative_type ? h('span', { class: 'chip purple', style: 'margin-left:6px' }, t.derivative_type) : null] },
      { label: 'Billing #', render: (t) => h('span', { class: 'mono' }, t.billing_code) },
      { label: 'Project / client', render: (t) => `${t.project_name || ''} · ${t.client_name || ''}` },
      { label: 'Details', render: (t) => (b === 'ae' ? [t.category, t.due_date ? ` · due ${fmtDate(t.due_date)}` : ''] : b === 'editorial'
        ? [t.desired_editor_name ? `Wants ${t.desired_editor_name}` : 'No editor preference', t.booking_start ? h('div', { class: 'muted small' }, `${fmtDate(t.booking_start)} → ${fmtDate(t.booking_end)}`) : null]
        : ['Pic ', statusChip(t.picture_status), ' Snd ', statusChip(t.sound_status)]) },
      { label: 'Requested by', render: (t) => [t.requested_by_name, h('div', { class: 'muted small' }, fmtDateTime(t.created_at))] },
      { label: 'Assign to', render: (t) => {
        const sel = h('select', { style: 'min-width:170px' }, h('option', { value: '' }, '— Pick —'),
          personOptions().map((o) => h('option', { value: o.value, selected: o.value === t.desired_editor_id }, o.label)));
        return h('div', { class: 'inline' }, sel, h('button', { class: 'primary sm', onclick: () => attempt(async () => {
          if (!sel.value) throw new Error('Pick someone');
          await post(`/tickets/${t.id}/assign`, { personnel_id: Number(sel.value) });
          go(`#/manage?t=${Date.now()}`);
        }, 'Assigned') }, 'Assign'));
      } },
    ], rows, { empty: 'Nothing waiting. 🎉' }));
    main.append(card);
  }
  if (!boards.length) main.append(h('div', { class: 'card empty' }, 'You don\'t manage any boards.'));
}

export async function myTickets(main) {
  const q = hashParams().get('q');
  const rows = await get(`/tickets${qs(q ? { q } : { mine: 1 })}`);
  const active = rows.filter((t) => !CLOSED.includes(t.status));
  main.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, q ? `Search: “${q}”` : 'My tickets'),
    h('div', { class: 'muted' }, q ? `${rows.length} result(s)` : 'Assigned to you or requested by you'))));
  const cols = [
    { label: '#', render: (t) => h('span', { class: 'mono' }, t.ticket_number) },
    { label: 'Title', render: (t) => h('b', {}, t.title) },
    { label: 'Board', render: (t) => BOARD()[t.board].label },
    { label: 'Billing #', render: (t) => h('span', { class: 'mono' }, t.billing_code) },
    { label: 'Project', render: (t) => t.code_name || t.project_name },
    { label: 'Assignee', key: 'assignee_name' },
    { label: 'Time', render: (t) => (t.running ? [h('span', { class: 'dot' }), ' ', h('span', { 'data-since': new Date().toISOString(), 'data-base': t.seconds, 'data-format': 'short' }, fmtDuration(t.seconds))] : fmtDuration(t.seconds)) },
    { label: 'Status', render: (t) => statusChip(t.status) },
  ];
  main.append(h('div', { class: 'card' }, h('h2', {}, 'Open'), table(cols, q ? rows : active, { onRow: (t) => go(`#/ticket/${t.id}`), empty: 'No open tickets.' })));
  if (!q) main.append(h('div', { class: 'card' }, h('h2', {}, 'Closed'), table(cols, rows.filter((t) => CLOSED.includes(t.status)), { onRow: (t) => go(`#/ticket/${t.id}`), empty: 'None.' })));
  startClocks();
}

// ======================= TICKET PAGE =======================
export async function ticketPage(main, id) {
  const t = await get(`/tickets/${id}`);
  const cfg = BOARD()[t.board];
  const reload = () => go(`#/ticket/${t.id}?t=${Date.now()}`);
  startClocks();

  // ---- header & status ----
  const statusCtl = h('div', { class: 'statusbar' });
  if (t.can.status) {
    const sel = h('select', {}, cfg.statuses.map((s) => h('option', { value: s, selected: s === t.status }, s)),
      cfg.actions ? h('optgroup', { label: 'Create from this ticket' }, cfg.actions.map((a) => h('option', { value: a }, a === 'Unarchive' ? 'Unarchive (new draft)' : 'Cut-Down (new draft)'))) : null);
    sel.addEventListener('change', async () => {
      const status = sel.value;
      sel.value = t.status; // actions never change this ticket's status
      try {
        if (status === 'Cut-Down') return cutDownModal(t);
        if (status === 'Unarchive') {
          if (!await confirmBox('Unarchive', `Create a new Draft “Unarchive - ${t.title}” linked to this ticket? This ticket stays ${t.status}.`, 'Create')) return;
          const r = await attempt(() => post(`/tickets/${t.id}/status`, { status }));
          toast(`${r.created.ticket_number} created`); return go(`#/ticket/${r.created.id}`);
        }
        await attempt(() => post(`/tickets/${t.id}/status`, { status }));
        reload();
      } catch { /* toast shown */ }
    });
    statusCtl.append(h('label', { class: 'small muted' }, 'Status'), sel);
  } else statusCtl.append(statusChip(t.status));

  if (t.can.manage) {
    const asg = h('select', { style: 'width:auto;min-width:200px' }, h('option', { value: '' }, '— Unassigned —'),
      personOptions().map((o) => h('option', { value: o.value, selected: o.value === t.assignee_id }, o.label)));
    asg.addEventListener('change', () => attempt(async () => { await post(`/tickets/${t.id}/assign`, { personnel_id: Number(asg.value) || null }); reload(); }, 'Assignment updated'));
    statusCtl.append(h('label', { class: 'small muted' }, 'Assignee'), asg);
  } else statusCtl.append(h('span', { class: 'muted' }, 'Assignee: '), h('b', {}, t.assignee_name || 'Unassigned'));

  main.append(h('div', { class: 'page-head' },
    h('div', {}, h('a', { href: `#/board/${t.board}`, class: 'small' }, `← ${cfg.label} board`),
      h('h1', {}, h('span', { class: 'muted mono' }, `${t.ticket_number} `), t.title),
      h('div', { class: 'chips' }, h('span', { class: 'chip blue mono' }, `Billing # ${t.billing_code}`), statusChip(t.status),
        t.project_status && t.project_status !== 'Active' ? h('span', { class: 'chip red' }, `Project ${t.project_status}`) : null,
        t.derivative_type ? h('span', { class: 'chip purple' }, t.derivative_type === 'cutdown' ? 'Cut-Down' : 'Unarchive') : null)),
    h('div', { class: 'actions' },
      t.can.edit ? h('button', { onclick: () => editTicketModal(t, reload) }, '✎ Edit details') : null,
      t.board === 'editorial' && t.can.edit ? h('button', { class: 'primary', onclick: () => finishingModal(t) }, '➜ Request finishing') : null)),
  h('div', { class: 'card', style: 'margin-bottom:14px' }, statusCtl));

  // ---- the wall ----
  const p = t.project;
  const wall = h('div', { class: 'card wall' }, h('h2', {}, 'Project wall'),
    p ? h('div', { class: 'kv' },
      h('div', {}, h('b', {}, 'Project'), h('a', { href: `#/projects/${p.id}` }, p.official_name)),
      h('div', {}, h('b', {}, 'Code name'), p.code_name || '—'),
      h('div', {}, h('b', {}, 'Client'), p.client_name),
      h('div', {}, h('b', {}, 'Producer'), p.producer_name || '—'),
      h('div', {}, h('b', {}, 'Project #'), p.project_number),
      h('div', {}, h('b', {}, 'Est. lock / delivery'), `${fmtDate(p.est_lock) || '—'} / ${fmtDate(p.est_delivery) || '—'}`),
      h('div', {}, h('b', {}, 'Scope'), p.scope.join(', ') || '—'),
      p.budget !== undefined ? h('div', {}, h('b', {}, 'Budget / differential'), `${fmtMoney(p.budget) || '—'} / ${p.differential == null ? '—' : fmtMoney(p.differential)}`) : null) : null,
    h('h3', {}, 'This request'),
    h('div', { class: 'kv' },
      t.category ? h('div', {}, h('b', {}, 'Category'), t.category) : null,
      t.due_date ? h('div', {}, h('b', {}, 'Needed by'), fmtDate(t.due_date)) : null,
      t.creative_name ? h('div', {}, h('b', {}, 'Creative'), t.creative_name) : null,
      t.duration ? h('div', {}, h('b', {}, 'Duration'), t.duration) : null,
      t.desired_editor_name ? h('div', {}, h('b', {}, 'Desired editor'), t.desired_editor_name) : null,
      t.start_date ? h('div', {}, h('b', {}, 'Start'), fmtDate(t.start_date)) : null,
      t.first_cut_date ? h('div', {}, h('b', {}, 'First cut to client'), fmtDate(t.first_cut_date)) : null,
      t.final_lock_date ? h('div', {}, h('b', {}, 'Final lock'), fmtDate(t.final_lock_date)) : null,
      t.booking_start ? h('div', {}, h('b', {}, 'Editor booked'), `${fmtDate(t.booking_start)} → ${fmtDate(t.booking_end)}`) : null,
      h('div', {}, h('b', {}, 'Requested by'), `${t.requested_by_name || '—'} · ${fmtDateTime(t.created_at)}`)),
    t.conflicts?.length ? h('p', { class: 'chip amber', style: 'margin-top:10px;white-space:normal' },
      `⚠ Editor double-booked with ${t.conflicts.map((c) => `${c.ticket_number} (${fmtDate(c.booking_start)}–${fmtDate(c.booking_end)})`).join(', ')}`) : null,
    t.brief ? h('div', { class: 'brief' }, t.brief) : null,
    h('h3', {}, 'Physical media'),
    t.media.length ? h('div', { class: 'chips' }, t.media.map((m) => h('a', { class: 'chip teal', href: `#/media/${m.id}` }, `${m.item_number} · ${m.name}`))) : h('span', { class: 'muted' }, 'None'),
    h('h3', {}, 'Tags'),
    t.tags.length ? h('div', { class: 'chips' }, t.tags.map((g) => h('span', { class: `chip ${g.entity_type === 'client' ? 'purple' : 'blue'}` }, g.name))) : h('span', { class: 'muted' }, 'None'));

  // ---- time ----
  const runningMain = t.time.find((e) => !e.ended_at && e.track === 'main');
  const timeCard = h('div', { class: 'card' }, h('h2', {}, 'Time on this ticket'),
    h('div', { class: 'timer' }, t.running ? h('span', { 'data-since': new Date().toISOString(), 'data-base': t.seconds }, fmtClock(t.seconds)) : fmtClock(t.seconds)),
    h('p', { class: 'small muted' }, t.board === 'finishing'
      ? 'Picture and sound clocks run while their track is “Prep In Progress”.'
      : runningMain ? [h('span', { class: 'dot' }), ` Clock running for ${runningMain.person_name || 'assignee'} — stops automatically on hold, out for review or completed.`]
        : `Clock starts automatically when the status is ${cfg.timed.join(' / ')}.`));

  // ---- finishing tracks ----
  let finishingCard = null;
  if (t.board === 'finishing') {
    const track = (key, label) => {
      const statusSel = h('select', { disabled: !t.can.status }, h('option', { value: '' }, '— Not requested —'),
        state.meta.finishingTrackStatuses.map((s) => h('option', { value: s, selected: s === t[`${key}_status`] }, s)));
      statusSel.addEventListener('change', () => attempt(async () => { await post(`/tickets/${t.id}/track`, { track: key, status: statusSel.value || null }); reload(); }));
      const artist = h('select', { disabled: !t.can.manage }, h('option', { value: '' }, '— Artist —'),
        personOptions().map((o) => h('option', { value: o.value, selected: o.value === t[`${key}_assignee_id`] }, o.label)));
      artist.addEventListener('change', () => attempt(async () => { await patch(`/tickets/${t.id}`, { [`${key}_assignee_id`]: Number(artist.value) || null }); reload(); }, 'Saved'));
      const secs = t.time.filter((e) => e.track === key).reduce((s, e) => s + e.seconds, 0);
      const running = t.time.some((e) => e.track === key && !e.ended_at);
      return h('div', { class: 'track' }, h('h3', { style: 'margin-top:0' }, label), h('div', { class: 'grid' }, statusSel, artist),
        h('p', { class: 'small' }, running ? [h('span', { class: 'dot' }), ' ', h('span', { 'data-since': new Date().toISOString(), 'data-base': secs, 'data-format': 'short' }, fmtDuration(secs))] : `⏱ ${fmtDuration(secs)}`));
    };
    finishingCard = h('div', { class: 'card' }, h('h2', {}, 'Finishing status'),
      t.editorial ? h('p', {}, 'From editorial ticket ', h('a', { href: `#/ticket/${t.editorial.id}` }, `${t.editorial.ticket_number} ${t.editorial.title}`)) : null,
      h('div', { class: 'grid cols-2' }, track('picture', 'Picture'), track('sound', 'Sound')));
  } else if (t.board === 'editorial') {
    finishingCard = h('div', { class: 'card' }, h('h2', {}, 'Finishing status'),
      t.finishing.length ? table([
        { label: 'Ticket', render: (f) => h('a', { href: `#/ticket/${f.id}` }, f.ticket_number) },
        { label: 'Picture', render: (f) => [statusChip(f.picture_status), f.picture_artist ? h('div', { class: 'muted small' }, f.picture_artist) : null] },
        { label: 'Sound', render: (f) => [statusChip(f.sound_status), f.sound_artist ? h('div', { class: 'muted small' }, f.sound_artist) : null] },
      ], t.finishing) : h('div', { class: 'kv' }, h('div', {}, h('b', {}, 'Picture'), statusChip(null)), h('div', {}, h('b', {}, 'Sound'), statusChip(null))));
  }

  // ---- related ----
  const related = (t.parent || t.derivatives.length) ? h('div', { class: 'card' }, h('h2', {}, 'Related tickets'),
    t.parent ? h('p', {}, `${t.derivative_type === 'cutdown' ? 'Derivative of' : 'Unarchived from'} `, h('a', { href: `#/ticket/${t.parent.id}` }, `${t.parent.ticket_number} ${t.parent.title}`)) : null,
    t.derivatives.length ? h('ul', {}, t.derivatives.map((d) => h('li', {}, h('a', { href: `#/ticket/${d.id}` }, `${d.ticket_number} ${d.title}`), ' ', statusChip(d.status)))) : null) : null;

  main.append(h('div', { class: 'split' }, h('div', {}, wall, finishingCard, messageBoard(t, reload)),
    h('div', {}, timeCard, timeLog(t, reload), related, historyCard(t))));
}

function messageBoard(t, reload) {
  const kind = h('select', { style: 'width:auto' }, state.meta.messageKinds.map((k) => h('option', {}, k)));
  const link = h('input', { type: 'url', placeholder: 'Review link (https://…)' });
  const body = h('textarea', { placeholder: 'Message, notes, approval request…', rows: 3 });
  const tags = tagPicker([], { placeholder: 'Tag people or clients…' });
  const send = () => attempt(async () => {
    await post(`/tickets/${t.id}/messages`, { kind: kind.value, link_url: link.value.trim() || null, body: body.value.trim() || null, tags: tags.value() });
    reload();
  }, 'Posted');
  return h('div', { class: 'card' }, h('h2', {}, 'Reviews, approvals & notes'),
    h('div', { class: 'grid' }, h('div', { class: 'inline' }, kind, link), body, tags.el, h('div', {}, h('button', { class: 'primary', onclick: send }, 'Post'))),
    h('div', { style: 'margin-top:14px' }, table([
      { label: 'When', render: (m) => [fmtDateTime(m.created_at), h('div', { class: 'muted small' }, m.author_name)] },
      { label: 'Message', render: (m) => [h('div', { class: 'msg-kind' }, m.kind),
        m.link_url ? h('div', {}, h('a', { href: m.link_url, target: '_blank', rel: 'noopener noreferrer' }, m.link_url)) : null,
        m.body ? h('div', { style: 'white-space:pre-wrap' }, m.body) : null,
        m.tags.length ? h('div', { class: 'chips', style: 'margin-top:4px' }, m.tags.map((g) => h('span', { class: 'chip blue' }, g.name))) : null] },
      { label: 'Status', render: (m) => {
        if (!m.review_status && m.kind === 'Note') return '';
        const sel = h('select', { style: 'min-width:150px' }, state.meta.reviewStatuses.map((s) => h('option', { selected: s === m.review_status }, s)));
        sel.addEventListener('change', () => attempt(async () => { await patch(`/messages/${m.id}`, { review_status: sel.value }); reload(); }));
        return [sel, m.status_by_name ? h('div', { class: 'muted small' }, `${m.status_by_name} · ${fmtDateTime(m.status_at)}`) : null];
      } },
    ], t.messages, { empty: 'No messages yet.' })));
}

function timeLog(t, reload) {
  const trackLabel = { main: 'Work', picture: 'Picture', sound: 'Sound' };
  const tracks = t.board === 'finishing' ? ['picture', 'sound'] : ['main'];
  const editableTracks = tracks.filter((k) => t.time_editable[k]);
  const add = () => {
    const f = form([
      ...(tracks.length > 1 ? [{ name: 'track', label: 'Track', type: 'select', required: true, options: editableTracks.map((k) => ({ value: k, label: trackLabel[k] })) }] : []),
      { name: 'started_at', label: 'Start', type: 'datetime-local', required: true },
      { name: 'ended_at', label: 'End', type: 'datetime-local', required: true },
      { name: 'note', label: 'Note', full: true },
    ], { track: editableTracks[0], ended_at: toLocalInput(new Date().toISOString()) });
    modal('Add time manually', f.el, [{ label: 'Cancel' }, { label: 'Add', class: 'primary', onClick: () => attempt(async () => {
      const v = f.values();
      await post(`/tickets/${t.id}/time`, { track: v.track || 'main', started_at: new Date(v.started_at).toISOString(), ended_at: new Date(v.ended_at).toISOString(), note: v.note });
      reload();
    }, 'Time added') }]);
  };
  const edit = (e) => {
    const f = form([
      { name: 'started_at', label: 'Start', type: 'datetime-local', required: true },
      { name: 'ended_at', label: 'End', type: 'datetime-local', required: true },
      { name: 'position', label: 'Logged as (position)', type: 'select', category: 'position', help: 'Change if they were covering a different role.' },
      { name: 'note', label: 'Note', full: true },
    ], { started_at: toLocalInput(e.started_at), ended_at: toLocalInput(e.ended_at), note: e.note, position: e.position });
    modal('Edit time entry', f.el, [
      { label: 'Delete', class: 'danger', onClick: () => attempt(async () => { await del(`/time/${e.id}`); reload(); }, 'Deleted') },
      { label: 'Cancel' },
      { label: 'Save', class: 'primary', onClick: () => attempt(async () => {
        const v = f.values();
        await patch(`/time/${e.id}`, { started_at: new Date(v.started_at).toISOString(), ended_at: new Date(v.ended_at).toISOString(), note: v.note, position: v.position });
        reload();
      }, 'Saved') },
    ]);
  };
  return h('div', { class: 'card' },
    h('div', { class: 'page-head', style: 'margin-bottom:6px' }, h('h2', {}, 'Time log'),
      t.can.time && editableTracks.length ? h('div', { class: 'actions' }, h('button', { class: 'sm', onclick: add }, '+ Add time')) : null),
    t.can.time && !editableTracks.length ? h('p', { class: 'small muted' }, 'Manual edits unlock when the ticket is on hold or completed.') : null,
    table([
      { label: 'Who', render: (e) => [e.person_name || '—', h('div', { class: 'muted small' }, [e.position || 'No position', tracks.length > 1 ? trackLabel[e.track] : null].filter(Boolean).join(' · '))] },
      { label: 'Start', render: (e) => fmtDateTime(e.started_at) },
      { label: 'Length', render: (e) => (e.ended_at ? fmtDuration(e.seconds) : [h('span', { class: 'dot' }), ' running']) },
      { label: '', render: (e) => [e.manual ? h('span', { class: 'chip amber', title: e.note || '' }, 'edited') : null,
        t.can.time && e.ended_at && t.time_editable[e.track] ? h('button', { class: 'sm ghost', onclick: () => edit(e) }, '✎') : null] },
    ], t.time, { empty: 'No time logged yet.' }));
}

function historyCard(t) {
  return h('div', { class: 'card' }, h('h2', {}, 'Activity'),
    h('ul', { class: 'history small' }, t.history.slice(0, 40).map((x) => h('li', {},
      h('span', { class: 'muted' }, `${fmtDateTime(x.at)} · ${x.user_name || 'system'} · `), x.detail || x.action))));
}

function cutDownModal(t) {
  const sel = h('select', {}, h('option', { value: '' }, '— Duration —'), opts('duration').map((d) => h('option', {}, d)));
  const custom = h('input', { placeholder: 'or type one, e.g. :25' });
  modal('Create cut-down', h('div', { class: 'grid' },
    h('p', {}, `Makes a new Draft “Cut-Down <duration> - ${t.creative_name || t.title}” with the same billing number, linked back to ${t.ticket_number}.`),
    sel, custom), [
    { label: 'Cancel' },
    { label: 'Create cut-down', class: 'primary', onClick: () => attempt(async () => {
      const duration = custom.value.trim() || sel.value;
      if (!duration) throw new Error('Enter the new duration');
      const r = await post(`/tickets/${t.id}/status`, { status: 'Cut-Down', duration });
      toast(`${r.created.ticket_number} created`);
      go(`#/ticket/${r.created.id}`);
    }) },
  ]);
}

function finishingModal(t) {
  const f = form([
    { name: 'tracks', label: 'What needs finishing', type: 'multi', options: ['Picture', 'Sound'], required: true },
    { name: 'notes', label: 'Finishing notes', type: 'textarea' },
  ], { tracks: ['Picture', 'Sound'] });
  modal('Request finishing', h('div', {}, h('p', { class: 'muted' }, 'Compiles a finishing ticket with this ticket\'s details, media and tags. It stays linked, and its picture/sound statuses show here.'), f.el), [
    { label: 'Cancel' },
    { label: 'Create finishing ticket', class: 'primary', onClick: () => attempt(async () => {
      const v = f.values();
      const r = await post(`/tickets/${t.id}/finishing`, { picture: v.tracks.includes('Picture'), sound: v.tracks.includes('Sound'), notes: v.notes });
      toast(`${r.ticket_number} sent to the finishing board`);
      go(`#/ticket/${r.id}`);
    }) },
  ]);
}

function editTicketModal(t, reload) {
  const fields = [
    { name: 'title', label: 'Title', required: true, full: true },
    { name: 'account_id', label: 'Billing number', type: 'select', required: true, numeric: true,
      options: [...accountOptions(null), ...(state.lookup.accounts.some((a) => a.id === t.account_id && a.status === 'Open') ? [] : [{ value: t.account_id, label: `${t.billing_code} (closed)` }])] },
    ...(t.board === 'ae' ? [
      { name: 'category', label: 'Category', type: 'select', category: 'ae_category' },
      { name: 'due_date', label: 'Needed by', type: 'date' },
    ] : [
      { name: 'creative_name', label: 'Creative name' },
      { name: 'duration', label: 'Duration', type: 'select', category: 'duration' },
      { name: 'desired_editor_id', label: 'Desired editor', type: 'select', options: personOptions(), numeric: true },
      { name: 'start_date', label: 'Start date', type: 'date' },
      { name: 'first_cut_date', label: 'First cut to client', type: 'date' },
      { name: 'final_lock_date', label: 'Final lock', type: 'date' },
    ]),
    { name: 'brief', label: t.board === 'ae' ? 'Instructions' : 'Creative briefing', type: 'textarea', rows: 5 },
  ];
  const f = form(fields, t);
  const mediaChoices = state.lookup.media.filter((m) => m.project_id === t.project_id || t.media.some((x) => x.id === m.id));
  const mediaBox = h('div', { class: 'checks' }, mediaChoices.map((m) => h('label', {}, h('input', { type: 'checkbox', value: m.id, checked: t.media.some((x) => x.id === m.id) }), `${m.item_number} · ${m.name}`)));
  const tags = tagPicker(t.tags);
  modal(`Edit ${t.ticket_number}`, h('div', {}, f.el, h('h3', {}, 'Physical media'), mediaChoices.length ? mediaBox : h('p', { class: 'muted small' }, 'No media logged for this project.'), h('h3', {}, 'Tags'), tags.el), [
    { label: 'Cancel' },
    { label: 'Save', class: 'primary', onClick: () => attempt(async () => {
      await patch(`/tickets/${t.id}`, { ...f.values(), media_ids: [...mediaBox.querySelectorAll('input:checked')].map((c) => Number(c.value)), tags: tags.value() });
      reload();
    }, 'Saved') },
  ]);
}

// ======================= EDITOR SCHEDULE =======================
export async function schedule(main) {
  const today = new Date().toISOString().slice(0, 10);
  let from = addDays(today, -7);
  const DAYS = 49;
  const body = h('div');
  const render = async () => {
    const to = addDays(from, DAYS - 1);
    const rows = await get(`/schedule${qs({ from, to })}`);
    const byEditor = new Map();
    for (const t of rows) {
      const key = t.assignee_name || (t.desired_editor_name ? `${t.desired_editor_name} (requested)` : 'No editor yet');
      if (!byEditor.has(key)) byEditor.set(key, []);
      byEditor.get(key).push(t);
    }
    // Editors with no bookings still get a row so open time is visible.
    for (const p of state.lookup.personnel.filter((x) => x.department === 'Editorial')) if (!byEditor.has(p.name)) byEditor.set(p.name, []);
    const dayIndex = (d) => Math.round((new Date(`${d}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);
    const grid = h('div', { class: 'sched-grid', style: `grid-template-columns: 180px repeat(${DAYS}, 34px)` });
    grid.append(h('div', { class: 'hd', style: 'grid-row:1;grid-column:1' }, 'Editor'));
    for (let i = 0; i < DAYS; i++) {
      const d = addDays(from, i), dt = new Date(`${d}T00:00:00Z`);
      grid.append(h('div', { class: `hd${[0, 6].includes(dt.getUTCDay()) ? ' we' : ''}${d === today ? ' today' : ''}`, style: `grid-row:1;grid-column:${i + 2}` },
        dt.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', timeZone: 'UTC' })));
    }
    let row = 2;
    const colors = ['blue', 'green', 'purple', 'teal', 'amber'];
    for (const [name, list] of [...byEditor.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      // Greedy lanes so overlapping bookings stack instead of hiding each other.
      const lanes = [];
      for (const t of list.sort((a, b) => a.booking_start.localeCompare(b.booking_start))) {
        let lane = lanes.findIndex((end) => end < t.booking_start);
        if (lane === -1) { lane = lanes.length; lanes.push(''); }
        lanes[lane] = t.booking_end;
        t._lane = lane;
      }
      const n = Math.max(1, lanes.length);
      grid.append(h('div', { class: 'name', style: `grid-row:${row} / span ${n};grid-column:1` }, name, lanes.length > 1 ? h('div', { class: 'chip red', style: 'margin-top:4px' }, 'overlap') : null));
      for (let l = 0; l < n; l++) for (let i = 0; i < DAYS; i++) grid.append(h('div', { class: 'cell', style: `grid-row:${row + l};grid-column:${i + 2}` }));
      list.forEach((t, k) => {
        const s = Math.max(0, dayIndex(t.booking_start)), lockEnd = Math.min(DAYS - 1, dayIndex(t.final_lock_date)), e = Math.min(DAYS - 1, dayIndex(t.booking_end));
        if (e < 0 || s > DAYS - 1) return;
        const c = colors[k % colors.length];
        const title = `${t.ticket_number} ${t.title}\n${t.status}\nStart ${t.start_date} · First cut ${t.first_cut_date || '—'} · Lock ${t.final_lock_date} (+2 day cushion)`;
        if (lockEnd >= s) grid.append(h('div', { class: `bar chip ${c}`, title, style: `grid-row:${row + t._lane};grid-column:${s + 2} / ${lockEnd + 3}`, onclick: () => go(`#/ticket/${t.id}`) }, `${t.ticket_number} ${t.title}`));
        if (e > lockEnd) grid.append(h('div', { class: `bar chip ${c} cushion`, title: 'Cushion after final lock', style: `grid-row:${row + t._lane};grid-column:${Math.max(s, lockEnd + 1) + 2} / ${e + 3};background-image:repeating-linear-gradient(45deg,transparent 0 4px,rgba(255,255,255,.35) 4px 8px)`, onclick: () => go(`#/ticket/${t.id}`) }, '+2'));
      });
      row += n;
    }
    clear(body).append(h('div', { class: 'sched' }, grid));
  };
  main.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Editor schedule'),
    h('div', { class: 'muted' }, 'Bookings span start date → final lock, plus a 2-day cushion (striped).')),
  h('div', { class: 'actions' },
    h('button', { onclick: () => { from = addDays(from, -14); render(); } }, '← 2 weeks'),
    h('button', { onclick: () => { from = addDays(today, -7); render(); } }, 'Today'),
    h('button', { onclick: () => { from = addDays(from, 14); render(); } }, '2 weeks →'),
    h('a', { class: 'btn primary', href: '#/request/editorial' }, '+ Request an editor'))), body);
  await render();
}

