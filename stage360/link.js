/*
 * Every Seat — link to the backend (api/).
 *
 *  - Pairing: the viewer (Quest / browser) shows a code; a phone, Mac or web
 *    remote enters it and can then pick seats, play/pause and change settings.
 *    Commands are polled from the API and applied through window.EverySeat.
 *  - Live director: following a show code makes the guided view take the
 *    director's camera cuts instead of the built-in script.
 *
 * Deep links: ?pair=1 opens a pairing code at once; ?show=ABC123 follows a show.
 * In a headset a pairing code is opened automatically and printed on the program.
 * If the API isn't reachable (e.g. a static host without PHP) none of this shows.
 */
(() => {
  'use strict';
  const API = new URL('api/', location.href).href;
  const qs = new URLSearchParams(location.search);
  const $ = id => document.getElementById(id);

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  class ApiError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  }
  async function api(method, route, { body, token, query = '' } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res;
    try {
      res = await fetch(`${API}?r=${route}${query}`, {
        method, signal: ctrl.signal, cache: 'no-store', credentials: 'same-origin',
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { 'X-ES-Token': token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { throw new ApiError(0, 'network', 'Can’t reach the server.'); }
    finally { clearTimeout(timer); }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) { const e = (data && data.error) || {}; throw new ApiError(res.status, e.code || 'error', e.message || `HTTP ${res.status}`); }
    if (!data) throw new ApiError(res.status, 'bad_response', 'Unexpected reply from the server.');
    return data;
  }

  let ES = null, pollMs = 1000;
  const note = (id, text, err = false) => { const el = $(id); if (el) { el.textContent = text; el.classList.toggle('linkerr', err); } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ------------------------------------------------------------ pairing */
  const pair = { room: null, token: null, code: null, cursor: -1, running: false, lastStatus: '', lastPush: 0, failures: 0 };

  function showPairUI() {
    const on = !!pair.room;
    $('pairIdle').hidden = on; $('pairOn').hidden = !on;
    $('pairCode').textContent = pair.code || '—';
    ES.setBadge(on ? `REMOTE CODE ${pair.code}` : '');
  }

  async function startPairing() {
    if (pair.room || pair.starting) return;
    pair.starting = true;
    $('pairBtn').disabled = true;
    note('pairNote', 'Getting a code…');
    try {
      const d = await api('POST', '/rooms', { body: {} });
      Object.assign(pair, { room: d.room, token: d.token, code: d.display_code, cursor: -1, failures: 0 });
      pollMs = d.poll_ms || pollMs;
      store.set('es_pair', { room: d.room, token: d.token, code: d.display_code, at: Date.now() });
      showPairUI();
      note('pairNote', `On the phone or Mac, open ${new URL('remote/', location.href).href.replace(/^https?:\/\//, '')} and enter this code.`);
      runPairLoop();
    } catch (e) {
      note('pairNote', e.code === 'rate_limited' ? e.message : 'Couldn’t get a code. Check the connection and try again.', true);
    } finally { pair.starting = false; $('pairBtn').disabled = false; }
  }

  function endPairing(message) {
    pair.running = false;
    Object.assign(pair, { room: null, token: null, code: null, cursor: -1 });
    store.del('es_pair');
    showPairUI();
    note('pairNote', message || '');
  }

  async function stopPairing() {
    const { room, token } = pair;
    endPairing('Sharing stopped.');
    if (room) try { await api('DELETE', `/rooms/${room}`, { token }); } catch {}
  }

  async function pushStatus(force) {
    const st = ES.state();
    const key = JSON.stringify({ ...st, t: Math.round(st.t) });
    const now = Date.now();
    if (!force && key === pair.lastStatus && now - pair.lastPush < 5000) return;
    pair.lastStatus = key; pair.lastPush = now;
    await api('POST', `/rooms/${pair.room}/status`, { token: pair.token, body: { status: st } });
  }

  async function runPairLoop() {
    if (pair.running) return;
    pair.running = true;
    const room = pair.room;
    let lastRemotes = -1;
    while (pair.running && pair.room === room) {
      try {
        const d = await api('GET', `/rooms/${room}/commands`, { token: pair.token, query: `&after=${pair.cursor}` });
        if (pair.room !== room) break;
        for (const c of d.commands) {
          try { ES.command(c); } catch (err) { console.warn('Every Seat: command failed', c, err); }
        }
        pair.cursor = d.cursor;
        await pushStatus(d.commands.length > 0);
        if (d.remotes !== lastRemotes) {
          lastRemotes = d.remotes;
          if (d.remotes > 0) note('pairNote', d.remotes === 1 ? 'A remote is connected.' : `${d.remotes} remotes are connected.`);
        }
        pair.failures = 0;
      } catch (e) {
        if (e.status === 403 || e.status === 404) { endPairing('This pairing has ended. Show a new code to pair again.'); break; }
        pair.failures++;
        if (pair.failures === 3) note('pairNote', 'Reconnecting…', true);
      }
      const base = document.hidden ? 5000 : pollMs;
      await sleep(Math.min(15000, base * (1 + Math.min(pair.failures, 6))));
    }
  }

  // A reload keeps the same code (rooms close by themselves after two idle hours).
  async function resumePairing() {
    const saved = store.get('es_pair');
    if (!saved || !saved.room || Date.now() - saved.at > 2 * 3600 * 1000) return false;
    Object.assign(pair, { room: saved.room, token: saved.token, code: saved.code, cursor: -1 });
    showPairUI();
    note('pairNote', 'Still sharing. Enter the code on the phone or Mac.');
    runPairLoop();
    return true;
  }

  /* ------------------------------------------------------- live director */
  const live = { code: null, version: -1, autoVer: -1, chVer: -1, running: false, viewer: null };

  function viewerId() {
    let id = store.get('es_viewer');
    if (!id || !/^[A-Za-z0-9_-]{8,40}$/.test(id)) {
      const a = new Uint8Array(12); crypto.getRandomValues(a);
      id = Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
      store.set('es_viewer', id);
    }
    return id;
  }

  function cleanCode(v) { return String(v || '').toUpperCase().replace(/[\s-]+/g, ''); }

  async function follow(raw) {
    const code = cleanCode(raw);
    if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(code)) {
      note('showNote', 'Show codes are 6 letters and numbers, like K7Q-4MZ.', true); return;
    }
    unfollow(true);
    Object.assign(live, { code, version: -1, autoVer: -1, chVer: -1, viewer: viewerId() });
    $('showCode').value = code.slice(0, 3) + '-' + code.slice(3);
    $('showJoin').hidden = true; $('showLeave').hidden = false;
    note('showNote', 'Connecting to the show…');
    runLiveLoop(code);
  }

  function unfollow(silent) {
    live.running = false; live.code = null; live.version = -1; live.autoVer = -1; live.chVer = -1;
    ES.setLiveCue(null);
    ES.setCueTrack(null);
    $('showJoin').hidden = false; $('showLeave').hidden = true;
    if (!silent) note('showNote', 'Back to the built-in director’s cut.');
  }

  async function runLiveLoop(code) {
    live.running = true;
    let failures = 0;
    while (live.running && live.code === code) {
      try {
        const d = await api('GET', `/shows/${code}`, { query: `&viewer=${live.viewer}` });
        if (live.code !== code) break;
        failures = 0;
        if (d.ended) { unfollow(true); note('showNote', `“${d.title}” has ended.`); break; }
        if (d.version !== live.version) {
          live.version = d.version;
          ES.setLiveCue(d.live && d.cue ? d.cue : null);
        }
        // The operator's recorded automation feeds the guided view when no director is live.
        if ((d.automation_version || 0) !== live.autoVer) {
          live.autoVer = d.automation_version || 0;
          if (live.autoVer > 0) {
            try {
              const a = await api('GET', `/shows/${code}/automation`);
              if (live.code === code) ES.setCueTrack(a.cues);
            } catch (e) { live.autoVer = -1; /* retry next poll */ }
          } else ES.setCueTrack(null);
        }
        // The hub's channel map points each seat at its synced video.
        if ((d.channels_version || 0) !== live.chVer && (d.channels_version || 0) > 0) {
          live.chVer = d.channels_version || 0;
          try {
            const c = await api('GET', `/shows/${code}/channels`);
            if (live.code === code) {
              const resolved = {};
              for (const [id, ch] of Object.entries(c.channels || {})) {
                resolved[id] = { ...ch, src: new URL(ch.src, new URL('./', location.href)).href };
              }
              ES.setChannels(resolved);
            }
          } catch (e) { live.chVer = -1; /* retry next poll */ }
        }
        note('showNote', d.live ? `Following “${d.title}” live.${ES.state().guided ? '' : ' Turn on the director’s cut to follow their cuts.'}`
                                : `“${d.title}”: waiting for the director to go live.`);
      } catch (e) {
        if (e.status === 404 || e.status === 422) { unfollow(true); note('showNote', 'No live show with that code.', true); break; }
        failures++;
        if (failures === 3) note('showNote', 'Reconnecting to the show…', true);
      }
      await sleep(Math.min(15000, (document.hidden ? 5000 : pollMs) * (1 + Math.min(failures, 6))));
    }
  }

  /* --------------------------------------------------------------- start */
  async function init() {
    ES = window.EverySeat;
    try {
      const cfg = await api('GET', '/config');
      pollMs = Math.max(500, cfg.poll_ms || 1000);
    } catch { return; } // no backend here: keep the player standalone
    $('linkBox').hidden = false;
    $('pairBtn').addEventListener('click', startPairing);
    $('pairStop').addEventListener('click', stopPairing);
    $('showForm').addEventListener('submit', e => { e.preventDefault(); follow($('showCode').value); });
    $('showLeave').addEventListener('click', () => unfollow(false));
    // Keys typed into the code box must not drive the player's keyboard shortcuts.
    $('showCode').addEventListener('keydown', e => e.stopPropagation());
    addEventListener('everyseat:xrstart', () => { if (!pair.room) startPairing(); });

    const resumed = await resumePairing();
    if (!resumed && (qs.get('pair') === '1' || ES.isXR())) startPairing();
    if (qs.get('show')) follow(qs.get('show'));
  }

  if (window.EverySeat) init();
  else addEventListener('everyseat:ready', init, { once: true });
})();
