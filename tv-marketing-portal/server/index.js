import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, driver } from './db.js';
import { createApp } from './app.js';
import { seedBase, seedDemo } from './seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbFile = process.env.DB_FILE || path.join(here, '..', 'data', 'portal.db');
const db = openDb(dbFile);

const created = seedBase(db, { adminPassword: process.env.ADMIN_PASSWORD || 'admin' });
if (process.argv.includes('--demo')) seedDemo(db);

const port = Number(process.env.PORT) || 3000;
createApp(db).listen(port, () => {
  console.log(`Production portal running on port ${port}${process.env.BASE_PATH ? ` under ${process.env.BASE_PATH}` : ''}  (database: ${dbFile}, ${driver.name})`);
  if (created) console.log('First run: sign in as admin / ' + (process.env.ADMIN_PASSWORD ? '(ADMIN_PASSWORD)' : 'admin') + ' and change the password.');
});
