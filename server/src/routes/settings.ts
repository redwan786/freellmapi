import { Router } from 'express';
import type { Request, Response } from 'express';
import { getUserApiKey, regenerateUserApiKey, setSetting } from '../db/index.js';
import { applyProxyUrl, applyProxyEnabled, applyProxyBypass, isProxyActive, getProxyUrl, isProxyEnabled, getProxyBypassPlatforms } from '../lib/proxy.js';

export const settingsRouter = Router();

const uid = (req: Request): number => (req as Request & { user: { userId: number } }).user.userId;

// Get this user's personal /v1 proxy key.
settingsRouter.get('/api-key', (req: Request, res: Response) => {
  res.json({ apiKey: getUserApiKey(uid(req)) });
});

// Regenerate this user's personal /v1 proxy key.
settingsRouter.post('/api-key/regenerate', (req: Request, res: Response) => {
  res.json({ apiKey: regenerateUserApiKey(uid(req)) });
});

// Get the proxy settings
settingsRouter.get('/proxy', (_req: Request, res: Response) => {
  res.json({
    proxyUrl: getProxyUrl(),
    enabled: isProxyEnabled(),
    bypassPlatforms: getProxyBypassPlatforms(),
    active: isProxyActive(),
  });
});

// Set the proxy settings. Accepts partial updates: proxyUrl, enabled, bypassPlatforms.
settingsRouter.put('/proxy', (req: Request, res: Response) => {
  const { proxyUrl, enabled, bypassPlatforms } = req.body as {
    proxyUrl?: string;
    enabled?: boolean;
    bypassPlatforms?: string[];
  };

  // --- proxyUrl ---
  if (typeof proxyUrl === 'string') {
    const trimmed = proxyUrl.trim();
    if (trimmed) {
      try {
        const u = new URL(trimmed);
        if (!['http:', 'https:', 'socks5:', 'socks4:'].includes(u.protocol)) {
          res.status(400).json({
            error: { message: 'Proxy URL must use http, https, socks5, or socks4 scheme', type: 'invalid_request_error' },
          });
          return;
        }
      } catch {
        res.status(400).json({
          error: { message: 'Invalid proxy URL — must be a valid URL like socks5://host:port', type: 'invalid_request_error' },
        });
        return;
      }
      setSetting('proxy_url', trimmed);
    } else {
      setSetting('proxy_url', '');
    }
    applyProxyUrl(trimmed);
  }

  // --- enabled ---
  if (typeof enabled === 'boolean') {
    setSetting('proxy_enabled', enabled ? '1' : '0');
    applyProxyEnabled(enabled);
  }

  // --- bypassPlatforms ---
  if (Array.isArray(bypassPlatforms)) {
    const csv = bypassPlatforms.map(s => s.trim()).filter(Boolean).join(',');
    setSetting('proxy_bypass', csv);
    applyProxyBypass(csv);
  }

  res.json({
    proxyUrl: getProxyUrl(),
    enabled: isProxyEnabled(),
    bypassPlatforms: getProxyBypassPlatforms(),
    active: isProxyActive(),
  });
});
