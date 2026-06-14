import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { resolveProvider } from '../providers/index.js';
import { encrypt, decrypt, maskKey } from '../lib/crypto.js';

export const keysRouter = Router();

// Owning user (set by requireAuth). Every key operation is scoped to it so
// users never see or touch each other's provider keys.
const uid = (req: Request): number => (req as Request & { user: { userId: number } }).user.userId;

// Active providers — must match providers/index.ts registrations + shared/types.ts Platform.
// Moonshot and MiniMax direct integrations were dropped in V4. HuggingFace
// was dropped in V4 and re-added in V13 via the router.huggingface.co route.
// SambaNova was dropped in V23 (free tier permanently retired).
const PLATFORMS = [
  'google', 'groq', 'cerebras', 'nvidia', 'mistral',
  'openrouter', 'github', 'cohere', 'cloudflare', 'zhipu', 'ollama',
  'kilo', 'pollinations', 'llm7', 'huggingface', 'opencode', 'ovh', 'custom',
] as const;

// `key` is optional so keyless providers (Kilo's anonymous gateway) can be added
// without one; the handler enforces a non-empty key for everyone else.
const addKeySchema = z.object({
  platform: z.enum(PLATFORMS),
  key: z.string().optional(),
  label: z.string().optional(),
});

const updateKeySchema = z.object({
  enabled: z.boolean().optional(),
  label: z.string().optional(),
}).refine(data => data.enabled !== undefined || data.label !== undefined, {
  message: 'At least one of enabled or label must be provided',
});

// List the current user's keys (masked)
keysRouter.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(uid(req)) as any[];

  const keys = rows.map(row => {
    let maskedKey = '****';
    try {
      const realKey = decrypt(row.encrypted_key, row.iv, row.auth_tag);
      maskedKey = maskKey(realKey);
    } catch {
      maskedKey = '[decrypt failed]';
    }
    return {
      id: row.id,
      platform: row.platform,
      label: row.label,
      maskedKey,
      baseUrl: row.base_url ?? null,
      status: row.status,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      lastCheckedAt: row.last_checked_at,
    };
  });

  res.json(keys);
});

// Add a key
keysRouter.post('/', (req: Request, res: Response) => {
  const userId = uid(req);
  const parsed = addKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const { platform, label } = parsed.data;
  const isKeyless = resolveProvider(platform)?.keyless === true;
  const rawKey = parsed.data.key?.trim() ?? '';

  if (!isKeyless && !rawKey) {
    res.status(400).json({ error: { message: 'key is required' } });
    return;
  }

  // Keyless providers (Kilo anon) store a sentinel so routing sees the platform
  // as configured; the provider omits the auth header on outgoing calls.
  const keyToStore = isKeyless ? (rawKey || 'no-key') : rawKey;

  const db = getDb();

  // A keyless provider needs only one sentinel row — re-enable an existing one
  // instead of piling up duplicates each time the user clicks "Add".
  if (isKeyless) {
    const existing = db.prepare('SELECT id FROM api_keys WHERE platform = ? AND user_id = ? LIMIT 1').get(platform, userId) as { id: number } | undefined;
    if (existing) {
      db.prepare("UPDATE api_keys SET enabled = 1, status = 'unknown' WHERE id = ?").run(existing.id);
      res.status(200).json({
        id: existing.id,
        platform,
        label: label ?? '',
        maskedKey: maskKey(keyToStore),
        status: 'unknown',
        enabled: true,
      });
      return;
    }
  }

  const { encrypted, iv, authTag } = encrypt(keyToStore);
  const result = db.prepare(`
    INSERT INTO api_keys (user_id, platform, label, encrypted_key, iv, auth_tag, status, enabled)
    VALUES (?, ?, ?, ?, ?, ?, 'unknown', 1)
  `).run(userId, platform, label ?? '', encrypted, iv, authTag);

  res.status(201).json({
    id: result.lastInsertRowid,
    platform,
    label: label ?? '',
    maskedKey: maskKey(keyToStore),
    status: 'unknown',
    enabled: true,
  });
});

// ── Custom OpenAI-compatible providers (#117, #212) ───────────────────────
// User-configured endpoints (llama.cpp / LM Studio / vLLM / Ollama / any
// OpenAI-compatible base_url). Each DISTINCT base_url gets its own 'custom'
// api_keys row, and every registered model binds to its endpoint's key via
// models.key_id — so several custom providers coexist without overwriting
// each other (#212). Re-submitting an existing base_url updates its key/label;
// re-registering an existing model id re-binds it to the submitted endpoint.
const customProviderSchema = z.object({
  baseUrl: z.string().url('baseUrl must be a valid URL'),
  model: z.string().min(1, 'model is required'),
  displayName: z.string().optional(),
  apiKey: z.string().optional(),
  label: z.string().optional(),
});

