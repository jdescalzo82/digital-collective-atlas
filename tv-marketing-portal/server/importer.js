// Import records from spreadsheets (CSV/TSV/JSON) or from screenshots, PDFs and
// text documents. Structured files are parsed locally; images and documents are
// read by Claude when ANTHROPIC_API_KEY is set. Nothing is saved until a person
// reviews the extracted rows and commits them.
import Anthropic from '@anthropic-ai/sdk';
import { HttpError } from './services.js';

export const IMPORT_FIELDS = {
  personnel: ['first_name', 'last_name', 'email', 'phone', 'mobile', 'address', 'city', 'state', 'zip',
    'emergency_name', 'emergency_phone', 'title', 'department', 'employment_type', 'rate', 'rate_frequency',
    'start_date', 'end_date', 'equipment_needed', 'notes'],
  clients: ['name', 'billing_prefix', 'poc_name', 'poc_title', 'poc_email', 'poc_phone', 'department', 'sector',
    'acct_name', 'acct_email', 'acct_phone', 'birthday', 'notes'],
  projects: ['official_name', 'code_name', 'client_name', 'est_start', 'est_lock', 'est_delivery', 'budget',
    'est_cost', 'producer_name', 'scope', 'notes'],
  media: ['item_number', 'name', 'media_type', 'project_name', 'location', 'notes'],
  equipment: ['item_number', 'name', 'equipment_type', 'model', 'year', 'model_number', 'serial_number', 'specs',
    'assigned_to_name', 'notes'],
};

const FIELD_HINTS = {
  rate: 'number only, no currency symbol',
  budget: 'number only', est_cost: 'number only', year: 'four-digit year',
  scope: 'comma-separated list, e.g. "Trailer, TV, Digitals"',
  billing_prefix: '2-5 uppercase letters identifying the client, invent one from the name if absent',
  client_name: 'name of the client/studio/brand', producer_name: 'full name of the assigned producer',
  project_name: 'official name or code name of the project', assigned_to_name: 'full name of the person',
};

export function parseDelimited(text) {
  const delim = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

// Map loose spreadsheet headers ("First Name", "E-mail") onto our field names.
export function normalizeRecords(entity, records) {
  const fields = IMPORT_FIELDS[entity];
  const key = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const aliases = {
    email: ['emailaddress', 'e-mail'], phone: ['phonenumber', 'tel', 'telephone'], mobile: ['cell', 'cellphone'],
    first_name: ['first', 'firstname', 'givenname'], last_name: ['last', 'lastname', 'surname'],
    name: ['clientname', 'itemname', 'title'], official_name: ['projectname', 'project', 'title', 'name'],
    poc_name: ['pointofcontact', 'contact', 'contactname'], poc_email: ['contactemail'], poc_phone: ['contactphone'],
    acct_name: ['accountingcontact', 'accounting'], acct_email: ['accountingemail'], acct_phone: ['accountingphone'],
    client_name: ['client'], producer_name: ['producer'], project_name: ['project'], item_number: ['barcode', 'itemno', 'item', 'id'],
    assigned_to_name: ['assignedto', 'assignee', 'user'], employment_type: ['stafforfreelance', 'type'],
  };
  const lookup = new Map();
  for (const f of fields) {
    lookup.set(key(f), f);
    for (const a of aliases[f] || []) if (!lookup.has(key(a))) lookup.set(key(a), f);
  }
  return records.map((r) => {
    const out = {};
    for (const [k, v] of Object.entries(r)) {
      const f = lookup.get(key(k));
      if (f && v !== '' && v !== null && v !== undefined && out[f] === undefined) out[f] = Array.isArray(v) ? v.join(', ') : String(v);
    }
    return out;
  }).filter((r) => Object.keys(r).length);
}

function schemaFor(entity) {
  const props = {};
  for (const f of IMPORT_FIELDS[entity]) {
    props[f] = { type: ['string', 'null'], ...(FIELD_HINTS[f] ? { description: FIELD_HINTS[f] } : {}) };
  }
  return {
    type: 'object',
    properties: {
      records: {
        type: 'array',
        items: { type: 'object', properties: props, required: IMPORT_FIELDS[entity], additionalProperties: false },
      },
    },
    required: ['records'],
    additionalProperties: false,
  };
}

let client;
export function aiAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

async function extractWithClaude(entity, { mimeType, data, text }) {
  if (!aiAvailable()) {
    throw new HttpError(400, 'Reading screenshots and documents needs ANTHROPIC_API_KEY set on the server. CSV, TSV and JSON files work without it.');
  }
  client ??= new Anthropic();
  const content = [];
  if (text) content.push({ type: 'text', text: `<document>\n${text}\n</document>` });
  else if (mimeType === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
  else if (/^image\/(png|jpeg|gif|webp)$/.test(mimeType)) content.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data } });
  else throw new HttpError(400, `Unsupported file type ${mimeType}`);
  content.push({
    type: 'text',
    text: `Extract every ${entity} record from this ${text ? 'document' : 'file'} for a post-production company's database. `
      + 'Use null for anything not present; do not guess contact details. Dates as YYYY-MM-DD. '
      + `Fields: ${IMPORT_FIELDS[entity].join(', ')}.`,
  });
  let response;
  try {
    response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: schemaFor(entity) } },
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(502, 'The Anthropic API key was rejected');
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(503, 'Import service is busy, try again in a minute');
    if (err instanceof Anthropic.APIError) throw new HttpError(502, `Import service error: ${err.message}`);
    throw err;
  }
  if (response.stop_reason === 'refusal') throw new HttpError(422, 'The file could not be processed');
  if (response.stop_reason === 'max_tokens') throw new HttpError(422, 'The file has too many records for one import; split it up');
  const out = response.content.find((b) => b.type === 'text')?.text;
  try {
    return JSON.parse(out).records.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== '')));
  } catch {
    throw new HttpError(422, 'Could not read records from the file');
  }
}

// file: { name, mimeType, data (base64) } or { text } for pasted content.
export async function parseImport(entity, file) {
  if (!IMPORT_FIELDS[entity]) throw new HttpError(400, 'Unknown import type');
  const name = String(file.name || '').toLowerCase();
  const mime = file.mimeType || '';
  let text = file.text;
  if (!text && (mime.startsWith('text/') || mime === 'application/json' || /\.(csv|tsv|txt|json|md)$/.test(name))) {
    text = Buffer.from(file.data || '', 'base64').toString('utf8');
  }
  if (text !== undefined) {
    const trimmed = text.trim();
    if (/\.json$/.test(name) || trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        return normalizeRecords(entity, Array.isArray(parsed) ? parsed : parsed.records || [parsed]);
      } catch { /* not JSON after all */ }
    }
    const firstLine = trimmed.split('\n')[0] || '';
    if (/\.(csv|tsv)$/.test(name) || /[,\t]/.test(firstLine)) {
      const recs = normalizeRecords(entity, parseDelimited(trimmed));
      if (recs.length) return recs;
    }
    return extractWithClaude(entity, { text: trimmed });
  }
  return extractWithClaude(entity, { mimeType: mime, data: file.data });
}
