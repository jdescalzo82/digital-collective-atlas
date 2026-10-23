// Business rules shared by the HTTP routes and the tests.
import crypto from 'node:crypto';
import { BOARDS, FINISHING_TIMED, isTimed } from './workflow.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const now = () => new Date().toISOString();

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
export function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = crypto.scryptSync(pw, salt, 32);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function addDays(isoDate, n) {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function createServices(h) {
  const userPerms = (u) => new Set(String(u?.permissions || '').split(',').filter(Boolean));
  const can = (u, p) => { const s = userPerms(u); return s.has('admin') || s.has(p); };

  function log(ticketId, userId, action, detail) {
    h.run('INSERT INTO history (ticket_id, user_id, action, detail) VALUES (?,?,?,?)', ticketId, userId ?? null, action, detail ?? null);
  }

  function notifyUsers(userIds, ticketId, text) {
    for (const id of new Set(userIds.filter(Boolean))) {
      h.run('INSERT INTO notifications (user_id, ticket_id, text) VALUES (?,?,?)', id, ticketId, text);
    }
  }
  function managersOf(board) {
    const perm = BOARDS[board].manageCategory;
    return h.all('SELECT id, permissions FROM users WHERE active = 1')
      .filter((u) => { const s = userPerms(u); return s.has('admin') || s.has(perm); })
      .map((u) => u.id);
  }
  const usersForPersonnel = (pid) => (pid ? h.all('SELECT id FROM users WHERE personnel_id = ? AND active = 1', pid).map((r) => r.id) : []);

  // ---------- numbering ----------
  function nextTicketNumber(board) {
    const prefix = BOARDS[board].prefix;
    const row = h.get("SELECT MAX(CAST(substr(ticket_number, ?) AS INTEGER)) AS n FROM tickets WHERE ticket_number LIKE ?", prefix.length + 2, `${prefix}-%`);
    return `${prefix}-${String((row?.n || 0) + 1).padStart(4, '0')}`;
  }
  function nextProjectNumber() {
    const yy = String(new Date().getUTCFullYear()).slice(2);
    const row = h.get("SELECT MAX(CAST(substr(project_number, 5) AS INTEGER)) AS n FROM projects WHERE project_number LIKE ?", `P${yy}-%`);
    return `P${yy}-${String((row?.n || 0) + 1).padStart(4, '0')}`;
  }
  function nextItemNumber(table, prefix) {
    const row = h.get(`SELECT MAX(CAST(substr(item_number, ?) AS INTEGER)) AS n FROM ${table} WHERE item_number GLOB ?`, prefix.length + 2, `${prefix}-[0-9]*`);
    return `${prefix}-${String((row?.n || 0) + 1).padStart(6, '0')}`;
  }

  // Billing code: <client prefix>-<department code>-<sequence per client+department>
  function createAccount({ project_id, department, lead_producer_id, description }, user) {
    const project = h.get('SELECT p.*, c.billing_prefix FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = ?', project_id);
    if (!project) throw new HttpError(400, 'Project not found');
    if (['Killed', 'Cancelled'].includes(project.status)) throw new HttpError(400, `Project is ${project.status.toLowerCase()}; no new billing numbers`);
    const dept = h.get("SELECT value, code FROM options WHERE category = 'department' AND value = ?", department);
    if (!dept?.code) throw new HttpError(400, 'Department needs a billing code (set it under Admin → Dropdown options)');
    const seqRow = h.get(
      `SELECT MAX(a.seq) AS n FROM accounts a JOIN projects p ON p.id = a.project_id
       WHERE p.client_id = ? AND a.department_code = ?`, project.client_id, dept.code);
    const seq = (seqRow?.n || 0) + 1;
    const billing = `${project.billing_prefix.toUpperCase()}-${dept.code.toUpperCase()}-${String(seq).padStart(4, '0')}`;
    const r = h.run(
      `INSERT INTO accounts (project_id, department, department_code, seq, billing_code, lead_producer_id, description)
       VALUES (?,?,?,?,?,?,?)`,
      project_id, dept.value, dept.code.toUpperCase(), seq, billing, lead_producer_id || project.producer_id || null, description || null);
    return h.get('SELECT * FROM accounts WHERE id = ?', r.lastInsertRowid);
  }

  // ---------- time tracking ----------
  // Time is logged to whoever is assigned when the clock starts, under the position they hold right then.
  const positionOf = (personnelId) => (personnelId ? h.get('SELECT position FROM personnel WHERE id = ?', personnelId)?.position ?? null : null);
  function openTimer(ticketId, track, personnelId, userId) {
    const open = h.get('SELECT id FROM time_entries WHERE ticket_id = ? AND track = ? AND ended_at IS NULL', ticketId, track);
    if (open) return;
    h.run('INSERT INTO time_entries (ticket_id, personnel_id, position, track, started_at, created_by) VALUES (?,?,?,?,?,?)',
      ticketId, personnelId ?? null, positionOf(personnelId), track, now(), userId ?? null);
  }
  function closeTimers(ticketId, track) {
    const t = now();
    if (track) h.run('UPDATE time_entries SET ended_at = ?, updated_at = ? WHERE ticket_id = ? AND track = ? AND ended_at IS NULL', t, t, ticketId, track);
    else h.run('UPDATE time_entries SET ended_at = ?, updated_at = ? WHERE ticket_id = ? AND ended_at IS NULL', t, t, ticketId);
  }

  function canEditTime(ticket, track) {
    if (track === 'picture' || track === 'sound') {
      const st = ticket[`${track}_status`];
      return !FINISHING_TIMED.includes(st);
    }
    return BOARDS[ticket.board].manualEditStatuses.includes(ticket.status);
  }

  function getTicket(id) {
    const t = h.get('SELECT * FROM tickets WHERE id = ?', id);
    if (!t) throw new HttpError(404, 'Ticket not found');
    return t;
  }

  // ---------- tickets ----------
  const TICKET_FIELDS = [
    'title', 'project_id', 'account_id', 'category', 'assignee_id', 'brief', 'due_date',
    'desired_editor_id', 'start_date', 'first_cut_date', 'final_lock_date', 'creative_name', 'duration',
    'picture_assignee_id', 'sound_assignee_id',
  ];

  function assertProjectOpen(projectId) {
    if (!projectId) return;
    const p = h.get('SELECT status FROM projects WHERE id = ?', projectId);
    if (!p) throw new HttpError(400, 'Project not found');
    if (['Killed', 'Cancelled'].includes(p.status)) throw new HttpError(400, `Project is ${p.status.toLowerCase()}`);
  }

  function setLinks(ticketId, { media_ids, tags }) {
    if (Array.isArray(media_ids)) {
      h.run('DELETE FROM ticket_media WHERE ticket_id = ?', ticketId);
      for (const m of new Set(media_ids.map(Number).filter(Boolean))) h.run('INSERT INTO ticket_media (ticket_id, media_id) VALUES (?,?)', ticketId, m);
    }
    if (Array.isArray(tags)) {
      h.run('DELETE FROM tags WHERE ticket_id = ?', ticketId);
      for (const t of tags) {
        if (t?.entity_type && t?.entity_id) h.run('INSERT INTO tags (ticket_id, entity_type, entity_id) VALUES (?,?,?)', ticketId, t.entity_type, Number(t.entity_id));
      }
    }
  }

  function createTicket(board, data, user, { silent = false } = {}) {
    if (!BOARDS[board]) throw new HttpError(400, 'Unknown board');
    if (!data.title?.trim()) throw new HttpError(400, 'Title is required');
    if (!data.account_id) throw new HttpError(400, 'Every ticket needs a billing number');
    const account = h.get('SELECT * FROM accounts WHERE id = ?', data.account_id);
    if (!account) throw new HttpError(400, 'Billing number not found');
    if (account.status !== 'Open') throw new HttpError(400, `Billing number ${account.billing_code} is ${account.status.toLowerCase()}`);
    const projectId = data.project_id || account.project_id;
    assertProjectOpen(projectId);
    if (board === 'ae' && !data.category) throw new HttpError(400, 'Pick a ticket category');
    if (board === 'editorial' && data.start_date && data.final_lock_date && data.final_lock_date < data.start_date) {
      throw new HttpError(400, 'Final lock date is before the start date');
    }
    const cols = TICKET_FIELDS.filter((f) => data[f] !== undefined && data[f] !== '');
    const extra = {
      ticket_number: nextTicketNumber(board), board, status: 'Draft', project_id: projectId, requested_by: user?.id ?? null,
      parent_ticket_id: data.parent_ticket_id ?? null, derivative_type: data.derivative_type ?? null,
      editorial_ticket_id: data.editorial_ticket_id ?? null,
      picture_status: data.picture_status ?? null, sound_status: data.sound_status ?? null,
    };
    const names = [...cols.filter((c) => !(c in extra)), ...Object.keys(extra)];
    const values = names.map((n) => (n in extra ? extra[n] : data[n]));
    const r = h.run(`INSERT INTO tickets (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`, ...values);
    const id = Number(r.lastInsertRowid);
    setLinks(id, data);
    log(id, user?.id, 'created', `Created as Draft on ${BOARDS[board].label} board`);
    if (!silent) {
      const t = getTicket(id);
      notifyUsers(managersOf(board), id, `New ${BOARDS[board].label} request ${t.ticket_number} “${t.title}” needs an assignee`);
    }
    return getTicket(id);
  }

  function updateTicket(id, data, user) {
    const t = getTicket(id);
    if (data.account_id && data.account_id !== t.account_id) {
      const a = h.get('SELECT * FROM accounts WHERE id = ?', data.account_id);
      if (!a) throw new HttpError(400, 'Billing number not found');
      if (a.status !== 'Open') throw new HttpError(400, `Billing number ${a.billing_code} is ${a.status.toLowerCase()}`);
    }
    const cols = TICKET_FIELDS.filter((f) => f in data && f !== 'assignee_id');
    if (cols.length) {
      h.run(`UPDATE tickets SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
        ...cols.map((c) => (data[c] === '' ? null : data[c])), id);
      log(id, user?.id, 'edited', cols.join(', '));
    }
    setLinks(id, data);
    if ('assignee_id' in data && Number(data.assignee_id || 0) !== Number(t.assignee_id || 0)) assign(id, data.assignee_id || null, user);
    return getTicket(id);
  }

  // Assigning a Draft moves it to the assignee's queue (Queued / Scheduled).
  function assign(id, personnelId, user) {
    const t = getTicket(id);
    const cfg = BOARDS[t.board];
    let status = t.status;
    if (personnelId && t.status === 'Draft') status = cfg.assignedStatus;
    if (!personnelId && t.status === cfg.assignedStatus) status = 'Draft';
    h.run("UPDATE tickets SET assignee_id = ?, status = ?, updated_at = datetime('now') WHERE id = ?", personnelId, status, id);
    // A running clock follows the ticket to the new owner.
    const open = h.get("SELECT id FROM time_entries WHERE ticket_id = ? AND track = 'main' AND ended_at IS NULL", id);
    if (open && Number(personnelId) !== Number(t.assignee_id)) {
      closeTimers(id, 'main');
      if (personnelId) openTimer(id, 'main', personnelId, user?.id);
    }
    const p = personnelId ? h.get('SELECT first_name, last_name FROM personnel WHERE id = ?', personnelId) : null;
    log(id, user?.id, 'assigned', p ? `Assigned to ${p.first_name} ${p.last_name}${status !== t.status ? ` · ${t.status} → ${status}` : ''}` : 'Unassigned');
    if (personnelId) notifyUsers(usersForPersonnel(personnelId), id, `You were assigned ${t.ticket_number} “${t.title}”`);
    return getTicket(id);
  }

  function changeStatus(id, status, user, extra = {}) {
    const t = getTicket(id);
    const cfg = BOARDS[t.board];
    if (cfg.actions?.includes(status)) {
      if (status === 'Unarchive') return { ticket: t, created: unarchive(id, user) };
      if (status === 'Cut-Down') return { ticket: t, created: cutDown(id, extra.duration, user) };
    }
    if (!cfg.statuses.includes(status)) throw new HttpError(400, `“${status}” is not a ${cfg.label} status`);
    if (status === t.status) return { ticket: t };
    if (status !== 'Draft' && status !== 'Cancelled' && !t.assignee_id) throw new HttpError(400, 'Assign someone before moving this ticket out of Draft');
    h.run("UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE id = ?", status, id);
    if (isTimed(t.board, status)) openTimer(id, 'main', t.assignee_id, user?.id);
    else closeTimers(id, 'main');
    if (status === 'Cancelled') closeTimers(id);
    log(id, user?.id, 'status', `${t.status} → ${status}`);
    const watchers = [...usersForPersonnel(t.assignee_id), t.requested_by].filter((u) => u !== user?.id);
    notifyUsers(watchers, id, `${t.ticket_number} “${t.title}” is now ${status}`);
    return { ticket: getTicket(id) };
  }

  function changeTrackStatus(id, track, status, user) {
    const t = getTicket(id);
    if (t.board !== 'finishing' || !['picture', 'sound'].includes(track)) throw new HttpError(400, 'Only finishing tickets have picture/sound tracks');
    const prev = t[`${track}_status`];
    if (prev === status) return getTicket(id);
    if (status && FINISHING_TIMED.includes(status) && !t[`${track}_assignee_id`] && !t.assignee_id) {
      throw new HttpError(400, `Assign a ${track} artist first`);
    }
    h.run(`UPDATE tickets SET ${track}_status = ?, updated_at = datetime('now') WHERE id = ?`, status || null, id);
    if (FINISHING_TIMED.includes(status)) openTimer(id, track, t[`${track}_assignee_id`] || t.assignee_id, user?.id);
    else closeTimers(id, track);
    log(id, user?.id, `${track} status`, `${prev || '—'} → ${status || '—'}`);
    // Roll the overall finishing status forward automatically.
    const fresh = getTicket(id);
    const tracks = [fresh.picture_status, fresh.sound_status].filter(Boolean);
    if (tracks.length && tracks.every((s) => s === 'Completed') && fresh.status !== 'Completed') {
      h.run("UPDATE tickets SET status = 'Completed' WHERE id = ?", id);
      log(id, user?.id, 'status', `${fresh.status} → Completed (all tracks complete)`);
    } else if (['Draft', 'Queued'].includes(fresh.status) && tracks.some((s) => s !== 'Prep Requested') && fresh.assignee_id) {
      h.run("UPDATE tickets SET status = 'In Progress' WHERE id = ?", id);
      log(id, user?.id, 'status', `${fresh.status} → In Progress`);
    }
    if (t.editorial_ticket_id) log(t.editorial_ticket_id, user?.id, `finishing ${track}`, `${t.ticket_number}: ${prev || '—'} → ${status || '—'}`);
    return getTicket(id);
  }

  function copyLinks(fromId, toId, { media = true, tags = true } = {}) {
    if (media) h.run('INSERT OR IGNORE INTO ticket_media (ticket_id, media_id) SELECT ?, media_id FROM ticket_media WHERE ticket_id = ?', toId, fromId);
    if (tags) h.run('INSERT INTO tags (ticket_id, entity_type, entity_id) SELECT ?, entity_type, entity_id FROM tags WHERE ticket_id = ? AND message_id IS NULL', toId, fromId);
  }

  // "Unarchive": clone as a new Draft; the original keeps its status.
  function unarchive(id, user) {
    const t = getTicket(id);
    return h.tx(() => {
      const created = createTicket(t.board, {
        ...pick(t, TICKET_FIELDS), assignee_id: undefined,
        title: `Unarchive - ${t.title}`, parent_ticket_id: t.id, derivative_type: 'unarchive',
      }, user);
      copyLinks(t.id, created.id);
      log(t.id, user?.id, 'unarchive', `Unarchive request created: ${created.ticket_number}`);
      return created;
    });
  }

  // "Cut-Down": new Draft with only the essentials, linked back to the original.
  function cutDown(id, duration, user) {
    if (!duration) throw new HttpError(400, 'Enter the cut-down duration');
    const t = getTicket(id);
    const creative = t.creative_name || t.title;
    return h.tx(() => {
      const created = createTicket(t.board, {
        title: `Cut-Down ${duration} - ${creative}`,
        project_id: t.project_id, account_id: t.account_id, creative_name: creative, duration,
        brief: `Derivative of ${t.ticket_number} “${t.title}”.`,
        parent_ticket_id: t.id, derivative_type: 'cutdown',
      }, user);
      log(t.id, user?.id, 'cut-down', `Cut-down ${duration} created: ${created.ticket_number}`);
      return created;
    });
  }

  // Finishing request compiled from an editorial ticket.
  function requestFinishing(editorialId, { picture = true, sound = true, notes } = {}, user) {
    const t = getTicket(editorialId);
    if (t.board !== 'editorial') throw new HttpError(400, 'Finishing requests start from an editorial ticket');
    if (!picture && !sound) throw new HttpError(400, 'Request picture, sound, or both');
    // Bill to the project's Finishing number when there is one, else the editorial one.
    const finAccount = h.get("SELECT id FROM accounts WHERE project_id = ? AND department = 'Finishing' AND status = 'Open' ORDER BY id LIMIT 1", t.project_id);
    return h.tx(() => {
      const created = createTicket('finishing', {
        ...pick(t, TICKET_FIELDS), assignee_id: undefined, account_id: finAccount?.id || t.account_id,
        title: `Finishing - ${t.title}`,
        brief: [t.brief, notes ? `Finishing notes: ${notes}` : null].filter(Boolean).join('\n\n') || null,
        editorial_ticket_id: t.id,
        picture_status: picture ? 'Prep Requested' : null,
        sound_status: sound ? 'Prep Requested' : null,
      }, user);
      copyLinks(t.id, created.id);
      log(t.id, user?.id, 'finishing', `Finishing request ${created.ticket_number} created`);
      return created;
    });
  }

  // Kill / cancel a project: close billing numbers, cancel open tickets, stop clocks.
  function setProjectStatus(projectId, status, reason, user) {
    const p = h.get('SELECT * FROM projects WHERE id = ?', projectId);
    if (!p) throw new HttpError(404, 'Project not found');
    return h.tx(() => {
      h.run("UPDATE projects SET status = ?, status_reason = ?, status_changed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", status, reason || null, projectId);
      let cancelled = 0;
      if (['Killed', 'Cancelled'].includes(status)) {
        h.run("UPDATE accounts SET status = ? WHERE project_id = ? AND status = 'Open'", status === 'Killed' ? 'Killed' : 'Closed', projectId);
        const done = ['Completed', 'Cancelled', 'Shipped', 'Ready for Backup', 'Archived', 'Final Lock'];
        for (const t of h.all('SELECT * FROM tickets WHERE project_id = ?', projectId)) {
          if (done.includes(t.status)) continue;
          closeTimers(t.id);
          h.run("UPDATE tickets SET status = 'Cancelled', updated_at = datetime('now') WHERE id = ?", t.id);
          log(t.id, user?.id, 'status', `${t.status} → Cancelled (project ${status.toLowerCase()}${reason ? `: ${reason}` : ''})`);
          notifyUsers(usersForPersonnel(t.assignee_id), t.id, `${t.ticket_number} cancelled — project ${p.official_name} was ${status.toLowerCase()}`);
          cancelled++;
        }
      } else if (status === 'Active' && ['Killed', 'Cancelled'].includes(p.status)) {
        h.run("UPDATE accounts SET status = 'Open' WHERE project_id = ? AND status IN ('Closed','Killed')", projectId);
      }
      return { project: h.get('SELECT * FROM projects WHERE id = ?', projectId), cancelled_tickets: cancelled };
    });
  }

  return {
    can, userPerms, positionOf, log, notifyUsers, nextProjectNumber, nextItemNumber, createAccount,
    createTicket, updateTicket, assign, changeStatus, changeTrackStatus, unarchive, cutDown,
    requestFinishing, setProjectStatus, canEditTime, closeTimers, getTicket,
  };
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== null && obj[k] !== undefined) out[k] = obj[k];
  return out;
}