keysRouter.post('/custom', (req: Request, res: Response) => {
  const userId = uid(req);
  const parsed = customProviderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const baseUrl = parsed.data.baseUrl.trim().replace(/\/+$/, '');
  const modelId = parsed.data.model.trim();
  const displayName = (parsed.data.displayName ?? modelId).trim();
  // Local servers often need no key; keep a sentinel so there's always a bearer.
  const rawKey = parsed.data.apiKey?.trim() || 'no-key';
  const label = parsed.data.label ?? 'Custom';

  const db = getDb();
  const upsert = db.transaction(() => {
    // One 'custom' key row PER ENDPOINT (matched on base_url). Re-submitting
    // the same endpoint updates its key/label; a new base_url gets its own
    // row instead of clobbering the previous provider. (#212)
    const existing = db.prepare("SELECT id FROM api_keys WHERE platform = 'custom' AND base_url = ? AND user_id = ? LIMIT 1")
      .get(baseUrl, userId) as { id: number } | undefined;
    let keyId: number;
    if (existing) {
      const { encrypted, iv, authTag } = encrypt(rawKey);
      db.prepare("UPDATE api_keys SET label = ?, encrypted_key = ?, iv = ?, auth_tag = ?, status = 'unknown', enabled = 1 WHERE id = ?")
        .run(label, encrypted, iv, authTag, existing.id);
      keyId = existing.id;
    } else {
      const { encrypted, iv, authTag } = encrypt(rawKey);
      const r = db.prepare(`
        INSERT INTO api_keys (user_id, platform, label, encrypted_key, iv, auth_tag, status, enabled, base_url)
        VALUES (?, 'custom', ?, ?, ?, ?, 'unknown', 1, ?)
      `).run(userId, label, encrypted, iv, authTag, baseUrl);
      keyId = Number(r.lastInsertRowid);
    }

    // Register the model bound to THIS endpoint's key. Custom models carry no
    // rate limits and sort last in the intelligence preset (size_label tier).
    // Re-registering an existing model id re-binds it (model ids are unique
    // per platform, so one id can't live on two endpoints at once).
    db.prepare(`
      INSERT INTO models
        (platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
         rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window, enabled, key_id)
      VALUES ('custom', ?, ?, 50, 50, 'Custom', NULL, NULL, NULL, NULL, '', NULL, 1, ?)
      ON CONFLICT(platform, model_id)
      DO UPDATE SET display_name = excluded.display_name, key_id = excluded.key_id, enabled = 1
    `).run(modelId, displayName, keyId);

    const modelRow = db.prepare("SELECT id FROM models WHERE platform = 'custom' AND model_id = ?").get(modelId) as { id: number };

    // Append to THIS user's fallback chain if not already present.
    const inChain = db.prepare('SELECT 1 FROM fallback_config WHERE model_db_id = ? AND user_id = ?').get(modelRow.id, userId);
    if (!inChain) {
      const max = db.prepare('SELECT COALESCE(MAX(priority), 0) AS m FROM fallback_config WHERE user_id = ?').get(userId) as { m: number };
      db.prepare('INSERT INTO fallback_config (user_id, model_db_id, priority, enabled) VALUES (?, ?, ?, 1)').run(userId, modelRow.id, max.m + 1);
    }

    return { keyId, modelDbId: modelRow.id };
  });

  const { keyId, modelDbId } = upsert();
  res.status(201).json({
    success: true,
    keyId,
    modelDbId,
    platform: 'custom',
    baseUrl,
    model: modelId,
    displayName,
    maskedKey: maskKey(rawKey),
  });
});

// Delete a key
keysRouter.delete('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const db = getDb();
  const userId = uid(req);
  const row = db.prepare('SELECT platform FROM api_keys WHERE id = ? AND user_id = ?').get(id, userId) as { platform: string } | undefined;
  if (!row) {
    res.status(404).json({ error: { message: 'Key not found' } });
    return;
  }

  const remove = db.transaction(() => {
    db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
    // Custom models exist only because POST /custom registered them alongside
    // their endpoint key (#117) — they can't route without it. Cascade away
    // the models bound to THIS endpoint (#212); other custom providers keep
    // theirs. Legacy rows (key_id NULL) are swept once no custom keys remain,
    // so they never linger in the fallback chain forever (#189).
    if (row.platform === 'custom') {
      db.prepare("DELETE FROM fallback_config WHERE model_db_id IN (SELECT id FROM models WHERE platform = 'custom' AND key_id = ?)").run(id);
      db.prepare("DELETE FROM models WHERE platform = 'custom' AND key_id = ?").run(id);
      const remaining = db.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE platform = 'custom'").get() as { n: number };
      if (remaining.n === 0) {
        db.prepare("DELETE FROM fallback_config WHERE model_db_id IN (SELECT id FROM models WHERE platform = 'custom')").run();
        db.prepare("DELETE FROM models WHERE platform = 'custom'").run();
      }
    }
  });
  remove();

  res.json({ success: true });
});

// Toggle all keys for a platform
keysRouter.patch('/platform/:platform', (req: Request, res: Response) => {
  const platform = req.params.platform as string;
  if (!(PLATFORMS as readonly string[]).includes(platform)) {
    res.status(400).json({ error: { message: `Invalid platform '${platform}'` } });
    return;
  }

  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: { message: 'enabled must be a boolean' } });
    return;
  }

  const db = getDb();
  const result = db.prepare('UPDATE api_keys SET enabled = ? WHERE platform = ? AND user_id = ?').run(enabled ? 1 : 0, platform, uid(req));

  res.json({ success: true, enabled, updatedKeys: result.changes });
});

// Update key (toggle enable/disable or edit label)
keysRouter.patch('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const parsed = updateKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const { enabled, label } = parsed.data;
  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(enabled ? 1 : 0);
  }
  if (label !== undefined) {
    updates.push('label = ?');
    values.push(label);
  }

  values.push(id);
  values.push(uid(req));

  const db = getDb();
  const result = db.prepare(`UPDATE api_keys SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);

  if (result.changes === 0) {
    res.status(404).json({ error: { message: 'Key not found' } });
    return;
  }

  const response: Record<string, unknown> = { success: true };
  if (enabled !== undefined) response.enabled = enabled;
  if (label !== undefined) response.label = label;
  res.json(response);
});
