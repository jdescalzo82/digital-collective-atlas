// Account + storage bridge. The app only talks to `account`, so swapping the
// login system means editing this file (or config.js) and nothing else.
//
// Interface:
//   await account.init()          -> resolves once the session is known
//   account.user                  -> { id, name, email } | null (guest)
//   account.connected             -> true when Toolkit Your Life sign-in is available
//   account.onChange(fn)          -> fn(user) on sign-in/out
//   account.signIn() / signOut()
//   account.palettes.list()       -> [{ id, name, medium, colors, createdAt }]
//   account.palettes.save(p)      -> saved palette (with id)
//   account.palettes.remove(id)
//   account.settings.load()       -> saved paint settings | null (signed in only)
//   account.settings.save(obj)    -> stores paint settings with the account

import { CONFIG } from './config.js';

const LS_KEY = 'pigment-lens:palettes';
const read = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; } };
const write = (v) => { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch { /* storage blocked */ } };
const stamp = (p) => ({ ...p, id: p.id || crypto.randomUUID(), createdAt: p.createdAt || new Date().toISOString() });

const localPalettes = {
  async list() { return read(); },
  async save(p) {
    const saved = stamp(p);
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
    signIn() {},
    signOut() {},
    palettes: localPalettes,
    settings: { async load() { return null; }, async save() {} },
  };
}

// Toolkit Your Life: shared Firebase sign-in from /tyl-auth.js (window.tylAuth)
// and one Firestore document per person holding all their palettes.
function toolkitProvider(notify) {
  let tyl = null, db = null, fs = null;
  const self = {
    user: null,
    connected: false,
    async init() {
      try {
        await import(CONFIG.authScript);
      } catch {
        return; // not on toolkityourlife.com: stay in guest mode
      }
      tyl = window.tylAuth;
      if (!tyl) return;
      fs = await import(`https://www.gstatic.com/firebasejs/${CONFIG.firebaseVersion}/firebase-firestore.js`);
      db = fs.getFirestore(tyl.auth.app);
      self.connected = true;
      await tyl.ready;
      let first = true;
      tyl.onChange(async (u) => {
        self.user = u ? { id: u.uid, name: u.displayName, email: u.email } : null;
        if (self.user) await moveGuestPalettes().catch((e) => console.warn('[pigment-lens] sync', e));
        if (!first || self.user) notify(self.user);
        first = false;
      });
    },
    signIn() { tyl?.open(); },
    signOut() { tyl?.signOut(); },
    palettes: {
      list: () => (self.user ? cloudList() : localPalettes.list()),
      save: (p) => (self.user ? cloudUpdate((list) => { const s = stamp(p); return [s, ...list.filter((x) => x.id !== s.id)]; }) : localPalettes.save(p)),
      remove: (id) => (self.user ? cloudUpdate((list) => list.filter((x) => x.id !== id)) : localPalettes.remove(id)),
    },
    // Paints owned, color corrections and custom paints: one JSON field in
    // the same document. Last save wins, which is fine for preferences.
    settings: {
      async load() {
        if (!self.user) return null;
        const snap = await fs.getDoc(ref());
        return snap.exists() && snap.data().settings ? JSON.parse(snap.data().settings) : null;
      },
      async save(obj) {
        if (!self.user) return;
        await fs.setDoc(ref(), { settings: JSON.stringify(obj), settingsUpdated: fs.serverTimestamp() }, { merge: true });
      },
    },
  };

  const ref = () => fs.doc(db, CONFIG.firebaseCollection, self.user.id);
  const parse = (snap) => (snap.exists() ? JSON.parse(snap.data().data || '[]') : []);
  async function cloudList() { return parse(await fs.getDoc(ref())); }
  // Read-modify-write in a transaction so two devices can't overwrite each other.
  function cloudUpdate(change) {
    return fs.runTransaction(db, async (t) => {
      const snap = await t.get(ref());
      const version = snap.exists() ? snap.data().version || 0 : 0;
      const next = change(parse(snap));
      const data = JSON.stringify(next);
      if (data.length > 900000) throw new Error('Too many palettes to save. Delete a few and try again.');
      t.set(ref(), { data, version: version + 1, updated: fs.serverTimestamp() }, { merge: true }); // keep settings
      return next;
    });
  }
  // Palettes saved as a guest move into the account the first time someone signs in.
  async function moveGuestPalettes() {
    const guest = read();
    if (!guest.length) return;
    await cloudUpdate((list) => [...guest.filter((g) => !list.some((x) => x.id === g.id)), ...list]);
    write([]);
  }
  return self;
}

const listeners = new Set();
const notify = (user) => listeners.forEach((fn) => fn(user));
const impl = CONFIG.provider === 'toolkit' ? toolkitProvider(notify) : localProvider();

export const account = {
  get user() { return impl.user; },
  get connected() { return impl.connected; },
  async init() { await impl.init(); notify(impl.user); },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  signIn: () => impl.signIn(),
  signOut: () => impl.signOut(),
  palettes: impl.palettes,
  settings: impl.settings,
};
