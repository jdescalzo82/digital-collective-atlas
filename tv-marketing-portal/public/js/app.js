// App shell: sign-in, the master "Go to…" dropdown, and hash routing.
import { state, get, post, loadMe, loadMeta, loadLookup, can } from './api.js';
import { h, clear, toast } from './ui.js';
import * as onboarding from './views/onboarding.js';
import * as tickets from './views/tickets.js';
import * as people from './views/people.js';
import * as misc from './views/misc.js';

const root = document.getElementById('app');
let main;

// The single master dropdown. Each group only shows what the person can use.
export function menu() {
  const any = () => true;
  return [
    { group: 'Start', items: [
      { label: 'Home', href: '#/', show: any },
      { label: 'My tickets', href: '#/my', show: any },
      { label: 'Scan a barcode', href: '#/scan', show: any },
    ] },
    { group: 'Onboarding', items: [
      { label: 'Personnel (Rolodex)', href: '#/personnel', show: any },
      { label: 'Clients', href: '#/clients', show: any },
      { label: 'Project titles', href: '#/projects', show: any },
      { label: 'Accounts & billing numbers', href: '#/accounts', show: any },
      { label: 'Physical media', href: '#/media', show: any },
      { label: 'Equipment', href: '#/equipment', show: any },
      { label: 'Import from file / screenshot', href: '#/import', show: () => can('import') },
    ] },
    { group: 'New request', items: [
      { label: 'Assistant editor ticket', href: '#/request/ae', show: any },
      { label: 'Editor scheduling request', href: '#/request/editorial', show: any },
      { label: 'Finishing request', href: '#/request/finishing', show: any },
    ] },
    { group: 'Boards', items: [
      { label: 'Needs assignment (managers)', href: '#/manage', show: () => can('manage_ae') || can('manage_editorial') || can('manage_finishing') },
      { label: 'Assistant editor board', href: '#/board/ae', show: any },
      { label: 'Editorial board', href: '#/board/editorial', show: any },
      { label: 'Editor schedule', href: '#/schedule', show: any },
      { label: 'Finishing board', href: '#/board/finishing', show: any },
    ] },
    { group: 'People ops', items: [
      { label: 'HR personnel board', href: '#/hr', show: () => can('hr') },
      { label: 'IT setup board', href: '#/it', show: () => can('it') },
    ] },
    { group: 'Admin', items: [
      { label: 'Dropdown options', href: '#/admin/options', show: () => can('admin') },
      { label: 'Users & permissions', href: '#/admin/users', show: () => can('admin') },
    ] },
  ].map((g) => ({ ...g, items: g.items.filter((i) => i.show()) })).filter((g) => g.items.length);
}

const routes = [
  [/^\/?$/, misc.home],
  [/^\/my$/, tickets.myTickets],
  [/^\/scan$/, misc.scanPage],
  [/^\/notifications$/, misc.notifications],
  [/^\/personnel$/, onboarding.personnelList],
  [/^\/personnel\/(new|\d+)$/, onboarding.personnelDetail],
  [/^\/clients$/, onboarding.clientList],
  [/^\/clients\/(new|\d+)$/, onboarding.clientDetail],
  [/^\/projects$/, onboarding.projectList],
  [/^\/projects\/(new|\d+)$/, onboarding.projectDetail],
  [/^\/accounts$/, onboarding.accountList],
  [/^\/media$/, onboarding.mediaList],
  [/^\/media\/(new|\d+)$/, onboarding.mediaDetail],
  [/^\/equipment$/, onboarding.equipmentList],
  [/^\/equipment\/(new|\d+)$/, onboarding.equipmentDetail],
  [/^\/import$/, misc.importPage],
  [/^\/request\/(ae|editorial|finishing)$/, tickets.requestForm],
  [/^\/manage$/, tickets.manageBoard],
  [/^\/board\/(ae|editorial|finishing)$/, tickets.board],
  [/^\/schedule$/, tickets.schedule],
  [/^\/ticket\/(\d+)$/, tickets.ticketPage],
  [/^\/hr$/, people.hrBoard],
  [/^\/it$/, people.itBoard],
  [/^\/admin\/options$/, misc.adminOptions],
  [/^\/admin\/users$/, misc.adminUsers],
];

let cleanup = [];
export function onLeave(fn) { cleanup.push(fn); }

async function route() {
  if (!state.me) return;
  cleanup.forEach((fn) => fn()); cleanup = [];
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/';
  const goto = document.querySelector('.goto');
  if (goto) goto.value = [...goto.options].some((o) => o.value === `#${path}`) ? `#${path}` : '';
  const found = routes.find(([re]) => re.test(path));
  clear(main);
  if (!found) { main.append(h('div', { class: 'empty' }, 'Page not found. ', h('a', { href: '#/' }, 'Go home'))); return; }
  try {
    await found[1](main, ...path.match(found[0]).slice(1));
  } catch (e) {
    if (e.status === 401) return showLogin();
    main.append(h('div', { class: 'card empty' }, e.message));
  }
  window.scrollTo(0, 0);
}

export async function refreshLookup() { await loadLookup(); }
export function rerender() { route(); }

async function refreshBell() {
  try {
    const me = await get('/me');
    const c = document.querySelector('.bell .count');
    if (c) { c.textContent = me.unread; c.hidden = !me.unread; }
  } catch { /* ignore */ }
}

function shell() {
  const goto = h('select', { class: 'goto', 'aria-label': 'Go to', onchange: (e) => { if (e.target.value) location.hash = e.target.value; } },
    h('option', { value: '' }, 'Go to…'),
    menu().map((g) => h('optgroup', { label: g.group }, g.items.map((i) => h('option', { value: i.href }, i.label)))));
  const search = h('input', { type: 'search', class: 'search', placeholder: 'Find a ticket (number, title, billing #)…',
    onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) location.hash = `#/my?q=${encodeURIComponent(e.target.value.trim())}`; } });
  const bell = h('a', { class: 'btn ghost bell', href: '#/notifications', title: 'Notifications' }, '🔔', h('span', { class: 'count', hidden: true }, '0'));
  main = h('main');
  clear(root).append(
    h('header', { class: 'topbar' },
      h('a', { class: 'brand', href: '#/' }, 'Production', h('span', {}, ' Portal')),
      goto, search, h('div', { class: 'spacer' }), bell,
      h('span', { class: 'muted small' }, state.me.display_name),
      h('button', { class: 'sm', onclick: async () => { await post('/logout'); state.me = null; showLogin(); } }, 'Sign out')),
    main);
  refreshBell();
}

function showLogin() {
  const user = h('input', { name: 'username', autocomplete: 'username', placeholder: 'Username' });
  const pass = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', placeholder: 'Password' });
  const submit = async (e) => {
    e.preventDefault();
    try {
      await post('/login', { username: user.value.trim(), password: pass.value });
      await start();
    } catch (err) { toast(err.message, 'error'); }
  };
  clear(root).append(h('form', { class: 'card login', onsubmit: submit },
    h('h1', {}, 'Production Portal'), h('p', { class: 'muted' }, 'Sign in to continue.'),
    h('div', { class: 'grid' }, user, pass, h('button', { class: 'primary', type: 'submit' }, 'Sign in'))));
  user.focus();
}

async function start() {
  try {
    await loadMe();
  } catch { return showLogin(); }
  await Promise.all([loadMeta(), loadLookup()]);
  shell();
  route();
}

window.addEventListener('hashchange', route);
setInterval(() => { if (state.me) refreshBell(); }, 30000);
start();
