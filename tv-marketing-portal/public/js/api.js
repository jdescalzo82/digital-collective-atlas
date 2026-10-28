// Thin fetch wrapper plus cached reference data (dropdowns, lookups, current user).
export const state = { me: null, meta: null, lookup: null };

export async function api(method, url, body) {
  // Relative to the page's <base href>, so the portal works under a sub-path like /ProjectPanes/.
  const res = await fetch(`api${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
export const get = (url) => api('GET', url);
export const post = (url, body = {}) => api('POST', url, body);
export const patch = (url, body = {}) => api('PATCH', url, body);
export const del = (url) => api('DELETE', url);

export async function loadMeta() { state.meta = await get('/meta'); return state.meta; }
export async function loadLookup() { state.lookup = await get('/lookup'); return state.lookup; }
export async function loadMe() { state.me = await get('/me'); return state.me; }

export function can(perm) {
  const p = state.me?.permissions || [];
  return p.includes('admin') || p.includes(perm);
}
export const opts = (category) => (state.meta?.options?.[category] || []).map((o) => o.value);
export const personName = (id) => state.lookup?.personnel.find((p) => p.id === Number(id))?.name || '';
export const clientName = (id) => state.lookup?.clients.find((c) => c.id === Number(id))?.name || '';
