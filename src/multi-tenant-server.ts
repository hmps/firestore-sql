/**
 * Multi-tenant Firestore SQL Server
 *
 * Each tenant gets their own isolated SQLite database
 */

import { serve } from 'bun';
import { TenantManager } from './tenants/tenant-manager';
import { createMultiTenantApi } from './api/multi-tenant-routes';

export interface MultiTenantServerConfig {
  /** Port to listen on */
  port?: number;
  /** Host to bind to */
  host?: string;
  /** Directory to store tenant databases */
  dataDir?: string;
  /** Maximum cached tenant connections */
  maxCachedTenants?: number;
  /** Idle timeout for tenant connections (ms) */
  idleTimeout?: number;
  /** API keys for authentication */
  apiKeys?: string[];
  /** Enable GraphQL */
  enableGraphQL?: boolean;
}

export function startMultiTenantServer(config: MultiTenantServerConfig = {}) {
  const port = config.port ?? (process.env.PORT ? Number(process.env.PORT) : 3000);
  const host = config.host ?? '0.0.0.0';
  const dataDir = config.dataDir ?? process.env.DATA_DIR ?? './data/tenants';

  // Initialize tenant manager
  const tenantManager = new TenantManager({
    dataDir,
    maxCachedTenants: config.maxCachedTenants,
    idleTimeout: config.idleTimeout,
  });

  // Get API keys from config or environment
  const apiKeys = config.apiKeys ?? (process.env.API_KEYS ? process.env.API_KEYS.split(',') : undefined);

  // Create API
  const app = createMultiTenantApi({
    tenantManager,
    apiKeys,
    enableGraphQL: config.enableGraphQL,
  });

  // Start server
  const server = serve({
    port,
    hostname: host,
    fetch: app.fetch,
  });

  console.log(`🚀 Multi-tenant Firestore SQL server running at http://${host}:${port}`);
  console.log(`📁 Tenant databases stored in: ${dataDir}`);

  return {
    server,
    tenantManager,
    close: () => {
      tenantManager.close();
    },
  };
}

// CLI entry point
if (import.meta.main) {
  const config: MultiTenantServerConfig = {};

  // Parse CLI args
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if ((arg === '-p' || arg === '--port') && next) {
      config.port = parseInt(next, 10);
      i++;
    } else if ((arg === '-d' || arg === '--data-dir') && next) {
      config.dataDir = next;
      i++;
    } else if ((arg === '-h' || arg === '--host') && next) {
      config.host = next;
      i++;
    }
  }

  startMultiTenantServer(config);
}
