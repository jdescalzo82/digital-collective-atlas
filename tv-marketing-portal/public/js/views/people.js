// People ops: HR verifies records and confirms dates, then releases them to IT.
// IT never sees pay rate or frequency.
import { state, get, patch } from '../api.js';
import { h, form, table, statusChip, attempt, modal, fmtDate, fmtMoney } from '../ui.js';
import { refreshLookup } from '../app.js';

const go = (hash) => { location.hash = hash; };

export async function hrBoard(main) {
  const rows = await get('/personnel');
  const body = h('div');
  main.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'HR personnel board'),
    h('div', { class: 'muted' }, 'Verify each record, confirm dates with the employee or freelancer, then send to IT.')),
  h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '#/personnel/new' }, '+ Add person'))), body);
  for (const status of state.meta.hrStatuses) {
    const list = rows.filter((r) => r.hr_status === status);
    body.append(h('div', { class: 'card' }, h('h2', {}, status, ' ', h('span', { class: 'chip' }, list.length)),
      table([
        { label: 'Name', render: (r) => h('b', {}, `${r.first_name} ${r.last_name}`) },
        { label: 'Title / dept', render: (r) => [r.title, h('div', { class: 'muted small' }, r.department)] },
        { label: 'Type', key: 'employment_type' },
        { label: 'Rate', render: (r) => (r.rate ? `${fmtMoney(r.rate)} / ${r.rate_frequency || '—'}` : h('span', { class: 'muted' }, 'missing')) },
        { label: 'Dates', render: (r) => `${fmtDate(r.start_date) || '—'} → ${fmtDate(r.end_date) || 'open'}` },
        { label: 'Contact', render: (r) => [r.email, h('div', { class: 'muted small' }, r.mobile || r.phone || '')] },
        { label: 'IT', render: (r) => statusChip(r.it_status) },
      ], list, { onRow: (r) => hrModal(r), empty: 'Nobody here.' })));
  }
}

function hrModal(p) {
  const f = form([
    { name: 'employment_type', label: 'Staff or freelance', type: 'select', category: 'employment_type' },
    { name: 'rate', label: 'Rate ($)', type: 'number' },
    { name: 'rate_frequency', label: 'Rate frequency', type: 'select', category: 'rate_frequency' },
    { name: 'start_date', label: 'Confirmed start date', type: 'date' },
    { name: 'end_date', label: 'Confirmed end date', type: 'date' },
    { name: 'hr_status', label: 'HR status', type: 'select', options: state.meta.hrStatuses, required: true },
    { name: 'hr_notes', label: 'HR notes (not shared with IT)', type: 'textarea' },
  ], p);
  const summary = h('div', { class: 'kv', style: 'margin-bottom:14px' },
    ...[['Email', p.email], ['Phone', p.mobile || p.phone], ['Address', [p.address, p.city, p.state, p.zip].filter(Boolean).join(', ')],
      ['Emergency', [p.emergency_name, p.emergency_phone].filter(Boolean).join(' · ')], ['Title', p.title], ['Department', p.department],
      ['Projects', p.project_names], ['Equipment needed', p.equipment_needed]]
      .map(([k, v]) => h('div', {}, h('b', {}, k), v || h('span', { class: 'muted' }, '—'))));
  const save = (status) => attempt(async () => {
    const v = f.values();
    if (status) v.hr_status = status;
    await patch(`/personnel/${p.id}/hr`, v);
    await refreshLookup();
    go(`#/hr?t=${Date.now()}`);
  }, status === 'Sent to IT' ? 'Sent to IT — they have been notified' : 'Saved');
  modal(`${p.first_name} ${p.last_name}`, h('div', {}, summary, h('p', {}, h('a', { href: `#/personnel/${p.id}` }, 'Edit full record →')), f.el), [
    { label: 'Save', onClick: () => save() },
    { label: 'Mark verified', onClick: () => save('Verified') },
    { label: 'Dates confirmed', onClick: () => save('Dates Confirmed') },
    { label: 'Send to IT', class: 'primary', onClick: () => save('Sent to IT') },
  ]);
}

export async function itBoard(main) {
  const rows = await get('/it/personnel');
  const body = h('div');
  main.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'IT setup board'),
    h('div', { class: 'muted' }, 'People released by HR. Set up systems, software, hardware and a workstation.'))), body);
  for (const status of state.meta.itStatuses.filter((s) => s !== 'Waiting on HR')) {
    const list = rows.filter((r) => r.it_status === status);
    body.append(h('div', { class: 'card' }, h('h2', {}, status, ' ', h('span', { class: 'chip' }, list.length)),
      table([
        { label: 'Name', render: (r) => h('b', {}, `${r.first_name} ${r.last_name}`) },
        { label: 'Starts', render: (r) => fmtDate(r.start_date) },
        { label: 'Title / dept', render: (r) => [r.title, h('div', { class: 'muted small' }, r.department)] },
        { label: 'Type', key: 'employment_type' },
        { label: 'Contact', render: (r) => [r.email, h('div', { class: 'muted small' }, r.mobile || r.phone || '')] },
        { label: 'Projects', key: 'project_names' },
        { label: 'Needs', key: 'equipment_needed' },
        { label: 'Workstation', key: 'workstation_location' },
        { label: 'Assigned gear', key: 'assigned_equipment' },
      ], list, { onRow: (r) => itModal(r), empty: 'Nobody here.' })));
  }
}

function itModal(p) {
  const split = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const f = form([
    { name: 'it_status', label: 'IT status', type: 'select', options: state.meta.itStatuses.filter((s) => s !== 'Waiting on HR'), required: true },
    { name: 'workstation_location', label: 'Workstation location', type: 'select', category: 'workstation_location' },
    { name: 'it_system', label: 'System / OS' },
    { name: 'it_software', label: 'Software', type: 'multi', category: 'software' },
    { name: 'it_hardware', label: 'Hardware', type: 'multi', category: 'hardware' },
    { name: 'it_accounts', label: 'Accounts created (email, storage, VPN…)', type: 'textarea' },
    { name: 'it_notes', label: 'IT notes', type: 'textarea' },
  ], { ...p, it_software: split(p.it_software), it_hardware: split(p.it_hardware) });
  modal(`${p.first_name} ${p.last_name} — starts ${fmtDate(p.start_date) || 'TBD'}`, h('div', {},
    h('div', { class: 'kv', style: 'margin-bottom:14px' },
      ...[['Title', p.title], ['Department', p.department], ['Type', p.employment_type], ['Email', p.email], ['Phone', p.mobile || p.phone],
        ['Projects', p.project_names], ['Requested equipment', p.equipment_needed], ['Assigned gear', p.assigned_equipment]]
        .map(([k, v]) => h('div', {}, h('b', {}, k), v || h('span', { class: 'muted' }, '—')))),
    h('p', {}, h('a', { href: `#/equipment/new` }, '+ Register equipment for this person')), f.el), [
    { label: 'Cancel' },
    { label: 'Save', class: 'primary', onClick: () => attempt(async () => {
      const v = f.values();
      await patch(`/personnel/${p.id}/it`, { ...v, it_software: v.it_software.join(', '), it_hardware: v.it_hardware.join(', ') });
      go(`#/it?t=${Date.now()}`);
    }, 'Saved') },
  ]);
}

