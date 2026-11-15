document.addEventListener('DOMContentLoaded', () => {
  const DCA = window.DCA || {};
  const api = DCA.api || null;
  const storage = DCA.storage || {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    remove(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  const KEYS = {
    accepted: 'dca_warning_accepted',
    visitor: 'dca_visitor_token',
    name: 'bridge_name',
    bridge: 'dca_bridge_token'
  };

  // Keep in sync with server/validation.py and server/config.py.
  const NAME_MAX = 32;
  const GITHUB_REPO = 'steviesonz/digital-collective-atlas';
  const DAY_ONE = Date.UTC(2025, 9, 23);        // 2025-10-23 = Day 1
  const APPROACH = Date.UTC(2025, 11, 19);      // closest approach
  const DAY_MS = 86400000;

  const $ = (id) => document.getElementById(id);
  const modal = $('warning-modal');
  const acceptBtn = $('accept-risk-btn');
  const terminal = $('terminal-container');
  const bootSeq = $('boot-sequence');
  const feed = $('feed');
  const nameInput = $('user-name-input');
  const nameError = $('name-error');
  const postLogin = $('post-login-content');
  const displayName = $('display-name');
  const forkCount = $('fork-count');
  const countdown = $('countdown');
  const nameEntryBlock = $('name-entry-block');
  const changeBtn = $('change-name-btn');
  const forgetBtn = $('forget-me-btn');

  const reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Page state (declared up front: consent can boot the terminal immediately).
  let booted = false;
  let submitting = false;
  let statsLoading = false;

  const show = (el) => { if (el) { el.classList.remove('hidden'); el.style.display = ''; } };
  const hide = (el) => { if (el) el.style.display = 'none'; };

  // ---------------------------------------------------------------- 1. CONSENT


  function enterTerminal(animate) {
    if (booted) return;
    booted = true;
    hide(modal);
    show(terminal);
    if (animate && !reducedMotion && bootSeq) {
      runBootSequence();
    } else {
      hide(bootSeq);
      show(feed);
      checkPersistence();
    }
    loadStats();
  }

  function recordConsent() {
    if (!api) return;
    api.consent(storage.get(KEYS.visitor))
      .then((d) => { if (d && d.token) storage.set(KEYS.visitor, d.token); })
      .catch(() => { /* consent is still remembered locally */ });
  }

  if (storage.get(KEYS.accepted)) {
    enterTerminal(false);
  } else if (acceptBtn) {
    acceptBtn.focus();
    acceptBtn.addEventListener('click', () => {
      if (acceptBtn.disabled) return;
      acceptBtn.disabled = true;
      storage.set(KEYS.accepted, 'true');
      recordConsent();
      enterTerminal(true);
    });
  } else {
    enterTerminal(false);
  }

  // ---------------------------------------------------------- 2. BOOT SEQUENCE

  function runBootSequence() {
    const logs = bootSeq.querySelectorAll('.log');
    let delay = 0;
    logs.forEach((line) => {
      setTimeout(() => { line.style.opacity = 1; }, delay);
      delay += 500;
    });
    setTimeout(() => {
      hide(bootSeq);
      show(feed);
      checkPersistence();
    }, delay + 1000);
  }

  // ------------------------------------------------------------ 3. DESIGNATION

  function cleanName(raw) {
    let name = String(raw || '');
    if (name.normalize) name = name.normalize('NFKC');
    name = name.split(/\s+/).filter(Boolean).join(' ');
    if (!name) return { error: 'Designation cannot be empty.' };
    if ([...name].length > NAME_MAX) {
      return { error: 'Designation must be at most ' + NAME_MAX + ' characters.' };
    }
    try {
      if (!/^[\p{L}\p{N}\p{M} \-_.']+$/u.test(name)) {
        return { error: "Designation may only use letters, numbers, spaces and - _ . '" };
      }
      if (!/[\p{L}\p{N}]/u.test(name)) {
        return { error: 'Designation needs at least one letter or number.' };
      }
    } catch (e) { /* very old browsers: let the server validate */ }
    return { name };
  }

  function setError(message) {
    if (nameError) {
      nameError.textContent = message || '';
      nameError.style.display = message ? '' : 'none';
    }
    if (nameInput) nameInput.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function showWelcome(name) {
    if (displayName) displayName.textContent = name.toUpperCase();
    hide(nameEntryBlock);
    show(postLogin);
  }

  function showNameEntry(prefill) {
    hide(postLogin);
    show(nameEntryBlock);
    setError('');
    if (nameInput) {
      nameInput.disabled = false;
      nameInput.value = prefill || '';
      nameInput.focus();
    }
  }

  function checkPersistence() {
    const savedName = storage.get(KEYS.name);
    if (!savedName) {
      if (nameInput) nameInput.focus();
      return;
    }
    showWelcome(savedName);
    syncBridge(savedName);
  }

  // Make sure the server knows this bridge; re-register if its record is gone.
  function syncBridge(savedName) {
    if (!api) return;
    api.available().then((up) => {
      if (!up) return;
      const token = storage.get(KEYS.bridge);
      const register = () => api.register(savedName, null, storage.get(KEYS.visitor))
        .then((d) => { storage.set(KEYS.bridge, d.token); })
        .catch(() => { /* stay local */ });
      if (!token) return register();
      return api.me(token).catch((err) => {
        if (err.status === 404 || err.status === 400) {
          storage.remove(KEYS.bridge);
          return register();
        }
      });
    });
  }

  async function submitName() {
    if (submitting || !nameInput) return;
    const result = cleanName(nameInput.value);
    if (result.error) { setError(result.error); return; }

    submitting = true;
    nameInput.disabled = true;
    setError('');
    let finalName = result.name;
    try {
      if (api && await api.available()) {
        const d = await api.register(result.name, storage.get(KEYS.bridge), storage.get(KEYS.visitor));
        storage.set(KEYS.bridge, d.token);
        finalName = d.bridge.name;
      }
    } catch (err) {
      if (err.status === 422 || err.status === 400) {
        setError(err.message);
        submitting = false;
        nameInput.disabled = false;
        nameInput.focus();
        return;
      }
      if (err.status === 429) {
        setError('Too many attempts. Wait a moment and try again.');
        submitting = false;
        nameInput.disabled = false;
        return;
      }
      // Network or server error: carry on offline, sync on a later visit.
    }
    storage.set(KEYS.name, finalName);
    submitting = false;
    showWelcome(finalName);
    loadStats();
  }

  if (nameInput) {
    nameInput.setAttribute('maxlength', String(NAME_MAX * 2)); // room for NFKC collapsing
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        submitName();
      }
    });
    nameInput.addEventListener('input', () => setError(''));
  }

  if (changeBtn) {
    changeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showNameEntry(storage.get(KEYS.name) || '');
    });
  }

  if (forgetBtn) {
    forgetBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!window.confirm('Forget your designation on this device and on the server?')) return;
      const token = storage.get(KEYS.bridge);
      if (api && token) {
        try { await api.forget(token); } catch (err) { /* already gone or offline */ }
      }
      storage.remove(KEYS.bridge);
      storage.remove(KEYS.name);
      showNameEntry('');
      loadStats();
    });
  }

  // ------------------------------------------------------ 4. LIVE STATS

  function renderCountdown(info) {
    if (!countdown) return;
    if (info.passed) {
      countdown.textContent = '0 // PASSED ' + info.days_since + ' DAYS AGO';
    } else {
      countdown.textContent = String(info.days_remaining);
    }
  }

  function localCountdown() {
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const remaining = Math.round((APPROACH - today) / DAY_MS);
    return {
      days_remaining: Math.max(remaining, 0),
      passed: remaining < 0,
      days_since: Math.max(-remaining, 0),
      mission_day: Math.round((today - DAY_ONE) / DAY_MS) + 1
    };
  }

  function githubForks() {
    return fetch('https://api.github.com/repos/' + GITHUB_REPO)
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => {
        if (typeof d.forks_count !== 'number') throw new Error('no forks_count');
        return d.forks_count;
      });
  }

  async function loadStats() {
    if (statsLoading) return;
    statsLoading = true;
    renderCountdown(localCountdown());
    try {
      if (api && await api.available()) {
        const s = await api.stats();
        renderCountdown(s.countdown);
        if (forkCount) {
          if (s.forks && typeof s.forks.count === 'number') {
            forkCount.textContent = String(s.forks.count);
          } else {
            // Server could not reach GitHub; the browser may still be able to.
            try { forkCount.textContent = String(await githubForks()); }
            catch (e) { forkCount.textContent = 'OFFLINE'; }
          }
        }
        return;
      }
      if (forkCount) {
        try { forkCount.textContent = String(await githubForks()); }
        catch (e) { forkCount.textContent = 'OFFLINE'; }
      }
    } catch (e) {
      if (forkCount) {
        try { forkCount.textContent = String(await githubForks()); }
        catch (e2) { forkCount.textContent = 'OFFLINE'; }
      }
    } finally {
      statsLoading = false;
    }
  }
});
