import crypto from 'crypto';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { migrateDbSchema } from './migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/freeapi.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function initDb(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? DB_PATH;
  const isMemory = resolvedPath === ':memory:';

  if (!isMemory) {
    const dataDir = path.dirname(resolvedPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  db = new Database(resolvedPath);
  if (!isMemory) db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrateDbSchema(db);

  console.log(`Database initialized at ${resolvedPath}`);
  return db;
}

export function getUnifiedApiKey(): string {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'unified_api_key'").get() as { value: string };
  return row.value;
}

export function regenerateUnifiedKey(): string {
  const db = getDb();
  const key = `freellmapi-${crypto.randomBytes(24).toString('hex')}`;
  db.prepare("UPDATE settings SET value = ? WHERE key = 'unified_api_key'").run(key);
  return key;
}

// Generic key/value settings accessors (used by routing strategy, etc.).
export function getSetting(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

// ── Per-user accessors (multi-tenant) ───────────────────────────────────────

// Resolve an incoming /v1 proxy api_key to its owning user id, or undefined if
// no account carries that key. Indexed unique lookup (idx_users_api_key).
export function resolveUserIdByApiKey(token: string | undefined | null): number | undefined {
  if (!token) return undefined;
  const db = getDb();
  const row = db.prepare('SELECT id FROM users WHERE api_key = ?').get(token) as { id: number } | undefined;
  return row?.id;
}

// The personal /v1 proxy key for a user (shown in the dashboard).
export function getUserApiKey(userId: number): string {
  const db = getDb();
  const row = db.prepare('SELECT api_key FROM users WHERE id = ?').get(userId) as { api_key: string | null } | undefined;
  return row?.api_key ?? '';
}

export function regenerateUserApiKey(userId: number): string {
  const db = getDb();
  const key = `freellmapi-${crypto.randomBytes(24).toString('hex')}`;
  db.prepare('UPDATE users SET api_key = ? WHERE id = ?').run(key, userId);
  return key;
}

// Per-user key/value settings (routing strategy, custom weights, default
// embedding family). Falls back to undefined; callers supply their own default.
export function getUserSetting(userId: number, key: string): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(userId, key) as { value: string } | undefined;
  return row?.value;
}

export function setUserSetting(userId: number, key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
  `).run(userId, key, value);
}
