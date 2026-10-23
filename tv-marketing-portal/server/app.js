import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { helpers } from './db.js';
import { createServices, HttpError, checkPassword, hashPassword, addDays } from './services.js';
import {
  BOARDS, FINISHING_TRACK_STATUSES, PROJECT_STATUSES, HR_STATUSES, IT_STATUSES, MESSAGE_KINDS,
  REVIEW_STATUSES, PERMISSIONS,
} from './workflow.js';
import { parseImport, IMPORT_FIELDS, aiAvailable } from './importer.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DAYS = 14;
const pname = (a) => `trim(coalesce(${a}.first_name,'') || ' ' || coalesce(${a}.last_name,''))`;
const SECONDS = (where) => `(SELECT CAST(COALESCE(SUM((julianday(COALESCE(te.ended_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))) - julianday(te.started_at)) * 86400), 0) AS INTEGER) FROM time_entries te WHERE ${where})`;

export function createApp(db) {
  const h = helpers(db);
  const svc = createServices(h);
  const app = express();
  app.use(express.json({ limit: '30mb' }));

  // ---------- auth ----------
  const cookie = (req, name) => {
    const m = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
    return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
  };
  app.use((req, _res, next) => {
    const token = cookie(req, 'sid') || req.headers['x-session'];
    if (token) {
      const row = h.get(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1`, token);
      if (row) req.user = row;
    }
    next();
  });
  const auth = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please sign in')));
  const need = (...perms) => (req, _res, next) => (
    perms.some((p) => svc.can(req.user, p)) ? next() : next(new HttpError(403, 'You do not have access to this'))
  );
  const fin = (req) => svc.can(req.user, 'view_financials');
  const seesPay = (req) => svc.can(req.user, 'hr') || fin(req);
  const seesTimecards = (req) => svc.can(req.user, 'timecards') || svc.can(req.user, 'hr') || fin(req);

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    const u = h.get('SELECT * FROM users WHERE username = ? AND active = 1', username || '');
    if (!u || !checkPassword(password || '', u.password_hash)) throw new HttpError(401, 'Wrong username or password');
    const token = crypto.randomBytes(24).toString('hex');
    h.run(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?, datetime('now', '+${SESSION_DAYS} days'))`, token, u.id);
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${req.secure ? '; Secure' : ''}`);
    res.json({ ok: true, token });
  });
  app.post('/api/logout', (req, res) => {
    const token = cookie(req, 'sid');
    if (token) h.run('DELETE FROM sessions WHERE token = ?', token);
    res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  app.use('/api', (req, res, next) => (req.path === '/login' ? next() : auth(req, res, next)));

  app.get('/api/me', (req, res) => {
    const u = req.user;
    res.json({
      id: u.id, username: u.username, display_name: u.display_name, role: u.role, personnel_id: u.personnel_id,
      permissions: [...svc.userPerms(u)],
      unread: h.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0', u.id).n,
    });
  });
  app.post('/api/me/password', (req, res) => {
    const { current, next: pw } = req.body || {};
    if (!checkPassword(current || '', req.user.password_hash)) throw new HttpError(400, 'Current password is wrong');
    if (!pw || pw.length < 8) throw new HttpError(400, 'New password needs at least 8 characters');
    h.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(pw), req.user.id);
    res.json({ ok: true });
  });

  // ---------- meta / dropdowns ----------
  app.get('/api/meta', (_req, res) => {
    const options = {};
    for (const o of h.all('SELECT * FROM options WHERE active = 1 ORDER BY category, sort, value')) {
      (options[o.category] ||= []).push({ id: o.id, value: o.value, code: o.code });
    }
    res.json({
      boards: BOARDS, finishingTrackStatuses: FINISHING_TRACK_STATUSES, projectStatuses: PROJECT_STATUSES,
      hrStatuses: HR_STATUSES, itStatuses: IT_STATUSES, messageKinds: MESSAGE_KINDS, reviewStatuses: REVIEW_STATUSES,
      permissions: PERMISSIONS, importFields: IMPORT_FIELDS, aiImport: aiAvailable(), options,
    });
  });
  app.get('/api/options', need('admin'), (_req, res) => res.json(h.all('SELECT * FROM options ORDER BY category, sort, value')));
  app.post('/api/options', need('admin'), (req, res) => {
    const { category, value, code } = req.body || {};
    if (!category || !value?.trim()) throw new HttpError(400, 'Category and value are required');
    const sort = (h.get('SELECT MAX(sort) AS s FROM options WHERE category = ?', category)?.s ?? 0) + 1;
    try {
      const r = h.run('INSERT INTO options (category, value, code, sort) VALUES (?,?,?,?)', category, value.trim(), code?.trim().toUpperCase() || null, sort);
      res.json(h.get('SELECT * FROM options WHERE id = ?', r.lastInsertRowid));
    } catch { throw new HttpError(400, 'That option already exists'); }
  });
  app.patch('/api/options/:id', need('admin'), (req, res) => {
    const o = h.get('SELECT * FROM options WHERE id = ?', req.params.id);
    if (!o) throw new HttpError(404, 'Not found');
    const { value = o.value, code = o.code, active = o.active, sort = o.sort } = req.body || {};
    h.run('UPDATE options SET value = ?, code = ?, active = ?, sort = ? WHERE id = ?', value, code ? String(code).toUpperCase() : null, active ? 1 : 0, sort, o.id);
    res.json(h.get('SELECT * FROM options WHERE id = ?', o.id));
  });

  // ---------- users ----------
  app.get('/api/users', need('admin'), (_req, res) => {
    res.json(h.all(`SELECT u.id, u.username, u.display_name, u.role, u.permissions, u.personnel_id, u.active,
      ${pname('p')} AS personnel_name FROM users u LEFT JOIN personnel p ON p.id = u.personnel_id ORDER BY u.display_name`));
  });
  app.post('/api/users', need('admin'), (req, res) => {
    const { username, display_name, password, role, permissions = [], personnel_id } = req.body || {};
    if (!username || !display_name || !password) throw new HttpError(400, 'Username, name and password are required');
    try {
      const r = h.run('INSERT INTO users (username, display_name, password_hash, role, permissions, personnel_id) VALUES (?,?,?,?,?,?)',
        username, display_name, hashPassword(password), role || 'Staff', permissions.join(','), personnel_id || null);
      res.json({ id: Number(r.lastInsertRowid) });
    } catch { throw new HttpError(400, 'That username is taken'); }
  });
  app.patch('/api/users/:id', need('admin'), (req, res) => {
    const u = h.get('SELECT * FROM users WHERE id = ?', req.params.id);
    if (!u) throw new HttpError(404, 'Not found');
    const b = req.body || {};
    h.run('UPDATE users SET display_name = ?, role = ?, permissions = ?, personnel_id = ?, active = ? WHERE id = ?',
      b.display_name ?? u.display_name, b.role ?? u.role, Array.isArray(b.permissions) ? b.permissions.join(',') : u.permissions,
      b.personnel_id === undefined ? u.personnel_id : (b.personnel_id || null), b.active === undefined ? u.active : (b.active ? 1 : 0), u.id);
    if (b.password) h.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(b.password), u.id);
    if (b.active === false) h.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    res.json({ ok: true });
  });

  // ---------- lookup data for dropdowns and tagging ----------
  app.get('/api/lookup', (_req, res) => {
    res.json({
      personnel: h.all(`SELECT id, ${pname('personnel')} AS name, title, department, employment_type FROM personnel WHERE active = 1 ORDER BY first_name, last_name`),
      clients: h.all('SELECT id, name, billing_prefix FROM clients WHERE active = 1 ORDER BY name'),
      projects: h.all(`SELECT p.id, p.project_number, p.official_name, p.code_name, p.client_id, p.status, p.producer_id, c.name AS client_name
        FROM projects p JOIN clients c ON c.id = p.client_id ORDER BY p.official_name`),
      accounts: h.all('SELECT id, billing_code, project_id, department, status, lead_producer_id FROM accounts ORDER BY billing_code'),
      media: h.all('SELECT id, item_number, name, media_type, project_id FROM media ORDER BY item_number'),
      equipment: h.all('SELECT id, item_number, name, equipment_type, assigned_to FROM equipment ORDER BY item_number'),
    });
  });

  // ---------- generic CRUD helpers ----------
  const clean = (body, fields) => {
    const out = {};
    for (const f of fields) if (f in body) out[f] = body[f] === '' ? null : body[f];
    return out;
  };
  const insert = (table, data) => {
    const keys = Object.keys(data);
    if (!keys.length) throw new HttpError(400, 'Nothing to save');
    return Number(h.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...Object.values(data)).lastInsertRowid);
  };
  const update = (table, id, data, touch = true) => {
    const keys = Object.keys(data);
    if (!keys.length) return;
    h.run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')}${touch ? ", updated_at = datetime('now')" : ''} WHERE id = ?`, ...Object.values(data), id);
  };
  const uniqueError = (e, msg) => { if (String(e.message).includes('UNIQUE')) throw new HttpError(400, msg); throw e; };

  // ---------- personnel ----------
  const PERSONNEL_FIELDS = ['first_name', 'last_name', 'email', 'phone', 'mobile', 'address', 'city', 'state', 'zip',
    'emergency_name', 'emergency_phone', 'title', 'position', 'department', 'employment_type', 'rate', 'rate_frequency',
    'start_date', 'end_date', 'equipment_needed', 'notes'];
  const stripPay = (req, row) => { if (row && !seesPay(req)) { delete row.rate; delete row.rate_frequency; } return row; };
  const setPersonProjects = (pid, ids) => {
    if (!Array.isArray(ids)) return;
    h.run('DELETE FROM personnel_projects WHERE personnel_id = ?', pid);
    for (const id of new Set(ids.map(Number).filter(Boolean))) h.run('INSERT INTO personnel_projects VALUES (?,?)', pid, id);
  };

  app.get('/api/personnel', (req, res) => {
    const { q, department, employment_type, hr_status, include_inactive } = req.query;
    const rows = h.all(`SELECT p.*, (SELECT group_concat(pr.official_name, ', ') FROM personnel_projects pp JOIN projects pr ON pr.id = pp.project_id WHERE pp.personnel_id = p.id) AS project_names
      FROM personnel p ORDER BY p.first_name, p.last_name`)
      .filter((p) => (include_inactive ? true : p.active))
      .filter((p) => !department || p.department === department)
      .filter((p) => !employment_type || p.employment_type === employment_type)
      .filter((p) => !hr_status || p.hr_status === hr_status)
      .filter((p) => !q || `${p.first_name} ${p.last_name} ${p.email} ${p.title}`.toLowerCase().includes(String(q).toLowerCase()));
    res.json(rows.map((r) => stripPay(req, r)));
  });
  app.get('/api/personnel/:id', (req, res) => {
    const p = h.get('SELECT * FROM personnel WHERE id = ?', req.params.id);
    if (!p) throw new HttpError(404, 'Not found');
    p.project_ids = h.all('SELECT project_id FROM personnel_projects WHERE personnel_id = ?', p.id).map((r) => r.project_id);
    p.equipment = h.all('SELECT id, item_number, name, equipment_type FROM equipment WHERE assigned_to = ?', p.id);
    p.tickets = h.all(`SELECT t.id, t.ticket_number, t.title, t.status, t.board FROM tickets t
      WHERE t.assignee_id = ? AND t.status NOT IN ('Completed','Cancelled','Archived') ORDER BY t.updated_at DESC`, p.id);
    p.hours_logged = Math.round(h.get(`SELECT ${SECONDS('te.personnel_id = ?')} AS s`, p.id).s / 36) / 100;
    res.json(stripPay(req, p));
  });
  app.post('/api/personnel', need('onboarding', 'hr'), (req, res) => {
    const data = clean(req.body, PERSONNEL_FIELDS);
    if (!data.first_name) throw new HttpError(400, 'First name is required');
    if (!seesPay(req)) { delete data.rate; delete data.rate_frequency; }
    const id = insert('personnel', data);
    setPersonProjects(id, req.body.project_ids);
    const hr = h.all('SELECT id, permissions FROM users WHERE active = 1').filter((u) => svc.can(u, 'hr')).map((u) => u.id);
    svc.notifyUsers(hr, null, `New personnel record to verify: ${data.first_name} ${data.last_name || ''}`.trim());
    res.json({ id });
  });
  app.patch('/api/personnel/:id', need('onboarding', 'hr'), (req, res) => {
    const data = clean(req.body, [...PERSONNEL_FIELDS, 'active']);
    if (!seesPay(req)) { delete data.rate; delete data.rate_frequency; }
    update('personnel', req.params.id, data);
    setPersonProjects(Number(req.params.id), req.body.project_ids);
    res.json({ ok: true });
  });

  // HR: verify data, confirm dates, then release to IT (without pay).
  app.patch('/api/personnel/:id/hr', need('hr'), (req, res) => {
    const p = h.get('SELECT * FROM personnel WHERE id = ?', req.params.id);
    if (!p) throw new HttpError(404, 'Not found');
    const data = clean(req.body, ['hr_status', 'hr_notes', 'start_date', 'end_date', 'rate', 'rate_frequency', 'employment_type']);
    if (data.hr_status && !HR_STATUSES.includes(data.hr_status)) throw new HttpError(400, 'Unknown HR status');
    if (data.hr_status && data.hr_status !== 'Pending Review' && p.hr_status === 'Pending Review') {
      data.hr_verified_by = req.user.id; data.hr_verified_at = new Date().toISOString();
    }
    if (data.hr_status === 'Sent to IT') {
      if (!(data.start_date || p.start_date)) throw new HttpError(400, 'Confirm a start date before sending to IT');
      if (p.it_status === 'Waiting on HR') data.it_status = 'Not Started';
      const it = h.all('SELECT id, permissions FROM users WHERE active = 1').filter((u) => svc.can(u, 'it')).map((u) => u.id);
      svc.notifyUsers(it, null, `Setup needed for ${p.first_name} ${p.last_name} (starts ${data.start_date || p.start_date})`);
    }
    update('personnel', p.id, data);
    res.json({ ok: true });
  });
  app.get('/api/it/personnel', need('it'), (_req, res) => {
    const rows = h.all(`SELECT p.*, (SELECT group_concat(pr.official_name, ', ') FROM personnel_projects pp JOIN projects pr ON pr.id = pp.project_id WHERE pp.personnel_id = p.id) AS project_names,
      (SELECT group_concat(e.item_number || ' ' || e.name, ', ') FROM equipment e WHERE e.assigned_to = p.id) AS assigned_equipment
      FROM personnel p WHERE p.active = 1 AND p.it_status != 'Waiting on HR' ORDER BY p.start_date`);
    res.json(rows.map((r) => { delete r.rate; delete r.rate_frequency; delete r.hr_notes; return r; }));
  });
  app.patch('/api/personnel/:id/it', need('it'), (req, res) => {
    const data = clean(req.body, ['it_status', 'it_system', 'it_software', 'it_hardware', 'workstation_location', 'it_accounts', 'it_notes']);
    if (data.it_status && !IT_STATUSES.includes(data.it_status)) throw new HttpError(400, 'Unknown IT status');
    update('personnel', req.params.id, data);
    res.json({ ok: true });
  });

  // ---------- clients ----------
  const CLIENT_FIELDS = ['name', 'billing_prefix', 'poc_name', 'poc_title', 'poc_email', 'poc_phone', 'department', 'sector',
    'acct_name', 'acct_email', 'acct_phone', 'birthday', 'notes'];
  app.get('/api/clients', (req, res) => {
    const { q, sector } = req.query;
    res.json(h.all(`SELECT c.*, (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id) AS project_count,
      (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id AND p.status = 'Active') AS active_projects
      FROM clients c WHERE c.active = 1 ORDER BY c.name`)
      .filter((c) => !sector || c.sector === sector)
      .filter((c) => !q || `${c.name} ${c.poc_name} ${c.billing_prefix}`.toLowerCase().includes(String(q).toLowerCase())));
  });
  app.get('/api/clients/:id', (req, res) => {
    const c = h.get('SELECT * FROM clients WHERE id = ?', req.params.id);
    if (!c) throw new HttpError(404, 'Not found');
    // Cumulative history of everything done with this client.
    c.projects = h.all(`SELECT p.id, p.project_number, p.official_name, p.code_name, p.status, p.est_start, p.est_delivery, p.scope,
      p.budget, p.est_cost, ${pname('pr')} AS producer_name,
      (SELECT COUNT(*) FROM tickets t WHERE t.project_id = p.id) AS ticket_count,
      ${SECONDS('te.ticket_id IN (SELECT id FROM tickets t WHERE t.project_id = p.id)')} AS seconds
      FROM projects p LEFT JOIN personnel pr ON pr.id = p.producer_id WHERE p.client_id = ? ORDER BY p.est_start DESC, p.id DESC`, c.id);
    c.totals = {
      projects: c.projects.length,
      tickets: c.projects.reduce((s, p) => s + p.ticket_count, 0),
      hours: Math.round(c.projects.reduce((s, p) => s + p.seconds, 0) / 36) / 100,
    };
    if (fin(req)) c.totals.budget = c.projects.reduce((s, p) => s + (p.budget || 0), 0);
    else c.projects.forEach((p) => { delete p.budget; delete p.est_cost; });
    c.accounts = h.all('SELECT a.id, a.billing_code, a.status, a.department, p.official_name FROM accounts a JOIN projects p ON p.id = a.project_id WHERE p.client_id = ? ORDER BY a.billing_code', c.id);
    res.json(c);
  });
  app.post('/api/clients', need('onboarding'), (req, res) => {
    const data = clean(req.body, CLIENT_FIELDS);
    if (!data.name || !data.billing_prefix) throw new HttpError(400, 'Name and billing prefix are required');
    data.billing_prefix = String(data.billing_prefix).toUpperCase().replace(/[^A-Z0-9]/g, '');
    try { res.json({ id: insert('clients', data) }); } catch (e) { uniqueError(e, 'A client with that name or billing prefix already exists'); }
  });
  app.patch('/api/clients/:id', need('onboarding'), (req, res) => {
    const data = clean(req.body, [...CLIENT_FIELDS, 'active']);
    if (data.billing_prefix) data.billing_prefix = String(data.billing_prefix).toUpperCase().replace(/[^A-Z0-9]/g, '');
    try { update('clients', req.params.id, data); } catch (e) { uniqueError(e, 'A client with that name or billing prefix already exists'); }
    res.json({ ok: true });
  });

  // ---------- projects ----------
  const PROJECT_FIELDS = ['official_name', 'code_name', 'client_id', 'est_start', 'est_lock', 'est_delivery', 'budget', 'est_cost', 'producer_id', 'scope', 'notes'];
  const projectOut = (req, p) => {
    if (!p) return p;
    p.scope = JSON.parse(p.scope || '[]');
    if (fin(req)) p.differential = p.budget != null && p.est_cost != null ? p.budget - p.est_cost : null;
    else { delete p.budget; delete p.est_cost; }
    return p;
  };
  const PROJECT_SELECT = `SELECT p.*, c.name AS client_name, c.billing_prefix, ${pname('pr')} AS producer_name,
    (SELECT COUNT(*) FROM tickets t WHERE t.project_id = p.id AND t.status NOT IN ('Completed','Cancelled','Archived','Shipped')) AS open_tickets
    FROM projects p JOIN clients c ON c.id = p.client_id LEFT JOIN personnel pr ON pr.id = p.producer_id`;
  app.get('/api/projects', (req, res) => {
    const { q, client_id, status, scope } = req.query;
    res.json(h.all(`${PROJECT_SELECT} ORDER BY p.est_start DESC, p.id DESC`)
      .filter((p) => !client_id || p.client_id === Number(client_id))
      .filter((p) => !status || p.status === status)
      .filter((p) => !scope || JSON.parse(p.scope || '[]').includes(scope))
      .filter((p) => !q || `${p.official_name} ${p.code_name} ${p.project_number} ${p.client_name}`.toLowerCase().includes(String(q).toLowerCase()))
      .map((p) => projectOut(req, p)));
  });
  app.get('/api/projects/:id', (req, res) => {
    const p = projectOut(req, h.get(`${PROJECT_SELECT} WHERE p.id = ?`, req.params.id));
    if (!p) throw new HttpError(404, 'Not found');
    p.accounts = h.all(`SELECT a.*, ${pname('lp')} AS lead_producer_name FROM accounts a LEFT JOIN personnel lp ON lp.id = a.lead_producer_id WHERE a.project_id = ? ORDER BY a.billing_code`, p.id);
    p.tickets = h.all(`SELECT t.id, t.ticket_number, t.title, t.board, t.status, ${pname('pa')} AS assignee_name, ${SECONDS('te.ticket_id = t.id')} AS seconds
      FROM tickets t LEFT JOIN personnel pa ON pa.id = t.assignee_id WHERE t.project_id = ? ORDER BY t.id DESC`, p.id);
    p.personnel = h.all(`SELECT pe.id, ${pname('pe')} AS name, pe.title, pe.department FROM personnel_projects pp JOIN personnel pe ON pe.id = pp.personnel_id WHERE pp.project_id = ?`, p.id);
    p.media = h.all('SELECT id, item_number, name, media_type FROM media WHERE project_id = ?', p.id);
    p.hours = Math.round(p.tickets.reduce((s, t) => s + t.seconds, 0) / 36) / 100;
    res.json(p);
  });
  app.post('/api/projects', need('onboarding'), (req, res) => {
    const data = clean(req.body, PROJECT_FIELDS);
    if (!data.official_name || !data.client_id) throw new HttpError(400, 'Official name and client are required');
    if (!fin(req)) { delete data.budget; delete data.est_cost; }
    data.scope = JSON.stringify(Array.isArray(req.body.scope) ? req.body.scope : []);
    data.project_number = svc.nextProjectNumber();
    const id = insert('projects', data);
    res.json({ id, project_number: data.project_number });
  });
  app.patch('/api/projects/:id', need('onboarding'), (req, res) => {
    const data = clean(req.body, PROJECT_FIELDS);
    if (!fin(req)) { delete data.budget; delete data.est_cost; }
    if ('scope' in req.body) data.scope = JSON.stringify(Array.isArray(req.body.scope) ? req.body.scope : []);
    update('projects', req.params.id, data);
    res.json({ ok: true });
  });
  app.post('/api/projects/:id/status', need('onboarding'), (req, res) => {
    const { status, reason } = req.body || {};
    if (!PROJECT_STATUSES.includes(status)) throw new HttpError(400, 'Unknown project status');
    if (['Killed', 'Cancelled'].includes(status) && !reason?.trim()) throw new HttpError(400, 'Give a reason for cancelling or killing a project');
    res.json(svc.setProjectStatus(Number(req.params.id), status, reason, req.user));
  });

  // ---------- accounts (billing numbers) ----------
  app.get('/api/accounts', (req, res) => {
    const { q, client_id, project_id, department, status, lead_producer_id } = req.query;
    res.json(h.all(`SELECT a.*, p.project_number, p.official_name, p.code_name, p.status AS project_status, p.client_id, c.name AS client_name,
      ${pname('lp')} AS lead_producer_name,
      (SELECT COUNT(*) FROM tickets t WHERE t.account_id = a.id) AS ticket_count,
      ${SECONDS('te.ticket_id IN (SELECT id FROM tickets t WHERE t.account_id = a.id)')} AS seconds
      FROM accounts a JOIN projects p ON p.id = a.project_id JOIN clients c ON c.id = p.client_id
      LEFT JOIN personnel lp ON lp.id = a.lead_producer_id ORDER BY a.billing_code`)
      .filter((a) => !client_id || a.client_id === Number(client_id))
      .filter((a) => !project_id || a.project_id === Number(project_id))
      .filter((a) => !department || a.department === department)
      .filter((a) => !status || a.status === status)
      .filter((a) => !lead_producer_id || a.lead_producer_id === Number(lead_producer_id))
      .filter((a) => !q || `${a.billing_code} ${a.official_name} ${a.code_name} ${a.client_name} ${a.project_number}`.toLowerCase().includes(String(q).toLowerCase())));
  });
  app.post('/api/accounts', need('onboarding'), (req, res) => res.json(svc.createAccount(req.body || {}, req.user)));
  app.patch('/api/accounts/:id', need('onboarding'), (req, res) => {
    const data = clean(req.body, ['lead_producer_id', 'description', 'status']);
    if (data.status && !['Open', 'Closed', 'Killed'].includes(data.status)) throw new HttpError(400, 'Unknown account status');
    update('accounts', req.params.id, data, false);
    res.json({ ok: true });
  });

  // ---------- physical media & equipment ----------
  const MEDIA_FIELDS = ['item_number', 'name', 'media_type', 'project_id', 'location', 'notes'];
  const EQUIP_FIELDS = ['item_number', 'name', 'equipment_type', 'model', 'year', 'model_number', 'serial_number', 'specs', 'assigned_to', 'notes'];
  app.get('/api/media', (req, res) => {
    const { q, project_id, media_type } = req.query;
    res.json(h.all(`SELECT m.*, p.official_name AS project_name, p.project_number,
      (SELECT group_concat(t.ticket_number, ', ') FROM ticket_media tm JOIN tickets t ON t.id = tm.ticket_id WHERE tm.media_id = m.id) AS ticket_numbers
      FROM media m LEFT JOIN projects p ON p.id = m.project_id ORDER BY m.item_number`)
      .filter((m) => !project_id || m.project_id === Number(project_id))
      .filter((m) => !media_type || m.media_type === media_type)
      .filter((m) => !q || `${m.item_number} ${m.name} ${m.project_name}`.toLowerCase().includes(String(q).toLowerCase())));
  });
  app.get('/api/media/:id', (req, res) => {
    const m = h.get('SELECT m.*, p.official_name AS project_name FROM media m LEFT JOIN projects p ON p.id = m.project_id WHERE m.id = ?', req.params.id);
    if (!m) throw new HttpError(404, 'Not found');
    m.tickets = h.all('SELECT t.id, t.ticket_number, t.title, t.status, t.board FROM ticket_media tm JOIN tickets t ON t.id = tm.ticket_id WHERE tm.media_id = ?', m.id);
    m.ticket_ids = m.tickets.map((t) => t.id);
    res.json(m);
  });
  const saveMedia = (req, id) => {
    const data = clean(req.body, MEDIA_FIELDS);
    if (!id) {
      if (!data.name) throw new HttpError(400, 'Name is required');
      data.item_number = data.item_number?.trim() || svc.nextItemNumber('media', 'MED');
    }
    try {
      if (id) update('media', id, data, false); else id = insert('media', data);
    } catch (e) { uniqueError(e, 'That item number is already in use'); }
    if (Array.isArray(req.body.ticket_ids)) {
      h.run('DELETE FROM ticket_media WHERE media_id = ?', id);
      for (const t of new Set(req.body.ticket_ids.map(Number).filter(Boolean))) h.run('INSERT INTO ticket_media (ticket_id, media_id) VALUES (?,?)', t, id);
    }
    return id;
  };
  app.post('/api/media', need('onboarding'), (req, res) => res.json({ id: saveMedia(req) }));
  app.patch('/api/media/:id', need('onboarding'), (req, res) => res.json({ id: saveMedia(req, Number(req.params.id)) }));

  app.get('/api/equipment', (req, res) => {
    const { q, equipment_type, assigned_to } = req.query;
    res.json(h.all(`SELECT e.*, ${pname('p')} AS assigned_name FROM equipment e LEFT JOIN personnel p ON p.id = e.assigned_to ORDER BY e.item_number`)
      .filter((e) => !equipment_type || e.equipment_type === equipment_type)
      .filter((e) => !assigned_to || e.assigned_to === Number(assigned_to))
      .filter((e) => !q || `${e.item_number} ${e.name} ${e.model} ${e.model_number} ${e.assigned_name}`.toLowerCase().includes(String(q).toLowerCase())));
  });
  app.get('/api/equipment/:id', (req, res) => {
    const e = h.get(`SELECT e.*, ${pname('p')} AS assigned_name FROM equipment e LEFT JOIN personnel p ON p.id = e.assigned_to WHERE e.id = ?`, req.params.id);
    if (!e) throw new HttpError(404, 'Not found');
    res.json(e);
  });
  const saveEquipment = (req, id) => {
    const data = clean(req.body, EQUIP_FIELDS);
    if (!id) {
      if (!data.name) throw new HttpError(400, 'Name is required');
      data.item_number = data.item_number?.trim() || svc.nextItemNumber('equipment', 'EQ');
    }
    try {
      if (id) update('equipment', id, data, false); else id = insert('equipment', data);
    } catch (e) { uniqueError(e, 'That item number is already in use'); }
    return id;
  };
  app.post('/api/equipment', need('onboarding', 'it'), (req, res) => res.json({ id: saveEquipment(req) }));
  app.patch('/api/equipment/:id', need('onboarding', 'it'), (req, res) => res.json({ id: saveEquipment(req, Number(req.params.id)) }));

  // Barcode lookup: one scan finds media or equipment.
  app.get('/api/scan/:code', (req, res) => {
    const code = String(req.params.code).trim();
    const m = h.get('SELECT id, name FROM media WHERE item_number = ? COLLATE NOCASE', code);
    if (m) return res.json({ type: 'media', ...m });
    const e = h.get('SELECT id, name FROM equipment WHERE item_number = ? COLLATE NOCASE', code);
    if (e) return res.json({ type: 'equipment', ...e });
    res.json({ type: null, code });
  });

  // ---------- tickets ----------
  const TICKET_SELECT = `SELECT t.*, p.official_name AS project_name, p.code_name, p.project_number, p.status AS project_status,
      c.id AS client_id, c.name AS client_name, a.billing_code,
      ${pname('pa')} AS assignee_name, ${pname('de')} AS desired_editor_name, u.display_name AS requested_by_name,
      (SELECT COUNT(*) FROM time_entries te WHERE te.ticket_id = t.id AND te.ended_at IS NULL) AS running,
      ${SECONDS('te.ticket_id = t.id')} AS seconds,
      f.id AS fin_id, f.ticket_number AS fin_number, f.picture_status AS fin_picture, f.sound_status AS fin_sound
    FROM tickets t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN clients c ON c.id = p.client_id
    LEFT JOIN accounts a ON a.id = t.account_id
    LEFT JOIN personnel pa ON pa.id = t.assignee_id
    LEFT JOIN personnel de ON de.id = t.desired_editor_id
    LEFT JOIN users u ON u.id = t.requested_by
    LEFT JOIN tickets f ON f.id = (SELECT MAX(x.id) FROM tickets x WHERE x.editorial_ticket_id = t.id AND x.board = 'finishing' AND x.status != 'Cancelled')`;
  const withBooking = (t) => {
    if (t.board === 'editorial' && t.start_date && t.final_lock_date) {
      t.booking_start = t.start_date;
      t.booking_end = addDays(t.final_lock_date, BOARDS.editorial.bookingCushionDays);
    }
    return t;
  };

  app.get('/api/tickets', (req, res) => {
    const { board, status, assignee_id, project_id, client_id, mine, q, open, category } = req.query;
    let rows = h.all(`${TICKET_SELECT} ORDER BY t.updated_at DESC`);
    if (board) rows = rows.filter((t) => t.board === board);
    if (status) rows = rows.filter((t) => t.status === status);
    if (category) rows = rows.filter((t) => t.category === category);
    if (assignee_id) rows = rows.filter((t) => t.assignee_id === Number(assignee_id));
    if (project_id) rows = rows.filter((t) => t.project_id === Number(project_id));
    if (client_id) rows = rows.filter((t) => t.client_id === Number(client_id));
    if (open) rows = rows.filter((t) => !['Completed', 'Cancelled', 'Archived'].includes(t.status));
    if (mine) {
      const pid = req.user.personnel_id;
      rows = rows.filter((t) => (pid && [t.assignee_id, t.picture_assignee_id, t.sound_assignee_id].includes(pid)) || t.requested_by === req.user.id);
    }
    if (q) {
      const s = String(q).toLowerCase();
      rows = rows.filter((t) => `${t.ticket_number} ${t.title} ${t.project_name} ${t.code_name} ${t.client_name} ${t.billing_code}`.toLowerCase().includes(s));
    }
    res.json(rows.map(withBooking));
  });

  const tagName = (type, id) => {
    switch (type) {
      case 'personnel': return h.get(`SELECT ${pname('personnel')} AS n FROM personnel WHERE id = ?`, id)?.n;
      case 'client': return h.get('SELECT name AS n FROM clients WHERE id = ?', id)?.n; // only the name, never client details
      case 'media': return h.get("SELECT item_number || ' · ' || name AS n FROM media WHERE id = ?", id)?.n;
      case 'equipment': return h.get("SELECT item_number || ' · ' || name AS n FROM equipment WHERE id = ?", id)?.n;
      default: return null;
    }
  };
  const tagsFor = (col, id) => h.all(`SELECT entity_type, entity_id FROM tags WHERE ${col} = ?${col === 'ticket_id' ? ' AND message_id IS NULL' : ''}`, id)
    .map((t) => ({ ...t, name: tagName(t.entity_type, t.entity_id) || '(removed)' }));

  app.get('/api/tickets/:id', (req, res) => {
    const t = h.get(`${TICKET_SELECT} WHERE t.id = ?`, req.params.id);
    if (!t) throw new HttpError(404, 'Ticket not found');
    withBooking(t);
    t.project = t.project_id ? projectOut(req, h.get(`${PROJECT_SELECT} WHERE p.id = ?`, t.project_id)) : null;
    t.media = h.all('SELECT m.id, m.item_number, m.name, m.media_type FROM ticket_media tm JOIN media m ON m.id = tm.media_id WHERE tm.ticket_id = ?', t.id);
    t.tags = tagsFor('ticket_id', t.id);
    t.messages = h.all(`SELECT m.*, u.display_name AS author_name, su.display_name AS status_by_name FROM messages m
      LEFT JOIN users u ON u.id = m.author_id LEFT JOIN users su ON su.id = m.status_by WHERE m.ticket_id = ? ORDER BY m.id DESC`, t.id)
      .map((m) => ({ ...m, tags: tagsFor('message_id', m.id) }));
    t.time = h.all(`SELECT te.*, ${pname('p')} AS person_name, CAST((julianday(COALESCE(te.ended_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))) - julianday(te.started_at)) * 86400 AS INTEGER) AS seconds
      FROM time_entries te LEFT JOIN personnel p ON p.id = te.personnel_id WHERE te.ticket_id = ? ORDER BY te.started_at DESC`, t.id);
    t.time_editable = { main: svc.canEditTime(t, 'main'), picture: svc.canEditTime(t, 'picture'), sound: svc.canEditTime(t, 'sound') };
    t.history = h.all('SELECT hi.*, u.display_name AS user_name FROM history hi LEFT JOIN users u ON u.id = hi.user_id WHERE hi.ticket_id = ? ORDER BY hi.id DESC', t.id);
    t.parent = t.parent_ticket_id ? h.get('SELECT id, ticket_number, title, status FROM tickets WHERE id = ?', t.parent_ticket_id) : null;
    t.derivatives = h.all('SELECT id, ticket_number, title, status, derivative_type FROM tickets WHERE parent_ticket_id = ? ORDER BY id', t.id);
    t.finishing = h.all(`SELECT f.id, f.ticket_number, f.title, f.status, f.picture_status, f.sound_status, ${pname('pp')} AS picture_artist, ${pname('sp')} AS sound_artist
      FROM tickets f LEFT JOIN personnel pp ON pp.id = f.picture_assignee_id LEFT JOIN personnel sp ON sp.id = f.sound_assignee_id
      WHERE f.editorial_ticket_id = ? ORDER BY f.id`, t.id);
    t.editorial = t.editorial_ticket_id ? h.get('SELECT id, ticket_number, title, status FROM tickets WHERE id = ?', t.editorial_ticket_id) : null;
    if (t.board === 'editorial' && t.booking_start) t.conflicts = scheduleConflicts(t);
    const perms = ticketPerms(req.user, t);
    t.can = perms;
    res.json(t);
  });

  const ticketPerms = (user, t) => {
    const manager = svc.can(user, BOARDS[t.board].manageCategory);
    const pid = user.personnel_id;
    const assignee = pid && [t.assignee_id, t.picture_assignee_id, t.sound_assignee_id].includes(pid);
    return {
      manage: manager,
      status: manager || Boolean(assignee),
      edit: manager || Boolean(assignee) || t.requested_by === user.id,
      time: manager || Boolean(assignee),
    };
  };
  const requireTicketPerm = (req, key) => {
    const t = svc.getTicket(Number(req.params.id));
    if (!ticketPerms(req.user, t)[key]) throw new HttpError(403, 'Only the assignee or a board manager can do that');
    return t;
  };

  function scheduleConflicts(t) {
    const editor = t.assignee_id || t.desired_editor_id;
    if (!editor) return [];
    return h.all(`SELECT id, ticket_number, title, start_date, final_lock_date FROM tickets
      WHERE board = 'editorial' AND id != ? AND COALESCE(assignee_id, desired_editor_id) = ?
      AND status NOT IN ('Draft','Cancelled','Shipped','Ready for Backup','Archived','Final Lock') AND start_date IS NOT NULL AND final_lock_date IS NOT NULL`, t.id, editor)
      .map(withBooking)
      .filter((o) => o.booking_start <= t.booking_end && t.booking_start <= o.booking_end);
  }

  app.post('/api/tickets', (req, res) => {
    const { board, ...data } = req.body || {};
    res.json(svc.createTicket(board, data, req.user));
  });
  app.patch('/api/tickets/:id', (req, res) => {
    const t = requireTicketPerm(req, 'edit');
    const data = { ...req.body };
    if ('assignee_id' in data && !ticketPerms(req.user, t).manage) delete data.assignee_id;
    if (!ticketPerms(req.user, t).manage) { delete data.picture_assignee_id; delete data.sound_assignee_id; }
    res.json(svc.updateTicket(t.id, data, req.user));
  });
  app.post('/api/tickets/:id/assign', (req, res) => {
    const t = requireTicketPerm(req, 'manage');
    res.json(svc.assign(t.id, req.body?.personnel_id || null, req.user));
  });
  app.post('/api/tickets/:id/status', (req, res) => {
    const t = requireTicketPerm(req, 'status');
    res.json(svc.changeStatus(t.id, req.body?.status, req.user, { duration: req.body?.duration }));
  });
  app.post('/api/tickets/:id/track', (req, res) => {
    const t = requireTicketPerm(req, 'status');
    res.json(svc.changeTrackStatus(t.id, req.body?.track, req.body?.status, req.user));
  });
  app.post('/api/tickets/:id/finishing', (req, res) => {
    const t = requireTicketPerm(req, 'edit');
    res.json(svc.requestFinishing(t.id, req.body || {}, req.user));
  });

  // Message board: review links, approvals and notes with a status column.
  app.post('/api/tickets/:id/messages', (req, res) => {
    const t = svc.getTicket(Number(req.params.id));
    const { kind = 'Note', body, link_url, tags = [] } = req.body || {};
    if (!MESSAGE_KINDS.includes(kind)) throw new HttpError(400, 'Unknown message type');
    if (!body?.trim() && !link_url?.trim()) throw new HttpError(400, 'Write something or add a link');
    if (link_url && !/^https?:\/\//i.test(link_url)) throw new HttpError(400, 'Links must start with http:// or https://');
    const review = kind === 'Note' ? null : 'Pending';
    const r = h.run('INSERT INTO messages (ticket_id, author_id, kind, body, link_url, review_status) VALUES (?,?,?,?,?,?)',
      t.id, req.user.id, kind, body || null, link_url || null, review);
    const mid = Number(r.lastInsertRowid);
    const tagged = [];
    for (const tg of tags) {
      if (!tg?.entity_type || !tg?.entity_id) continue;
      h.run('INSERT INTO tags (message_id, entity_type, entity_id) VALUES (?,?,?)', mid, tg.entity_type, Number(tg.entity_id));
      if (tg.entity_type === 'personnel') tagged.push(...h.all('SELECT id FROM users WHERE personnel_id = ? AND active = 1', tg.entity_id).map((u) => u.id));
    }
    svc.notifyUsers(tagged.filter((u) => u !== req.user.id), t.id, `${req.user.display_name} tagged you on ${t.ticket_number}: ${kind}${body ? ` — ${body.slice(0, 80)}` : ''}`);
    svc.log(t.id, req.user.id, 'message', `${kind}${link_url ? ' with link' : ''}`);
    res.json({ id: mid });
  });
  app.patch('/api/messages/:id', (req, res) => {
    const m = h.get('SELECT * FROM messages WHERE id = ?', req.params.id);
    if (!m) throw new HttpError(404, 'Not found');
    const { review_status } = req.body || {};
    if (!REVIEW_STATUSES.includes(review_status)) throw new HttpError(400, 'Unknown review status');
    h.run("UPDATE messages SET review_status = ?, status_by = ?, status_at = datetime('now') WHERE id = ?", review_status, req.user.id, m.id);
    svc.log(m.ticket_id, req.user.id, 'review', `${m.kind} #${m.id} → ${review_status}`);
    if (m.author_id !== req.user.id) {
      const t = svc.getTicket(m.ticket_id);
      svc.notifyUsers([m.author_id], t.id, `${t.ticket_number}: your ${m.kind.toLowerCase()} was marked ${review_status}`);
    }
    res.json({ ok: true });
  });

  // ---------- time entries (manual edits only while the clock is stopped) ----------
  const parseWhen = (v, label) => {
    const d = new Date(v);
    if (!v || Number.isNaN(d.getTime())) throw new HttpError(400, `${label} is not a valid date/time`);
    return d.toISOString();
  };
  app.post('/api/tickets/:id/time', (req, res) => {
    const t = requireTicketPerm(req, 'time');
    const track = req.body?.track || 'main';
    if (!svc.canEditTime(t, track)) throw new HttpError(400, 'Time can be adjusted by hand only while the ticket is on hold or completed');
    let { started_at, ended_at, minutes, note, personnel_id } = req.body || {};
    if (minutes) {
      ended_at = ended_at ? parseWhen(ended_at, 'End') : new Date().toISOString();
      started_at = new Date(new Date(ended_at).getTime() - Number(minutes) * 60000).toISOString();
    } else {
      started_at = parseWhen(started_at, 'Start'); ended_at = parseWhen(ended_at, 'End');
    }
    if (ended_at <= started_at) throw new HttpError(400, 'End must be after start');
    const pid = personnel_id || (track === 'main' ? t.assignee_id : t[`${track}_assignee_id`] || t.assignee_id) || req.user.personnel_id;
    const position = req.body?.position || svc.positionOf(pid);
    h.run('INSERT INTO time_entries (ticket_id, personnel_id, position, track, started_at, ended_at, manual, note, created_by) VALUES (?,?,?,?,?,?,1,?,?)',
      t.id, pid || null, position, track, started_at, ended_at, note || null, req.user.id);
    svc.log(t.id, req.user.id, 'time', `Added ${Math.round((new Date(ended_at) - new Date(started_at)) / 60000)} min manually (${track})`);
    res.json({ ok: true });
  });
  const loadEntry = (req) => {
    const e = h.get('SELECT * FROM time_entries WHERE id = ?', req.params.id);
    if (!e) throw new HttpError(404, 'Not found');
    const t = svc.getTicket(e.ticket_id);
    if (!ticketPerms(req.user, t).time) throw new HttpError(403, 'Only the assignee or a board manager can edit time');
    if (!e.ended_at) throw new HttpError(400, 'Stop the clock (put the ticket on hold) before editing a running entry');
    if (!svc.canEditTime(t, e.track)) throw new HttpError(400, 'Time can be adjusted by hand only while the ticket is on hold or completed');
    return { e, t };
  };
  app.patch('/api/time/:id', (req, res) => {
    const { e, t } = loadEntry(req);
    const started = req.body.started_at ? parseWhen(req.body.started_at, 'Start') : e.started_at;
    const ended = req.body.ended_at ? parseWhen(req.body.ended_at, 'End') : e.ended_at;
    if (ended <= started) throw new HttpError(400, 'End must be after start');
    h.run("UPDATE time_entries SET started_at = ?, ended_at = ?, note = ?, position = ?, manual = 1, updated_at = datetime('now') WHERE id = ?",
      started, ended, req.body.note ?? e.note, req.body.position || e.position, e.id);
    svc.log(t.id, req.user.id, 'time', `Edited time entry #${e.id}`);
    res.json({ ok: true });
  });
  app.delete('/api/time/:id', (req, res) => {
    const { e, t } = loadEntry(req);
    h.run('DELETE FROM time_entries WHERE id = ?', e.id);
    svc.log(t.id, req.user.id, 'time', `Deleted time entry #${e.id}`);
    res.json({ ok: true });
  });

  // ---------- time cards & time reports ----------
  // Every entry belongs to one person and carries the position they held when it was logged, so the
  // same rows roll up per person (time cards, billing) and per position (cumulative project reports).
  const ENTRY_SECONDS = "CAST((julianday(COALESCE(te.ended_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))) - julianday(te.started_at)) * 86400 AS INTEGER)";
  const timeFilter = (q) => {
    const where = [], params = [];
    const add = (sql, v) => { where.push(sql); params.push(v); };
    if (q.personnel_id) add('te.personnel_id = ?', Number(q.personnel_id));
    if (q.project_id) add('t.project_id = ?', Number(q.project_id));
    if (q.account_id) add('t.account_id = ?', Number(q.account_id));
    if (q.client_id) add('p.client_id = ?', Number(q.client_id));
    if (q.position) add("COALESCE(te.position, 'Unspecified') = ?", q.position);
    if (q.from) add('te.started_at >= ?', new Date(q.from).toISOString());
    if (q.to) add('te.started_at < ?', new Date(q.to).toISOString());
    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  };
  const TIME_FROM = `FROM time_entries te JOIN tickets t ON t.id = te.ticket_id LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN accounts a ON a.id = t.account_id LEFT JOIN personnel pe ON pe.id = te.personnel_id`;

  app.get('/api/timecard', (req, res) => {
    const pid = Number(req.query.personnel_id || req.user.personnel_id);
    if (!pid) throw new HttpError(400, 'Your login is not linked to a personnel record yet — ask an admin to link it');
    if (pid !== req.user.personnel_id && !seesTimecards(req)) throw new HttpError(403, 'You can only see your own time card');
    const f = timeFilter({ ...req.query, personnel_id: pid });
    const entries = h.all(`SELECT te.id, te.started_at, te.ended_at, te.track, te.manual, te.note, COALESCE(te.position, 'Unspecified') AS position,
      ${ENTRY_SECONDS} AS seconds, t.id AS ticket_id, t.ticket_number, t.title, t.board, p.official_name AS project_name, p.project_number,
      c.name AS client_name, a.billing_code ${TIME_FROM} ${f.sql} ORDER BY te.started_at`, ...f.params);
    const person = h.get(`SELECT id, ${pname('personnel')} AS name, title, position, employment_type, department FROM personnel WHERE id = ?`, pid);
    res.json({ person, entries });
  });

  app.get('/api/time/summary', (req, res) => {
    const f = timeFilter(req.query);
    const sum = (groupCols, select) => h.all(`SELECT ${select}, SUM(${ENTRY_SECONDS}) AS seconds, COUNT(*) AS entries
      ${TIME_FROM} ${f.sql} GROUP BY ${groupCols} ORDER BY seconds DESC`, ...f.params);
    const out = {
      total_seconds: h.get(`SELECT COALESCE(SUM(${ENTRY_SECONDS}), 0) AS s ${TIME_FROM} ${f.sql}`, ...f.params).s,
      by_position: sum("COALESCE(te.position, 'Unspecified')", "COALESCE(te.position, 'Unspecified') AS position, COUNT(DISTINCT te.personnel_id) AS people"),
      by_account: sum('t.account_id', 'a.billing_code, a.department'),
    };
    if (seesTimecards(req)) {
      out.by_person = sum("te.personnel_id, COALESCE(te.position, 'Unspecified')",
        `te.personnel_id, ${pname('pe')} AS name, COALESCE(te.position, 'Unspecified') AS position, pe.employment_type`);
    }
    res.json(out);
  });

  // ---------- editorial schedule ----------
  app.get('/api/schedule', (req, res) => {
    const rows = h.all(`${TICKET_SELECT} WHERE t.board = 'editorial' AND t.status NOT IN ('Cancelled','Archived') AND t.start_date IS NOT NULL AND t.final_lock_date IS NOT NULL`)
      .map(withBooking)
      .filter((t) => (!req.query.from || t.booking_end >= req.query.from) && (!req.query.to || t.booking_start <= req.query.to));
    res.json(rows);
  });

  // ---------- notifications & dashboard ----------
  app.get('/api/notifications', (req, res) => {
    res.json(h.all(`SELECT n.*, t.ticket_number FROM notifications n LEFT JOIN tickets t ON t.id = n.ticket_id
      WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 100`, req.user.id));
  });
  app.post('/api/notifications/read', (req, res) => {
    const ids = req.body?.ids;
    if (Array.isArray(ids)) for (const id of ids) h.run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', id, req.user.id);
    else h.run('UPDATE notifications SET read = 1 WHERE user_id = ?', req.user.id);
    res.json({ ok: true });
  });
  app.get('/api/dashboard', (req, res) => {
    const pid = req.user.personnel_id;
    const out = {
      my_open: pid ? h.get("SELECT COUNT(*) AS n FROM tickets WHERE ? IN (assignee_id, picture_assignee_id, sound_assignee_id) AND status NOT IN ('Completed','Cancelled','Archived','Shipped')", pid).n : 0,
      my_running: pid ? h.all(`SELECT t.id, t.ticket_number, t.title, te.track, te.started_at FROM time_entries te JOIN tickets t ON t.id = te.ticket_id
        WHERE te.ended_at IS NULL AND te.personnel_id = ?`, pid) : [],
      my_hours_week: pid ? Math.round(h.get(`SELECT ${SECONDS("te.personnel_id = ? AND te.started_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')")} AS s`, pid).s / 36) / 100 : 0,
      drafts: {},
    };
    for (const b of Object.keys(BOARDS)) {
      if (svc.can(req.user, BOARDS[b].manageCategory)) out.drafts[b] = h.get("SELECT COUNT(*) AS n FROM tickets WHERE board = ? AND status = 'Draft'", b).n;
    }
    if (svc.can(req.user, 'hr')) out.hr_pending = h.get("SELECT COUNT(*) AS n FROM personnel WHERE active = 1 AND hr_status != 'Sent to IT'").n;
    if (svc.can(req.user, 'it')) out.it_pending = h.get("SELECT COUNT(*) AS n FROM personnel WHERE active = 1 AND it_status IN ('Not Started','In Progress')").n;
    out.active_projects = h.get("SELECT COUNT(*) AS n FROM projects WHERE status = 'Active'").n;
    res.json(out);
  });

  // ---------- import ----------
  app.post('/api/import/parse', need('import'), async (req, res) => {
    const { entity, file } = req.body || {};
    if (!file) throw new HttpError(400, 'Attach a file or paste text');
    res.json({ records: await parseImport(entity, file) });
  });
  app.post('/api/import/commit', need('import'), (req, res) => {
    const { entity, records } = req.body || {};
    if (!IMPORT_FIELDS[entity] || !Array.isArray(records)) throw new HttpError(400, 'Nothing to import');
    const findPerson = (name) => name && h.get(`SELECT id FROM personnel WHERE lower(${pname('personnel')}) = lower(?)`, String(name).trim())?.id;
    const findProject = (name) => name && h.get('SELECT id FROM projects WHERE lower(official_name) = lower(?) OR lower(code_name) = lower(?) OR project_number = ?', name, name, name)?.id;
    const results = records.map((raw, i) => {
      try {
        const r = Object.fromEntries(Object.entries(raw).filter(([k, v]) => IMPORT_FIELDS[entity].includes(k) && v !== '' && v != null));
        h.tx(() => {
          if (entity === 'personnel') {
            if (!r.first_name) throw new Error('first_name is required');
            if (r.rate) r.rate = Number(String(r.rate).replace(/[^0-9.]/g, '')) || null;
            if (!seesPay(req)) { delete r.rate; delete r.rate_frequency; }
            insert('personnel', r);
          } else if (entity === 'clients') {
            if (!r.name) throw new Error('name is required');
            r.billing_prefix = String(r.billing_prefix || r.name.replace(/[^A-Za-z]/g, '').slice(0, 3)).toUpperCase();
            insert('clients', r);
          } else if (entity === 'projects') {
            const client = h.get('SELECT id FROM clients WHERE lower(name) = lower(?)', r.client_name || '');
            if (!client) throw new Error(`client “${r.client_name || ''}” not found — import clients first`);
            if (!r.official_name) throw new Error('official_name is required');
            const data = {
              official_name: r.official_name, code_name: r.code_name, client_id: client.id, est_start: r.est_start,
              est_lock: r.est_lock, est_delivery: r.est_delivery, producer_id: findPerson(r.producer_name) || null, notes: r.notes,
              scope: JSON.stringify(String(r.scope || '').split(',').map((s) => s.trim()).filter(Boolean)),
              project_number: svc.nextProjectNumber(),
            };
            if (fin(req)) { data.budget = Number(r.budget) || null; data.est_cost = Number(r.est_cost) || null; }
            insert('projects', Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
          } else if (entity === 'media') {
            if (!r.name) throw new Error('name is required');
            insert('media', {
              item_number: r.item_number || svc.nextItemNumber('media', 'MED'), name: r.name, media_type: r.media_type ?? null,
              project_id: findProject(r.project_name) || null, location: r.location ?? null, notes: r.notes ?? null,
            });
          } else if (entity === 'equipment') {
            if (!r.name) throw new Error('name is required');
            const { assigned_to_name, ...rest } = r;
            insert('equipment', { ...rest, item_number: r.item_number || svc.nextItemNumber('equipment', 'EQ'), assigned_to: findPerson(assigned_to_name) || null });
          }
        });
        return { row: i + 1, ok: true };
      } catch (e) {
        return { row: i + 1, ok: false, error: String(e.message).includes('UNIQUE') ? 'duplicate (already exists)' : e.message };
      }
    });
    res.json({ results, imported: results.filter((r) => r.ok).length });
  });

  // ---------- static front end ----------
  app.use('/vendor/zxing-browser.min.js', express.static(path.join(here, '..', 'node_modules', '@zxing', 'browser', 'umd', 'zxing-browser.min.js')));
  app.use(express.static(path.join(here, '..', 'public')));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(here, '..', 'public', 'index.html')));

  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'File is too large (30 MB max)' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });
  return app;
}
