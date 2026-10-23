// DOM helpers, forms, modals, toasts, status chips, tag picker.
import { state, opts } from './api.js';

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = Boolean(v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const clear = (el) => { el.replaceChildren(); return el; };

export function toast(msg, type = '') {
  const t = h('div', { class: `toast ${type}` }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), type === 'error' ? 6000 : 3200);
}
export async function attempt(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast(e.message, 'error');
    throw e;
  }
}

export function modal(title, body, actions = []) {
  let resolveClose;
  const closed = new Promise((r) => { resolveClose = r; });
  const close = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolveClose(v); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': title },
      h('header', {}, h('h2', {}, title), h('button', { class: 'ghost', onclick: () => close(), 'aria-label': 'Close' }, '✕')),
      h('div', { class: 'body' }, body),
      actions.length ? h('footer', {}, actions.map((a) => h('button', {
        class: a.class || '', onclick: async (e) => {
          e.target.disabled = true;
          try { const v = await a.onClick?.(); if (v !== false) close(v); } catch { /* toast already shown */ } finally { e.target.disabled = false; }
        },
      }, a.label))) : null));
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  overlay.querySelector('input, select, textarea')?.focus();
  return { close, closed, el: overlay };
}

export function confirmBox(title, message, label = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    const m = modal(title, h('p', {}, message), [
      { label: 'Cancel', onClick: () => resolve(false) },
      { label, class: danger ? 'danger' : 'primary', onClick: () => resolve(true) },
    ]);
    m.closed.then(() => resolve(false));
  });
}

// ---------- formatting ----------
export const fmtDate = (d) => {
  if (!d) return '';
  const date = d.length <= 10 ? new Date(`${d}T00:00:00`) : new Date(d);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
export const fmtDateTime = (d) => (d ? new Date(d.includes('T') ? d : `${d.replace(' ', 'T')}Z`).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
export const fmtMoney = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const hrs = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return `${hrs}h ${String(m).padStart(2, '0')}m`;
}
export function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  return [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60].map((n, i) => (i ? String(n).padStart(2, '0') : n)).join(':');
}
export const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

// ---------- statuses ----------
const STATUS_COLORS = {
  Draft: 'gray', Queued: 'blue', Scheduled: 'blue', 'In Progress': 'green', 'On Hold': 'amber', Completed: 'teal', Cancelled: 'red',
  'Out for Approval': 'purple', 'Out to Creative Review': 'purple', 'Out for Client Review': 'purple', 'Out for Legal Review': 'purple',
  'Out for Final Approval': 'purple', 'Applying Client Notes': 'green', 'Applying Legal': 'green', 'Final Notes': 'green',
  'Final Lock': 'teal', Shipped: 'teal', 'Ready for Backup': 'gray', Archived: 'gray',
  'Prep Requested': 'blue', 'Prep In Progress': 'green', 'Ready for Review': 'purple', 'Ready to Review': 'purple', 'Under Review': 'purple',
  'Ready for Delivery': 'teal', 'Prep Sent': 'teal', Approved: 'teal',
  Active: 'green', Killed: 'red', Open: 'green', Closed: 'gray',
  'Pending Review': 'amber', Verified: 'blue', 'Dates Confirmed': 'purple', 'Sent to IT': 'teal',
  'Waiting on HR': 'gray', 'Not Started': 'amber', Ready: 'teal',
  Pending: 'amber', 'Changes Requested': 'red', Rejected: 'red', Info: 'gray',
};
export const statusChip = (s) => (s ? h('span', { class: `chip ${STATUS_COLORS[s] || ''}` }, s) : h('span', { class: 'muted' }, '—'));

