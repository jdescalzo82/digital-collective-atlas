// Shared page chrome for the Palette and Grid tools: account button + toast.
import { account } from './account.js';
import { rgbToLab, hexToRgb } from './color.js';

export const $ = (s) => document.querySelector(s);
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

export function initShell(onUser = () => {}) {
  const btn = $('#account-btn');
  const render = () => {
    btn.hidden = !account.connected;
    btn.textContent = account.user ? (account.user.name || account.user.email || 'Account') : 'Sign in';
  };
  btn.addEventListener('click', () => {
    if (!account.user) return account.signIn();
    if (confirm(`Sign out of Toolkit Your Life (${account.user.email || account.user.name})?`)) account.signOut();
  });
  account.onChange((u) => { render(); onUser(u); });
  return account.init().catch((e) => console.warn('[pigment-lens] sign-in unavailable', e)).finally(render);
}

// Hand colors to the Mix page: it loads its color list from the saved preferences.
export function openInMixer(hexes) {
  const KEY = 'pigment-lens:prefs';
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* ignore */ }
  const colors = hexes.map((hex) => ({
    id: Math.random().toString(36).slice(2), hex, lab: rgbToLab(hexToRgb(hex)), source: 'palette',
  }));
  prefs.colors = colors;
  prefs.active = colors[0]?.id || null;
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  location.href = 'index.html';
}
