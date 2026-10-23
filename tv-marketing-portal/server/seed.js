// First-run setup: dropdown options and an admin login. `--demo` adds sample data.
import { helpers } from './db.js';
import { DEFAULT_OPTIONS } from './workflow.js';
import { createServices, hashPassword } from './services.js';

export function seedBase(db, { adminPassword = 'admin' } = {}) {
  const h = helpers(db);
  if (!h.get('SELECT COUNT(*) AS n FROM options').n) {
    for (const [category, values] of Object.entries(DEFAULT_OPTIONS)) {
      values.forEach((v, i) => {
        const [value, code] = Array.isArray(v) ? v : [v, null];
        h.run('INSERT INTO options (category, value, code, sort) VALUES (?,?,?,?)', category, value, code, i);
      });
    }
  }
  if (!h.get('SELECT COUNT(*) AS n FROM users').n) {
    h.run("INSERT INTO users (username, display_name, password_hash, role, permissions) VALUES ('admin', 'Administrator', ?, 'Admin', 'admin')", hashPassword(adminPassword));
    return true;
  }
  return false;
}

export function seedDemo(db) {
  const h = helpers(db);
  if (h.get('SELECT COUNT(*) AS n FROM clients').n) return;
  const svc = createServices(h);
  const admin = h.get("SELECT * FROM users WHERE username = 'admin'");
  const person = (first, last, title, department, type, extra = {}) => Number(h.run(
    `INSERT INTO personnel (first_name, last_name, email, phone, title, department, employment_type, rate, rate_frequency, start_date, hr_status, it_status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    first, last, `${first.toLowerCase()}.${last.toLowerCase()}@example.com`, '555-0100', title, department, type,
    extra.rate ?? null, extra.freq ?? null, extra.start ?? '2026-01-05', extra.hr ?? 'Sent to IT', extra.it ?? 'Ready').lastInsertRowid);

  const maya = person('Maya', 'Chen', 'Senior Producer', 'Creative', 'Staff', { rate: 145000, freq: 'Annual' });
  const leo = person('Leo', 'Alvarez', 'Senior Editor', 'Editorial', 'Staff', { rate: 160000, freq: 'Annual' });
  const priya = person('Priya', 'Nair', 'Editor', 'Editorial', 'Freelance', { rate: 950, freq: 'Daily' });
  const sam = person('Sam', 'Okafor', 'Assistant Editor', 'Assistant Editorial', 'Staff', { rate: 68000, freq: 'Annual' });
  const jo = person('Jo', 'Park', 'Assistant Editor', 'Assistant Editorial', 'Freelance', { rate: 45, freq: 'Hourly' });
  const rae = person('Rae', 'Morgan', 'Finishing Artist', 'Finishing', 'Staff', { rate: 120000, freq: 'Annual' });
  const dev = person('Dev', 'Shah', 'Mixer', 'Audio', 'Freelance', { rate: 1200, freq: 'Daily' });
  person('Alex', 'Rivera', 'Editor', 'Editorial', 'Freelance', { rate: 900, freq: 'Daily', start: '2026-11-02', hr: 'Pending Review', it: 'Waiting on HR' });

  const user = (username, name, role, perms, pid) => h.run(
    'INSERT INTO users (username, display_name, password_hash, role, permissions, personnel_id) VALUES (?,?,?,?,?,?)',
    username, name, hashPassword('password'), role, perms, pid);
  user('maya', 'Maya Chen', 'Producer', 'onboarding,view_financials,manage_editorial,import', maya);
  user('leo', 'Leo Alvarez', 'Editor', '', leo);
  user('priya', 'Priya Nair', 'Editor', '', priya);
  user('sam', 'Sam Okafor', 'AE Lead', 'manage_ae', sam);
  user('jo', 'Jo Park', 'Assistant Editor', '', jo);
  user('rae', 'Rae Morgan', 'Finishing Lead', 'manage_finishing', rae);
  user('dev', 'Dev Shah', 'Mixer', '', dev);
  user('hr', 'Harper Reyes', 'HR', 'hr', null);
  user('it', 'Ivan Tran', 'IT', 'it', null);

  const client = (name, prefix, sector, poc) => Number(h.run(
    `INSERT INTO clients (name, billing_prefix, sector, department, poc_name, poc_email, acct_name, acct_email)
     VALUES (?,?,?,?,?,?,?,?)`, name, prefix, sector, 'Creative Advertising', poc, `${poc.split(' ')[0].toLowerCase()}@${prefix.toLowerCase()}.example`,
    'Accounts Payable', `ap@${prefix.toLowerCase()}.example`).lastInsertRowid);
  const nova = client('Nova Pictures', 'NOVA', 'Theatrical', 'Dana Whitfield');
  const stream = client('Streamline+', 'STRM', 'Streaming', 'Marcus Bell');

  const project = (official, code, clientId, scope, start, lock, delivery, budget, cost) => {
    const r = h.run(`INSERT INTO projects (project_number, official_name, code_name, client_id, est_start, est_lock, est_delivery, budget, est_cost, producer_id, scope)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, svc.nextProjectNumber(), official, code, clientId, start, lock, delivery, budget, cost, maya, JSON.stringify(scope));
    return Number(r.lastInsertRowid);
  };
  const p1 = project('Midnight Harbor', 'LIGHTHOUSE', nova, ['Trailer', 'TV', 'Digitals'], '2026-10-12', '2026-11-20', '2026-12-04', 250000, 182000);
  const p2 = project('Season 3 Launch — The Orchard', 'APPLESEED', stream, ['Trailer', 'Key Art', 'Sizzle'], '2026-10-26', '2026-12-01', '2026-12-15', 140000, 121500);
  for (const [pid, ids] of [[p1, [leo, priya, sam, jo, rae, dev]], [p2, [priya, jo]]]) {
    for (const id of ids) h.run('INSERT INTO personnel_projects VALUES (?,?)', id, pid);
  }
  const a1 = svc.createAccount({ project_id: p1, department: 'Editorial' }, admin);
  svc.createAccount({ project_id: p1, department: 'Finishing' }, admin);
  const a3 = svc.createAccount({ project_id: p2, department: 'Editorial' }, admin);

  const media = (name, type, pid) => Number(h.run('INSERT INTO media (item_number, name, media_type, project_id, location) VALUES (?,?,?,?,?)',
    svc.nextItemNumber('media', 'MED'), name, type, pid, 'Vault A').lastInsertRowid);
  const m1 = media('Midnight Harbor — Dailies Drive 1', 'Hard Drive', p1);
  media('Midnight Harbor — Studio Screener', 'Blu-ray', p1);
  const equip = (name, type, model, year, assigned) => h.run(
    'INSERT INTO equipment (item_number, name, equipment_type, model, year, model_number, specs, assigned_to) VALUES (?,?,?,?,?,?,?,?)',
    svc.nextItemNumber('equipment', 'EQ'), name, type, model, year, 'A2901', 'M2 Ultra, 128GB RAM, 2TB SSD', assigned);
  equip('Bay 1 Workstation', 'Workstation', 'Mac Studio', 2024, leo);
  equip('AE Pod Workstation', 'Workstation', 'Mac Studio', 2023, sam);

  const ed = svc.createTicket('editorial', {
    title: 'Midnight Harbor — Trailer 1', account_id: a1.id, desired_editor_id: leo, creative_name: 'Trailer 1 "Tide"',
    duration: '2:30', start_date: '2026-10-19', first_cut_date: '2026-11-02', final_lock_date: '2026-11-20',
    brief: 'Theatrical trailer 1. Mood: tense, oceanic. Music: score temp from the film. Avoid spoilers past act 2.',
    media_ids: [m1], tags: [{ entity_type: 'client', entity_id: nova }],
  }, admin);
  svc.assign(ed.id, leo, admin);
  svc.changeStatus(ed.id, 'In Progress', admin);

  svc.createTicket('editorial', {
    title: 'The Orchard — Teaser', account_id: a3.id, desired_editor_id: priya, creative_name: 'Teaser "Harvest"', duration: '1:00',
    start_date: '2026-10-28', first_cut_date: '2026-11-06', final_lock_date: '2026-11-18',
    brief: 'First look teaser for S3.',
  }, admin);

  const ae = svc.createTicket('ae', { title: 'Ingest dailies drive 1', category: 'Ingest', account_id: a1.id, media_ids: [m1] }, admin);
  svc.assign(ae.id, sam, admin);
  svc.createTicket('ae', { title: 'Cue sheet — Trailer 1', category: 'Cue Sheets', account_id: a1.id }, admin);
}
