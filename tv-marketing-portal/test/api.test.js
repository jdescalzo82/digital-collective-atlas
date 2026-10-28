import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, helpers } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seedBase, seedDemo } from '../server/seed.js';

let server, base, db;
const tokens = {};

before(async () => {
  db = openDb(':memory:');
  seedBase(db);
  seedDemo(db);
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  for (const u of ['admin', 'maya', 'sam', 'jo', 'leo', 'rae', 'hr', 'it', 'kai']) {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: u === 'admin' ? 'admin' : 'password' }) });
    tokens[u] = (await r.json()).token;
  }
});
after(() => server.close());

async function api(user, method, url, body) {
  const r = await fetch(`${base}/api${url}`, {
    method, headers: { 'content-type': 'application/json', 'x-session': tokens[user] }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) { const e = new Error(data.error); e.status = r.status; throw e; }
  return data;
}
const lookup = () => api('admin', 'GET', '/lookup');
const personId = async (first) => (await lookup()).personnel.find((p) => p.name.startsWith(first)).id;

test('requires sign-in', async () => {
  const r = await fetch(`${base}/api/me`);
  assert.equal(r.status, 401);
});

test('billing codes are client prefix + department code + sequence', async () => {
  const accts = await api('admin', 'GET', '/accounts');
  assert.deepEqual(accts.map((a) => a.billing_code).sort(), ['NOVA-ED-0001', 'NOVA-FN-0001', 'STRM-ED-0001']);
  const proj = (await lookup()).projects.find((p) => p.code_name === 'LIGHTHOUSE');
  const next = await api('maya', 'POST', '/accounts', { project_id: proj.id, department: 'Editorial' });
  assert.equal(next.billing_code, 'NOVA-ED-0002');
});

test('financials hidden without permission', async () => {
  const asSam = await api('sam', 'GET', '/projects');
  assert.equal(asSam[0].budget, undefined);
  assert.equal(asSam[0].differential, undefined);
  const asMaya = await api('maya', 'GET', '/projects');
  const p = asMaya.find((x) => x.code_name === 'LIGHTHOUSE');
  assert.equal(p.differential, 250000 - 182000);
  const people = await api('sam', 'GET', '/personnel');
  assert.equal(people[0].rate, undefined);
  const it = await api('it', 'GET', '/it/personnel');
  assert.ok(it.length > 0);
  assert.ok(it.every((r) => r.rate === undefined && r.rate_frequency === undefined));
});

test('AE ticket: draft → assign → queued → timer runs only in progress', async () => {
  const acct = (await api('admin', 'GET', '/accounts'))[0];
  const t = await api('jo', 'POST', '/tickets', { board: 'ae', title: 'Clip pull for social', category: 'Clip Pulls', account_id: acct.id });
  assert.equal(t.status, 'Draft');
  assert.match(t.ticket_number, /^AE-\d{4}$/);
  // managers were notified
  const notes = await api('sam', 'GET', '/notifications');
  assert.ok(notes.some((n) => n.ticket_id === t.id));
  // non-manager cannot assign
  await assert.rejects(api('jo', 'POST', `/tickets/${t.id}/assign`, { personnel_id: 1 }), /assignee or a board manager/);
  const jo = await personId('Jo');
  const assigned = await api('sam', 'POST', `/tickets/${t.id}/assign`, { personnel_id: jo });
  assert.equal(assigned.status, 'Queued');
  await api('jo', 'POST', `/tickets/${t.id}/status`, { status: 'In Progress' });
  let full = await api('jo', 'GET', `/tickets/${t.id}`);
  assert.equal(full.running, 1);
  assert.equal(full.time_editable.main, false);
  await assert.rejects(api('jo', 'POST', `/tickets/${t.id}/time`, { minutes: 30 }), /on hold or completed/);
  await api('jo', 'POST', `/tickets/${t.id}/status`, { status: 'Out for Approval' });
  full = await api('jo', 'GET', `/tickets/${t.id}`);
  assert.equal(full.running, 0, 'clock stops while out for approval');
  await api('jo', 'POST', `/tickets/${t.id}/status`, { status: 'On Hold' });
  await api('jo', 'POST', `/tickets/${t.id}/time`, { minutes: 45, note: 'forgot to start' });
  full = await api('jo', 'GET', `/tickets/${t.id}`);
  assert.ok(full.seconds >= 45 * 60);
  const manual = full.time.find((e) => e.manual);
  await api('jo', 'PATCH', `/time/${manual.id}`, { started_at: manual.started_at, ended_at: new Date(new Date(manual.started_at).getTime() + 3600e3).toISOString() });
  await api('jo', 'POST', `/tickets/${t.id}/status`, { status: 'In Progress' });
  full = await api('jo', 'GET', `/tickets/${t.id}`);
  assert.equal(full.running, 1, 'clock restarts when back in progress');
  await api('jo', 'POST', `/tickets/${t.id}/status`, { status: 'Completed' });
  full = await api('jo', 'GET', `/tickets/${t.id}`);
  assert.equal(full.running, 0);
  assert.equal(full.time_editable.main, true);
});

test('editorial: booking span adds two days, unarchive and cut-down clone', async () => {
  const eds = await api('admin', 'GET', '/tickets?board=editorial');
  const ed = eds.find((t) => t.title === 'Midnight Harbor — Trailer 1');
  assert.equal(ed.booking_end, '2026-11-22');
  await api('leo', 'POST', `/tickets/${ed.id}/status`, { status: 'Out for Client Review' });
  let full = await api('leo', 'GET', `/tickets/${ed.id}`);
  assert.equal(full.running, 0);
  await api('leo', 'POST', `/tickets/${ed.id}/status`, { status: 'Applying Client Notes' });
  full = await api('leo', 'GET', `/tickets/${ed.id}`);
  assert.equal(full.running, 1);
  await api('leo', 'POST', `/tickets/${ed.id}/status`, { status: 'Archived' });

  const { created: un } = await api('leo', 'POST', `/tickets/${ed.id}/status`, { status: 'Unarchive' });
  assert.equal(un.title, 'Unarchive - Midnight Harbor — Trailer 1');
  assert.equal(un.status, 'Draft');
  assert.equal(un.parent_ticket_id, ed.id);
  assert.equal((await api('leo', 'GET', `/tickets/${ed.id}`)).status, 'Archived', 'original keeps its status');
  const unFull = await api('leo', 'GET', `/tickets/${un.id}`);
  assert.equal(unFull.media.length, 1, 'unarchive copies media');

  await assert.rejects(api('leo', 'POST', `/tickets/${ed.id}/status`, { status: 'Cut-Down' }), /duration/);
  const { created: cd } = await api('leo', 'POST', `/tickets/${ed.id}/status`, { status: 'Cut-Down', duration: ':30' });
  assert.equal(cd.title, 'Cut-Down :30 - Trailer 1 "Tide"');
  assert.equal(cd.start_date, null, 'cut-down drops project details');
  assert.equal(cd.account_id, ed.account_id, 'keeps billing number');
  const cdFull = await api('leo', 'GET', `/tickets/${cd.id}`);
  assert.equal(cdFull.parent.id, ed.id);
  assert.equal(cdFull.media.length, 0);
});

test('finishing request links back and tracks picture / sound separately', async () => {
  const ed = (await api('admin', 'GET', '/tickets?board=editorial')).find((t) => t.title === 'The Orchard — Teaser');
  const fn = await api('maya', 'POST', `/tickets/${ed.id}/finishing`, { picture: true, sound: true });
  assert.equal(fn.board, 'finishing');
  assert.equal(fn.picture_status, 'Prep Requested');
  assert.equal(fn.editorial_ticket_id, ed.id);
  assert.equal(fn.account_id, ed.account_id, 'no Finishing billing number on this project, so it keeps the editorial one');
  const rae = await personId('Rae');
  const dev = await personId('Dev');
  await api('rae', 'PATCH', `/tickets/${fn.id}`, { picture_assignee_id: rae, sound_assignee_id: dev });
  await api('rae', 'POST', `/tickets/${fn.id}/assign`, { personnel_id: rae });
  await api('rae', 'POST', `/tickets/${fn.id}/track`, { track: 'picture', status: 'Prep In Progress' });
  let full = await api('rae', 'GET', `/tickets/${fn.id}`);
  assert.equal(full.status, 'In Progress');
  assert.ok(full.time.some((e) => e.track === 'picture' && !e.ended_at));
  assert.equal(full.time_editable.picture, false);
  assert.equal(full.time_editable.sound, true);
  await api('rae', 'POST', `/tickets/${fn.id}/track`, { track: 'picture', status: 'Completed' });
  await api('rae', 'POST', `/tickets/${fn.id}/track`, { track: 'sound', status: 'Completed' });
  full = await api('rae', 'GET', `/tickets/${fn.id}`);
  assert.equal(full.status, 'Completed');
  const edFull = await api('admin', 'GET', `/tickets/${ed.id}`);
  assert.equal(edFull.fin_picture, 'Completed');
  assert.equal(edFull.finishing.length, 1);

  const harbor = (await api('admin', 'GET', '/tickets?board=editorial')).find((t) => t.title === 'Midnight Harbor — Trailer 1');
  const fn2 = await api('maya', 'POST', `/tickets/${harbor.id}/finishing`, { picture: true, sound: false });
  assert.equal((await api('maya', 'GET', `/tickets/${fn2.id}`)).billing_code, 'NOVA-FN-0001', 'uses the project\'s Finishing billing number');
  assert.equal(fn2.sound_status, null);
});

test('message board review status and tagging notify', async () => {
  const t = (await api('admin', 'GET', '/tickets?board=ae'))[0];
  const jo = await personId('Jo');
  await api('sam', 'POST', `/tickets/${t.id}/messages`, { kind: 'Review Link', link_url: 'https://review.example/abc', body: 'v2 up', tags: [{ entity_type: 'personnel', entity_id: jo }] });
  const notes = await api('jo', 'GET', '/notifications');
  assert.ok(notes.some((n) => /tagged you/.test(n.text)));
  const full = await api('jo', 'GET', `/tickets/${t.id}`);
  assert.equal(full.messages[0].review_status, 'Pending');
  await api('jo', 'PATCH', `/messages/${full.messages[0].id}`, { review_status: 'Approved' });
  assert.equal((await api('jo', 'GET', `/tickets/${t.id}`)).messages[0].review_status, 'Approved');
  await assert.rejects(api('sam', 'POST', `/tickets/${t.id}/messages`, { kind: 'Review Link', link_url: 'javascript:alert(1)' }), /http/);
});

test('killing a project closes billing numbers and cancels open tickets', async () => {
  const proj = (await lookup()).projects.find((p) => p.code_name === 'LIGHTHOUSE');
  await assert.rejects(api('maya', 'POST', `/projects/${proj.id}/status`, { status: 'Killed' }), /reason/);
  const r = await api('maya', 'POST', `/projects/${proj.id}/status`, { status: 'Killed', reason: 'Studio pulled release' });
  assert.ok(r.cancelled_tickets > 0);
  const accts = await api('admin', 'GET', `/accounts?project_id=${proj.id}`);
  assert.ok(accts.every((a) => a.status !== 'Open'));
  const open = await api('admin', 'GET', `/tickets?project_id=${proj.id}&open=1`);
  assert.equal(open.length, 0);
  const anyRunning = helpers(db).get("SELECT COUNT(*) AS n FROM time_entries te JOIN tickets t ON t.id = te.ticket_id WHERE t.project_id = ? AND te.ended_at IS NULL", proj.id).n;
  assert.equal(anyRunning, 0);
  await assert.rejects(api('maya', 'POST', '/tickets', { board: 'ae', title: 'x', category: 'Other', account_id: accts[0].id }), /killed|closed/i);
});

test('HR releases to IT; scan finds items; CSV import', async () => {
  const alex = (await api('hr', 'GET', '/personnel')).find((p) => p.first_name === 'Alex');
  assert.equal(alex.rate, 900, 'HR sees pay');
  await api('hr', 'PATCH', `/personnel/${alex.id}/hr`, { hr_status: 'Sent to IT', start_date: '2026-11-02' });
  const it = await api('it', 'GET', '/it/personnel');
  assert.ok(it.some((p) => p.id === alex.id && p.it_status === 'Not Started'));
  await assert.rejects(api('it', 'PATCH', `/personnel/${alex.id}/hr`, { hr_status: 'Verified' }), /access/);

  const scan = await api('jo', 'GET', '/scan/MED-000001');
  assert.equal(scan.type, 'media');
  assert.equal((await api('jo', 'GET', '/scan/EQ-000002')).type, 'equipment');
  assert.equal((await api('jo', 'GET', '/scan/NOPE')).type, null);

  const csv = 'Client Name,Billing Prefix,Contact,Contact Email,Sector\nAcme Studios,ACME,Pat Lee,pat@acme.example,Brand\n"Big, Bold TV",BBTV,Kim,kim@bb.example,Cable\n';
  const { records } = await api('admin', 'POST', '/import/parse', { entity: 'clients', file: { name: 'c.csv', mimeType: 'text/csv', data: Buffer.from(csv).toString('base64') } });
  assert.equal(records.length, 2);
  assert.equal(records[1].name, 'Big, Bold TV');
  assert.equal(records[0].poc_name, 'Pat Lee');
  const res = await api('admin', 'POST', '/import/commit', { entity: 'clients', records: [...records, records[0]] });
  assert.equal(res.imported, 2);
  assert.equal(res.results[2].ok, false);
});

test('time follows the assignee, keeps their position, and rolls up by position and by person', async () => {
  const hh = helpers(db);
  const acct = (await api('admin', 'GET', '/accounts')).find((a) => a.billing_code === 'STRM-ED-0001');
  const jo = await personId('Jo');
  const kai = await personId('Kai');
  const t = await api('sam', 'POST', '/tickets', { board: 'ae', title: 'Screeners for press', category: 'Screeners', account_id: acct.id });
  await api('sam', 'POST', `/tickets/${t.id}/assign`, { personnel_id: jo });
  await api('jo', 'POST', `/tickets/${t.id}/status`, { status: 'In Progress' });
  // pretend Jo has been working for 2 hours
  hh.run("UPDATE time_entries SET started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours') WHERE ticket_id = ? AND ended_at IS NULL", t.id);
  // reassigned mid-clock: Jo's entry closes, Kai's opens
  await api('sam', 'POST', `/tickets/${t.id}/assign`, { personnel_id: kai });
  hh.run("UPDATE time_entries SET started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hours') WHERE ticket_id = ? AND ended_at IS NULL", t.id);
  await api('kai', 'POST', `/tickets/${t.id}/status`, { status: 'Completed' });

  const entries = (await api('sam', 'GET', `/tickets/${t.id}`)).time;
  assert.deepEqual(entries.map((e) => [e.personnel_id, e.position]).sort(), [[jo, 'Assistant Editor'], [kai, 'PA']].sort());

  // A later promotion doesn't rewrite history.
  await api('hr', 'PATCH', `/personnel/${kai}`, { position: 'Assistant Editor' });
  const summary = await api('maya', 'GET', `/time/summary?project_id=${acct.project_id}`);
  const pos = Object.fromEntries(summary.by_position.map((r) => [r.position, r.seconds]));
  assert.ok(pos['Assistant Editor'] >= 7190 && pos['Assistant Editor'] <= 7300, `AE ~2h, got ${pos['Assistant Editor']}`);
  assert.ok(pos.PA >= 3590 && pos.PA <= 3700, `PA ~1h, got ${pos.PA}`);
  assert.ok(summary.by_person.some((r) => r.personnel_id === kai && r.position === 'PA'));
  assert.ok(summary.by_account.some((r) => r.billing_code === 'STRM-ED-0001'));
  // Regular staff get position totals but not per-person hours.
  assert.equal((await api('jo', 'GET', `/time/summary?project_id=${acct.project_id}`)).by_person, undefined);

  // Time cards: your own always, others only with access.
  const mine = await api('jo', 'GET', '/timecard');
  assert.ok(mine.entries.some((e) => e.ticket_id === t.id && e.billing_code === 'STRM-ED-0001'));
  await assert.rejects(api('jo', 'GET', `/timecard?personnel_id=${kai}`), /own time card/);
  const kaiCard = await api('hr', 'GET', `/timecard?personnel_id=${kai}`);
  assert.equal(kaiCard.entries.filter((e) => e.ticket_id === t.id).length, 1);
  assert.equal(kaiCard.person.position, 'Assistant Editor');
  assert.equal(kaiCard.entries.find((e) => e.ticket_id === t.id).position, 'PA');
});

test('migration adds position columns to an older database', async () => {
  const { driver } = await import('../server/db.js');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-'));
  const file = path.join(dir, 'old.db');
  const old = new driver.Database(file);
  old.exec(`CREATE TABLE personnel (id INTEGER PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL DEFAULT '');
    CREATE TABLE time_entries (id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, personnel_id INTEGER, track TEXT NOT NULL DEFAULT 'main',
      started_at TEXT NOT NULL, ended_at TEXT, manual INTEGER NOT NULL DEFAULT 0, note TEXT, created_by INTEGER, updated_at TEXT);
    INSERT INTO personnel (id, first_name) VALUES (1, 'Old');
    INSERT INTO time_entries (ticket_id, personnel_id, started_at) VALUES (1, 1, '2026-01-01T10:00:00Z');`);
  old.close();
  const upgraded = openDb(file);
  const cols = (t) => upgraded.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  assert.ok(cols('personnel').includes('position'));
  assert.ok(cols('time_entries').includes('position'));
  assert.equal(upgraded.prepare('SELECT COUNT(*) AS n FROM time_entries').get().n, 1, 'existing time kept');
  upgraded.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