// ---------- forms ----------
// field: { name, label, type, options|category|lookup, required, full, help, readonly, section }
export function form(fields, values = {}) {
  const inputs = {};
  const el = h('div', { class: 'form' });
  for (const f of fields) {
    if (f.section) { el.append(h('div', { class: 'section-title' }, f.section)); continue; }
    const v = values[f.name];
    let input;
    const choices = () => {
      if (f.options) return typeof f.options === 'function' ? f.options(values) : f.options;
      if (f.category) return opts(f.category).map((o) => ({ value: o, label: o }));
      return [];
    };
    const norm = (c) => (typeof c === 'object' ? c : { value: c, label: c });
    switch (f.type) {
      case 'textarea':
        input = h('textarea', { name: f.name, rows: f.rows || 3 }, v ?? '');
        break;
      case 'select': {
        const list = choices().map(norm);
        if (v && !list.some((c) => String(c.value) === String(v))) list.push({ value: v, label: `${v} (not in list)` });
        input = h('select', { name: f.name }, h('option', { value: '' }, f.placeholder || '— Select —'),
          list.map((c) => h('option', { value: c.value, selected: String(c.value) === String(v ?? '') }, c.label)));
        break;
      }
      case 'multi': {
        const list = choices().map(norm);
        const sel = new Set((Array.isArray(v) ? v : []).map(String));
        input = h('div', { class: 'checks' }, list.map((c) => h('label', {},
          h('input', { type: 'checkbox', value: c.value, checked: sel.has(String(c.value)) }), c.label)));
        input.multi = true;
        break;
      }
      case 'barcode':
        input = h('input', { name: f.name, value: v ?? '', placeholder: f.placeholder || 'Scan or type — blank = auto', autocomplete: 'off' });
        break;
      default:
        input = h('input', { name: f.name, type: f.type || 'text', value: v ?? '', step: f.type === 'number' ? 'any' : null, placeholder: f.placeholder || null });
    }
    if (f.readonly) input.disabled = true;
    if (f.onChange) input.addEventListener('change', () => f.onChange(input.value, inputs));
    inputs[f.name] = input;
    let control = input;
    if (f.type === 'barcode') {
      control = h('div', { class: 'inline' }, input, h('button', {
        type: 'button', title: 'Scan with camera', onclick: async () => {
          const { scanBarcode } = await import('./scanner.js');
          const code = await scanBarcode();
          if (code) input.value = code;
        },
      }, '📷 Scan'));
    }
    el.append(h('div', { class: `field${f.full || ['textarea', 'multi'].includes(f.type) ? ' full' : ''}` },
      h('label', {}, f.label, f.required ? h('span', { class: 'req' }, ' *') : null), control, f.help ? h('div', { class: 'help' }, f.help) : null));
  }
  return {
    el, inputs,
    values() {
      const out = {};
      for (const f of fields) {
        if (f.section || f.readonly) continue;
        const i = inputs[f.name];
        if (i.multi) out[f.name] = [...i.querySelectorAll('input:checked')].map((c) => (f.numeric ? Number(c.value) : c.value));
        else if (f.type === 'number') out[f.name] = i.value === '' ? null : Number(i.value);
        else if (f.numeric) out[f.name] = i.value === '' ? null : Number(i.value);
        else out[f.name] = i.value.trim() === '' ? null : i.value.trim();
      }
      for (const f of fields) {
        if (f.required && (out[f.name] === null || out[f.name] === undefined || (Array.isArray(out[f.name]) && !out[f.name].length))) {
          throw new Error(`${f.label} is required`);
        }
      }
      return out;
    },
  };
}

// Lookup option builders
export const personOptions = (filter) => (state.lookup?.personnel || []).filter(filter || (() => true))
  .map((p) => ({ value: p.id, label: `${p.name}${p.title ? ` — ${p.title}` : ''}` }));
export const clientOptions = () => (state.lookup?.clients || []).map((c) => ({ value: c.id, label: c.name }));
export const projectOptions = (onlyOpen = true) => (state.lookup?.projects || [])
  .filter((p) => !onlyOpen || !['Killed', 'Cancelled'].includes(p.status))
  .map((p) => ({ value: p.id, label: `${p.official_name}${p.code_name ? ` (${p.code_name})` : ''} · ${p.client_name}` }));
export const accountOptions = (projectId, onlyOpen = true) => (state.lookup?.accounts || [])
  .filter((a) => (!projectId || a.project_id === Number(projectId)) && (!onlyOpen || a.status === 'Open'))
  .map((a) => ({ value: a.id, label: `${a.billing_code} · ${a.department}` }));

