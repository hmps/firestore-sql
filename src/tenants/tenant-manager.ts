/**
 * Multi-tenant database manager
 * Each tenant gets their own isolated SQLite database
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseManager } from '../core/database';
import { SchemaRegistry } from '../core/schema-registry';
import { DocumentIndexer } from '../core/document-indexer';
import { QueryEngine } from '../core/query-engine';
import { SearchEngine } from '../core/search';
import { AggregationEngine } from '../core/aggregations';

export interface TenantConfig {
  /** Base directory for tenant databases */
  dataDir: string;
  /** Maximum number of tenant connections to cache */
  maxCachedTenants?: number;
  /** Time in ms before evicting idle tenant connections */
  idleTimeout?: number;
}

export interface TenantContext {
  tenantId: string;
  db: DatabaseManager;
  schemas: SchemaRegistry;
  indexer: DocumentIndexer;
  query: QueryEngine;
  search: SearchEngine;
  aggregations: AggregationEngine;
  lastAccessed: number;
}

export class TenantManager {
  private tenants: Map<string, TenantContext> = new Map();
  private config: Required<TenantConfig>;
  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor(config: TenantConfig) {
    this.config = {
      dataDir: config.dataDir,
      maxCachedTenants: config.maxCachedTenants ?? 100,
      idleTimeout: config.idleTimeout ?? 5 * 60 * 1000, // 5 minutes
    };

    // Ensure data directory exists
    if (!existsSync(this.config.dataDir)) {
      mkdirSync(this.config.dataDir, { recursive: true });
    }

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.evictIdleTenants();
    }, 60 * 1000); // Check every minute
  }

  /**
   * Get database path for a tenant
   */
  private getDatabasePath(tenantId: string): string {
    // Sanitize tenant ID for filesystem safety
    const safeTenantId = tenantId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.config.dataDir, `${safeTenantId}.db`);
  }

  /**
   * Get or create tenant context
   */
  getTenant(tenantId: string): TenantContext {
    // Validate tenant ID
    if (!tenantId || typeof tenantId !== 'string') {
      throw new Error('Invalid tenant ID');
    }

    // Check cache
    let tenant = this.tenants.get(tenantId);
    if (tenant) {
      tenant.lastAccessed = Date.now();
      return tenant;
    }

    // Evict if at capacity
    if (this.tenants.size >= this.config.maxCachedTenants) {
      this.evictOldestTenant();
    }

    // Create new tenant context
    const dbPath = this.getDatabasePath(tenantId);
    const db = new DatabaseManager(dbPath);
    const schemas = new SchemaRegistry(db);
    const indexer = new DocumentIndexer(db, schemas);
    const query = new QueryEngine(db, schemas);
    const search = new SearchEngine(db, schemas);
    const aggregations = new AggregationEngine(db, schemas);

    tenant = {
      tenantId,
      db,
      schemas,
      indexer,
      query,
      search,
      aggregations,
      lastAccessed: Date.now(),
    };

    this.tenants.set(tenantId, tenant);
    return tenant;
  }

  /**
   * Check if tenant exists (has a database file)
   */
  tenantExists(tenantId: string): boolean {
    const dbPath = this.getDatabasePath(tenantId);
    return existsSync(dbPath);
  }

  /**
   * List all tenant IDs
   */
  listTenants(): string[] {
    const { readdirSync } = require('node:fs');
    const files = readdirSync(this.config.dataDir) as string[];
    return files
      .filter((f: string) => f.endsWith('.db'))
      .map((f: string) => f.replace('.db', ''));
  }

  /**
   * Delete a tenant and their data
   */
  deleteTenant(tenantId: string): boolean {
    // Close connection if cached
    const tenant = this.tenants.get(tenantId);
    if (tenant) {
      tenant.db.close();
      this.tenants.delete(tenantId);
    }

    // Delete database file
    const dbPath = this.getDatabasePath(tenantId);
    if (existsSync(dbPath)) {
      const { unlinkSync } = require('node:fs');
      unlinkSync(dbPath);
      // Also delete WAL and SHM files if they exist
      if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
      if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
      return true;
    }

    return false;
  }

  /**
   * Evict idle tenant connections
   */
  private evictIdleTenants(): void {
    const now = Date.now();
    for (const [tenantId, tenant] of this.tenants) {
      if (now - tenant.lastAccessed > this.config.idleTimeout) {
        tenant.db.close();
        this.tenants.delete(tenantId);
      }
    }
  }

  /**
   * Evict the oldest tenant connection
   */
  private evictOldestTenant(): void {
    let oldest: { tenantId: string; lastAccessed: number } | null = null;

    for (const [tenantId, tenant] of this.tenants) {
      if (!oldest || tenant.lastAccessed < oldest.lastAccessed) {
        oldest = { tenantId, lastAccessed: tenant.lastAccessed };
      }
    }

    if (oldest) {
      const tenant = this.tenants.get(oldest.tenantId);
      if (tenant) {
        tenant.db.close();
        this.tenants.delete(oldest.tenantId);
      }
    }
  }

  /**
   * Get stats about cached tenants
   */
  getStats(): { cachedTenants: number; totalTenants: number } {
    return {
      cachedTenants: this.tenants.size,
      totalTenants: this.listTenants().length,
    };
  }

  /**
   * Close all connections and cleanup
   */
  close(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    for (const tenant of this.tenants.values()) {
      tenant.db.close();
    }
    this.tenants.clear();
  }
}
