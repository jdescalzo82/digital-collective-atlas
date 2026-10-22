// Account + storage bridge. The app only talks to `account`, so swapping the
// login system means editing this file (or config.js) and nothing else.
//
// Interface:
//   await account.init()          -> resolves once the session is known
//   account.user                  -> { id, name, email } | null (guest)
//   account.onChange(fn)          -> fn(user) on sign-in/out
//   account.signIn() / signOut()
//   account.palettes.list()       -> [{ id, name, medium, colors, createdAt }]
//   account.palettes.save(p)      -> saved palette (with id)
//   account.palettes.remove(id)

import { CONFIG } from './config.js';

const LS_KEY = 'pigment-lens:palettes';
const read = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; } };
const write = (v) => { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch { /* storage blocked */ } };

const localPalettes = {
  async list() { return read(); },
  async save(p) {
    const saved = { ...p, id: p.id || crypto.randomUUID(), createdAt: p.createdAt || new Date().toISOString() };
    write([saved, ...read().filter((x) => x.id !== saved.id)]);
    return saved;
  },
  async remove(id) { write(read().filter((x) => x.id !== id)); },
};

function localProvider() {
  return {
    user: null,
    connected: false,
    async init() {},
    signIn() {
      alert('Toolkit Your Life sign-in isn’t connected yet. Your palettes are saved in this browser for now.');
    },
    signOut() {},
    palettes: localPalettes,
  };
}

// Shared-session provider: assumes Toolkit Your Life serves this app on the
// same site and exposes a session cookie plus a small JSON API.
function toolkitProvider({ loginUrl, logoutUrl, apiBase }) {
  const api = (path, opts = {}) => fetch(apiBase + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  }).then((r) => { if (!r.ok) throw new Error(`${r.status} ${path}`); return r.status === 204 ? null : r.json(); });
  const self = {
    user: null,
    connected: true,
    async init() {
      try { self.user = await api('/me'); } catch { self.user = null; }
    },
    signIn() { location.href = loginUrl + encodeURIComponent(location.href); },
    signOut() { location.href = logoutUrl || loginUrl; },
    palettes: {
      list: () => (self.user ? api('/color-mixer/palettes') : localPalettes.list()),
      save: (p) => (self.user ? api('/color-mixer/palettes', { method: 'POST', body: JSON.stringify(p) }) : localPalettes.save(p)),
      remove: (id) => (self.user ? api(`/color-mixer/palettes/${encodeURIComponent(id)}`, { method: 'DELETE' }) : localPalettes.remove(id)),
    },
  };
  return self;
}

const impl = CONFIG.provider === 'toolkit' ? toolkitProvider(CONFIG.toolkit) : localProvider();
const listeners = new Set();

export const account = {
  get user() { return impl.user; },
  get connected() { return impl.connected; },
  async init() { await impl.init(); listeners.forEach((fn) => fn(impl.user)); },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  signIn: () => impl.signIn(),
  signOut: () => impl.signOut(),
  palettes: impl.palettes,
};