// ---------- tag picker ----------
const TAG_TYPES = {
  personnel: { label: 'Person', list: () => state.lookup.personnel.map((p) => ({ id: p.id, name: p.name, sub: p.title || '' })) },
  client: { label: 'Client', list: () => state.lookup.clients.map((c) => ({ id: c.id, name: c.name, sub: 'Client' })) },
  media: { label: 'Media', list: () => state.lookup.media.map((m) => ({ id: m.id, name: `${m.item_number} · ${m.name}`, sub: m.media_type || 'Media' })) },
  equipment: { label: 'Equipment', list: () => state.lookup.equipment.map((e) => ({ id: e.id, name: `${e.item_number} · ${e.name}`, sub: e.equipment_type || 'Equipment' })) },
};
export function tagPicker(initial = [], { types = Object.keys(TAG_TYPES), placeholder = 'Tag people, clients, media, equipment…' } = {}) {
  let tags = [...initial];
  const chips = h('div', { class: 'chips', style: 'margin-bottom:6px' });
  const results = h('div', { class: 'results', hidden: true });
  const input = h('input', { placeholder, autocomplete: 'off' });
  const render = () => {
    clear(chips).append(...tags.map((t, i) => h('span', { class: `chip ${t.entity_type === 'client' ? 'purple' : t.entity_type === 'personnel' ? 'blue' : 'teal'}` },
      t.name, h('button', { type: 'button', 'aria-label': 'Remove', onclick: () => { tags.splice(i, 1); render(); } }, '×'))));
  };
  const search = () => {
    const q = input.value.trim().toLowerCase().replace(/^@/, '');
    if (!q) { results.hidden = true; return; }
    const matches = [];
    for (const type of types) {
      for (const it of TAG_TYPES[type].list()) {
        if (`${it.name} ${it.sub}`.toLowerCase().includes(q) && !tags.some((t) => t.entity_type === type && t.entity_id === it.id)) matches.push({ type, ...it });
      }
    }
    clear(results).append(...matches.slice(0, 10).map((m) => h('div', {
      onmousedown: (e) => { e.preventDefault(); tags.push({ entity_type: m.type, entity_id: m.id, name: m.name }); input.value = ''; results.hidden = true; render(); },
    }, h('span', {}, m.name), h('span', { class: 'muted small' }, TAG_TYPES[m.type].label))));
    results.hidden = !matches.length;
  };
  input.addEventListener('input', search);
  input.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 150));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); results.firstChild?.dispatchEvent(new MouseEvent('mousedown')); } });
  render();
  return { el: h('div', { class: 'picker' }, chips, input, results), value: () => tags.map(({ entity_type, entity_id }) => ({ entity_type, entity_id })) };
}

export function table(columns, rows, { onRow, empty = 'Nothing here yet.' } = {}) {
  if (!rows.length) return h('div', { class: 'empty' }, empty);
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', {}, c.label)))),
    h('tbody', {}, rows.map((r) => h('tr', { class: onRow ? 'click' : '', onclick: onRow ? () => onRow(r) : null },
      columns.map((c) => h('td', { class: c.class || '' }, c.render ? c.render(r) : r[c.key] ?? '')))))));
}

export function filterBar(filters, onChange) {
  const els = filters.map((f) => {
    if (f.type === 'search') return h('input', { type: 'search', placeholder: f.placeholder || 'Search…', 'data-k': f.key });
    return h('select', { 'data-k': f.key }, h('option', { value: '' }, f.label),
      (typeof f.options === 'function' ? f.options() : f.options).map((o) => (typeof o === 'object' ? h('option', { value: o.value }, o.label) : h('option', { value: o }, o))));
  });
  const read = () => Object.fromEntries(els.map((e) => [e.dataset.k, e.value]).filter(([, v]) => v));
  let timer;
  for (const e of els) e.addEventListener(e.tagName === 'INPUT' ? 'input' : 'change', () => { clearTimeout(timer); timer = setTimeout(() => onChange(read()), 200); });
  return { el: h('div', { class: 'filters' }, els), read };
}

export const qs = (obj) => {
  const s = new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== '' && v !== null && v !== undefined)).toString();
  return s ? `?${s}` : '';
};
