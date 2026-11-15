/*
 * BACKEND CLIENT // DIGITAL COLLECTIVE ATLAS
 *
 * Where the backend lives:
 *   null  — auto: use the same origin, except on *.github.io (static
 *           hosting, no backend) where the site runs in offline mode.
 *   ''    — always the same origin.
 *   'https://api.example.com' — a separately hosted backend
 *           (add this site's origin to DCA_ALLOWED_ORIGINS on the server).
 *
 * Every caller must cope with the backend being unreachable: the site has to
 * keep working as a plain static site.
 */
window.DCA_API_BASE = null;

(function () {
  const TIMEOUT_MS = 6000;

  function base() {
    const configured = window.DCA_API_BASE;
    if (typeof configured === 'string') return configured.replace(/\/+$/, '');
    if (location.protocol === 'file:') return null;
    if (/\.github\.io$/i.test(location.hostname)) return null;
    return '';
  }

  // localStorage throws in some private-browsing modes; never let that break the page.
  const storage = {
    get(key) {
      try { return window.localStorage.getItem(key); } catch (e) { return null; }
    },
    set(key, value) {
      try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
    },
    remove(key) {
      try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
    }
  };

  class ApiError extends Error {
    constructor(status, code, message, field) {
      super(message || 'Request failed');
      this.status = status;
      this.code = code || 'error';
      this.field = field;
    }
  }

  async function request(method, path, options) {
    const root = base();
    if (root === null) throw new ApiError(0, 'offline', 'Backend not configured');
    const opts = options || {};
    const headers = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
    let resp;
    try {
      resp = await fetch(root + path, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller ? controller.signal : undefined,
        credentials: 'omit'
      });
    } catch (e) {
      throw new ApiError(0, 'network', 'Backend unreachable');
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (resp.status === 204) return null;
    let data = null;
    try { data = await resp.json(); } catch (e) { /* non-JSON body */ }
    if (!resp.ok) {
      const err = (data && data.error) || {};
      throw new ApiError(resp.status, err.code, err.message || ('HTTP ' + resp.status), err.field);
    }
    if (data === null) throw new ApiError(resp.status, 'bad_response', 'Unexpected response');
    return data;
  }

  let healthPromise = null;
  function available() {
    if (!healthPromise) {
      healthPromise = request('GET', '/api/health')
        .then((d) => !!d && d.status === 'ok')
        .catch(() => false);
    }
    return healthPromise;
  }

  window.DCA = window.DCA || {};
  window.DCA.storage = storage;
  window.DCA.ApiError = ApiError;
  window.DCA.api = {
    base,
    available,
    request,
    stats: () => request('GET', '/api/stats'),
    consent: (token) => request('POST', '/api/consent', { body: token ? { token } : {} }),
    register: (name, bridgeToken, visitorToken) => request('POST', '/api/bridges', {
      body: visitorToken ? { name, visitor_token: visitorToken } : { name },
      token: bridgeToken
    }),
    me: (token) => request('GET', '/api/bridges/me', { token }),
    forget: (token) => request('DELETE', '/api/bridges/me', { token }),
    downloadUrl: () => (base() === null ? null : base() + '/api/download')
  };
})();
