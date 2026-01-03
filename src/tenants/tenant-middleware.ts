/**
 * Tenant middleware for multi-tenant API routing
 */

import { createMiddleware } from 'hono/factory';
import type { Context, Next } from 'hono';
import type { TenantManager, TenantContext } from './tenant-manager';

export interface TenantMiddlewareConfig {
  /** TenantManager instance */
  tenantManager: TenantManager;
  /** Header name to extract tenant ID from */
  headerName?: string;
  /** Query parameter name to extract tenant ID from */
  queryParam?: string;
  /** Extract tenant from URL path (e.g., /tenants/:tenantId/...) */
  pathParam?: string;
  /** Paths to exclude from tenant resolution */
  excludePaths?: string[];
}

declare module 'hono' {
  interface ContextVariableMap {
    tenant: TenantContext;
    tenantId: string;
  }
}

/**
 * Create tenant resolution middleware
 *
 * Extracts tenant ID from request and adds tenant context to the request.
 * Priority: path param > header > query param
 */
export function tenantMiddleware(config: TenantMiddlewareConfig) {
  const headerName = config.headerName ?? 'x-tenant-id';
  const queryParam = config.queryParam ?? 'tenant_id';
  const pathParam = config.pathParam;
  const excludePaths = config.excludePaths ?? ['/health', '/tenants'];

  return createMiddleware(async (c: Context, next: Next) => {
    const path = c.req.path;

    // Check if path is excluded
    if (excludePaths.some((p) => path === p || path.startsWith(`${p}/`))) {
      return next();
    }

    let tenantId: string | undefined;

    // Try path param first (e.g., /tenants/:tenantId/schemas)
    if (pathParam) {
      tenantId = c.req.param(pathParam);
    }

    // Try header
    if (!tenantId) {
      tenantId = c.req.header(headerName);
    }

    // Try query param
    if (!tenantId) {
      tenantId = c.req.query(queryParam);
    }

    // Validate tenant ID
    if (!tenantId) {
      return c.json(
        {
          error: 'Missing tenant ID',
          hint: `Provide via ${headerName} header, ${queryParam} query param, or path`,
        },
        400
      );
    }

    try {
      // Get tenant context
      const tenant = config.tenantManager.getTenant(tenantId);

      // Add to request context
      c.set('tenant', tenant);
      c.set('tenantId', tenantId);

      return next();
    } catch (error) {
      return c.json(
        { error: 'Failed to resolve tenant', details: String(error) },
        500
      );
    }
  });
}

/**
 * Helper to get tenant context from request
 */
export function getTenant(c: Context): TenantContext {
  const tenant = c.get('tenant');
  if (!tenant) {
    throw new Error('Tenant context not available. Ensure tenantMiddleware is configured.');
  }
  return tenant;
}
