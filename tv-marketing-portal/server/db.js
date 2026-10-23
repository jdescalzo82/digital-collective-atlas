// SQLite storage. Everything is relational so a change in one place (a client's
// prefix, a project's producer, a person's name) shows up everywhere it's referenced.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Staff',
  permissions TEXT NOT NULL DEFAULT '',
  personnel_id INTEGER REFERENCES personnel(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- Every standardizable field is a dropdown backed by this table.
CREATE TABLE IF NOT EXISTS options (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  value TEXT NOT NULL,
  code TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (category, value)
);

CREATE TABLE IF NOT EXISTS personnel (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT, phone TEXT, mobile TEXT,
  address TEXT, city TEXT, state TEXT, zip TEXT,
  emergency_name TEXT, emergency_phone TEXT,
  title TEXT,
  department TEXT,
  employment_type TEXT,
  rate REAL,
  rate_frequency TEXT,
  start_date TEXT, end_date TEXT,
  equipment_needed TEXT,
  notes TEXT,
  hr_status TEXT NOT NULL DEFAULT 'Pending Review',
  hr_notes TEXT,
  hr_verified_by INTEGER REFERENCES users(id),
  hr_verified_at TEXT,
  it_status TEXT NOT NULL DEFAULT 'Waiting on HR',
  it_system TEXT, it_software TEXT, it_hardware TEXT,
  workstation_location TEXT, it_accounts TEXT, it_notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  billing_prefix TEXT NOT NULL UNIQUE COLLATE NOCASE,
  poc_name TEXT, poc_title TEXT, poc_email TEXT, poc_phone TEXT,
  department TEXT,
  sector TEXT,
  acct_name TEXT, acct_email TEXT, acct_phone TEXT,
  birthday TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  project_number TEXT NOT NULL UNIQUE,
  official_name TEXT NOT NULL,
  code_name TEXT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  est_start TEXT, est_lock TEXT, est_delivery TEXT,
  budget REAL, est_cost REAL,
  producer_id INTEGER REFERENCES personnel(id) ON DELETE SET NULL,
  scope TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'Active',
  status_reason TEXT,
  status_changed_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS personnel_projects (
  personnel_id INTEGER NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (personnel_id, project_id)
);

-- Billing numbers: <CLIENT PREFIX>-<DEPT CODE>-<sequence>
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  department TEXT NOT NULL,
  department_code TEXT NOT NULL,
  seq INTEGER NOT NULL,
  billing_code TEXT NOT NULL UNIQUE,
  lead_producer_id INTEGER REFERENCES personnel(id) ON DELETE SET NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'Open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY,
  item_number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  media_type TEXT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  location TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY,
  item_number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  equipment_type TEXT,
  model TEXT,
  year INTEGER,
  model_number TEXT,
  serial_number TEXT,
  specs TEXT,
  assigned_to INTEGER REFERENCES personnel(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY,
  ticket_number TEXT NOT NULL UNIQUE,
  board TEXT NOT NULL CHECK (board IN ('ae','editorial','finishing')),
  title TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id),
  account_id INTEGER REFERENCES accounts(id),
  category TEXT,
  status TEXT NOT NULL DEFAULT 'Draft',
  assignee_id INTEGER REFERENCES personnel(id) ON DELETE SET NULL,
  requested_by INTEGER REFERENCES users(id),
  brief TEXT,
  due_date TEXT,
  -- editorial scheduling
  desired_editor_id INTEGER REFERENCES personnel(id) ON DELETE SET NULL,
  start_date TEXT,
  first_cut_date TEXT,
  final_lock_date TEXT,
  creative_name TEXT,
  duration TEXT,
  -- lineage: unarchive / cutdown clones and finishing requests
  parent_ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  derivative_type TEXT,
  editorial_ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  -- finishing
  picture_status TEXT,
  sound_status TEXT,
  picture_assignee_id INTEGER REFERENCES personnel(id) ON DELETE SET NULL,
  sound_assignee_id INTEGER REFERENCES personnel(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS tickets_board_status ON tickets(board, status);

CREATE TABLE IF NOT EXISTS ticket_media (
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, media_id)
);

-- Tags: people, clients, media and equipment attached to a ticket or a message.
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('personnel','client','media','equipment')),
  entity_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tags_entity ON tags(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'Note',
  body TEXT,
  link_url TEXT,
  review_status TEXT,
  status_by INTEGER REFERENCES users(id),
  status_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  personnel_id INTEGER REFERENCES personnel(id) ON DELETE SET NULL,
  track TEXT NOT NULL DEFAULT 'main',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  manual INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS time_ticket ON time_entries(ticket_id);

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  detail TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS notif_user ON notifications(user_id, read);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

// Small helpers so route code stays readable.
export function helpers(db) {
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
  return {
    all: (sql, ...p) => stmt(sql).all(...p),
    get: (sql, ...p) => stmt(sql).get(...p),
    run: (sql, ...p) => stmt(sql).run(...p),
    tx(fn) {
      db.exec('BEGIN');
      try { const r = fn(); db.exec('COMMIT'); return r; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
