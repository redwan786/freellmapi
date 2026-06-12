import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db/index.js';

export const databaseRouter = Router();

// Read-only browser for the local SQLite DB so the operator can inspect every
// table from the dashboard. Sensitive columns are masked server-side and never
// leave the process in the clear — encrypted key material, password/session
// hashes, and the unified API key. This router is mounted behind requireAuth.

const MASK = '••••••• (hidden)';

// Per-table columns whose values are masked before serialization.
const SENSITIVE_COLUMNS: Record<string, Set<string>> = {
  api_keys: new Set(['encrypted_key', 'iv', 'auth_tag']),
  users: new Set(['password_hash']),
  sessions: new Set(['token_hash']),
};

// settings is a key/value table; mask the value only for these keys.
const SENSITIVE_SETTING_KEYS = new Set(['unified_api_key']);

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

// The real, current set of user tables — used both to list them and to
// validate a requested table name (table names can't be parameterized, so we
// only ever interpolate a name confirmed to exist here).
function listTableNames(): string[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as Array<{ name: string }>;
  return rows.map(r => r.name);
}

function maskRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const sensitive = SENSITIVE_COLUMNS[table];
  const out: Record<string, unknown> = {};
  for (const [col, val] of Object.entries(row)) {
    if (sensitive?.has(col) && val != null) {
      out[col] = MASK;
    } else if (table === 'settings' && col === 'value' && SENSITIVE_SETTING_KEYS.has(String(row.key))) {
      out[col] = MASK;
    } else {
      out[col] = val;
    }
  }
  return out;
}

// GET /api/database — list tables with row counts.
databaseRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const tables = listTableNames().map(name => {
    const { count } = db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get() as { count: number };
    return { name, rowCount: count };
  });
  res.json({ tables });
});

// GET /api/database/:table?limit=&offset= — columns + a page of rows.
databaseRouter.get('/:table', (req: Request, res: Response) => {
  const table = String(req.params.table);
  if (!listTableNames().includes(table)) {
    res.status(404).json({ error: { message: `Unknown table: ${table}` } });
    return;
  }

  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  const offset = Math.max(0, parseInt(String(req.query.offset ?? 0), 10) || 0);

  const db = getDb();
  const columns = (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map(c => c.name);
  const { count } = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number };
  const rawRows = db.prepare(`SELECT * FROM "${table}" LIMIT ? OFFSET ?`).all(limit, offset) as Array<Record<string, unknown>>;
  const rows = rawRows.map(r => maskRow(table, r));

  res.json({ table, columns, rowCount: count, limit, offset, rows });
});
