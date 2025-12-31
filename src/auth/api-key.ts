/**
 * API Key authentication middleware
 */

import { createMiddleware } from 'hono/factory';
import type { Context, Next } from 'hono';

export interface ApiKeyConfig {
  /** List of valid API keys */
  apiKeys: string[];
  /** Header name to check for API key */
  headerName?: string;
  /** Query parameter name to check for API key */
  queryParam?: string;
  /** Paths to exclude from authentication */
  excludePaths?: string[];
}

/**
 * Create API key authentication middleware
 */
export function apiKeyAuth(config: ApiKeyConfig) {
  const headerName = config.headerName ?? 'x-api-key';
  const queryParam = config.queryParam ?? 'api_key';
  const excludePaths = config.excludePaths ?? ['/health', '/graphql'];

  return createMiddleware(async (c: Context, next: Next) => {
    const path = c.req.path;

    // Check if path is excluded
    if (excludePaths.some((p) => path.startsWith(p))) {
      return next();
    }

    // Try to get API key from header
    let apiKey = c.req.header(headerName);

    // Fallback to query parameter
    if (!apiKey) {
      apiKey = c.req.query(queryParam);
    }

    // Fallback to Authorization header (Bearer token)
    if (!apiKey) {
      const authHeader = c.req.header('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        apiKey = authHeader.slice(7);
      }
    }

    // Validate API key
    if (!apiKey) {
      return c.json(
        { error: 'Missing API key', hint: `Provide via ${headerName} header or ${queryParam} query param` },
        401
      );
    }

    if (!config.apiKeys.includes(apiKey)) {
      return c.json({ error: 'Invalid API key' }, 403);
    }

    // Add API key to context for logging/auditing
    c.set('apiKey', apiKey);

    return next();
  });
}

/**
 * Generate a random API key
 */
export function generateApiKey(prefix: string = 'fssql'): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = '';
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}_${key}`;
}
