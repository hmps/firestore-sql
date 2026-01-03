/**
 * Tests for multi-tenant functionality
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { TenantManager } from '../src/tenants/tenant-manager';
import { createMultiTenantApi } from '../src/api/multi-tenant-routes';

const TEST_DATA_DIR = './test-data-tenants';

describe('TenantManager', () => {
  let manager: TenantManager;

  beforeAll(() => {
    // Clean up any existing test data
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  beforeEach(() => {
    manager = new TenantManager({ dataDir: TEST_DATA_DIR });
  });

  afterEach(() => {
    manager.close();
  });

  afterAll(() => {
    // Clean up test data
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  it('should create data directory if not exists', () => {
    expect(existsSync(TEST_DATA_DIR)).toBe(true);
  });

  it('should get tenant context', () => {
    const tenant = manager.getTenant('customer-123');

    expect(tenant.tenantId).toBe('customer-123');
    expect(tenant.db).toBeDefined();
    expect(tenant.schemas).toBeDefined();
    expect(tenant.indexer).toBeDefined();
    expect(tenant.query).toBeDefined();
    expect(tenant.search).toBeDefined();
    expect(tenant.aggregations).toBeDefined();
  });

  it('should create separate database files per tenant', () => {
    manager.getTenant('tenant-a');
    manager.getTenant('tenant-b');

    expect(existsSync(join(TEST_DATA_DIR, 'tenant-a.db'))).toBe(true);
    expect(existsSync(join(TEST_DATA_DIR, 'tenant-b.db'))).toBe(true);
  });

  it('should cache tenant connections', () => {
    const tenant1 = manager.getTenant('cached-tenant');
    const tenant2 = manager.getTenant('cached-tenant');

    // Should be the same instance
    expect(tenant1).toBe(tenant2);
  });

  it('should isolate data between tenants', () => {
    // Tenant A
    const tenantA = manager.getTenant('isolation-a');
    tenantA.schemas.register({ collection: 'users', fields: { name: 'string' } });
    tenantA.indexer.index('users', 'user1', { name: 'Alice' });

    // Tenant B
    const tenantB = manager.getTenant('isolation-b');
    tenantB.schemas.register({ collection: 'users', fields: { name: 'string' } });
    tenantB.indexer.index('users', 'user1', { name: 'Bob' });

    // Query each tenant
    const resultA = tenantA.query.execute({ collection: 'users' });
    const resultB = tenantB.query.execute({ collection: 'users' });

    expect(resultA.documents[0].name).toBe('Alice');
    expect(resultB.documents[0].name).toBe('Bob');
  });

  it('should list all tenants', () => {
    manager.getTenant('list-tenant-1');
    manager.getTenant('list-tenant-2');

    const tenants = manager.listTenants();
    expect(tenants).toContain('list-tenant-1');
    expect(tenants).toContain('list-tenant-2');
  });

  it('should check if tenant exists', () => {
    manager.getTenant('exists-tenant');

    expect(manager.tenantExists('exists-tenant')).toBe(true);
    expect(manager.tenantExists('nonexistent-tenant')).toBe(false);
  });

  it('should delete tenant and their data', () => {
    manager.getTenant('delete-tenant');
    expect(manager.tenantExists('delete-tenant')).toBe(true);

    const deleted = manager.deleteTenant('delete-tenant');
    expect(deleted).toBe(true);
    expect(manager.tenantExists('delete-tenant')).toBe(false);
  });

  it('should get stats', () => {
    manager.getTenant('stats-tenant-1');
    manager.getTenant('stats-tenant-2');

    const stats = manager.getStats();
    expect(stats.cachedTenants).toBeGreaterThanOrEqual(2);
    expect(stats.totalTenants).toBeGreaterThanOrEqual(2);
  });

  it('should sanitize tenant IDs for filesystem safety', () => {
    // Tenant with special characters
    const tenant = manager.getTenant('tenant/with:special@chars');

    // Should create a sanitized filename
    expect(tenant.tenantId).toBe('tenant/with:special@chars');
    expect(existsSync(join(TEST_DATA_DIR, 'tenant_with_special_chars.db'))).toBe(true);
  });

  it('should throw error for invalid tenant ID', () => {
    expect(() => {
      manager.getTenant('');
    }).toThrow('Invalid tenant ID');
  });
});

describe('Multi-tenant API', () => {
  let manager: TenantManager;
  let app: ReturnType<typeof createMultiTenantApi>;

  beforeAll(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  beforeEach(() => {
    manager = new TenantManager({ dataDir: TEST_DATA_DIR });
    app = createMultiTenantApi({ tenantManager: manager });
  });

  afterEach(() => {
    manager.close();
  });

  afterAll(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  describe('Health', () => {
    it('GET /health should return multi-tenant status', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.multiTenant).toBe(true);
    });
  });

  describe('Tenant Management', () => {
    it('GET /tenants should list tenants', async () => {
      // Create some tenants first
      manager.getTenant('api-tenant-1');
      manager.getTenant('api-tenant-2');

      const res = await app.request('/tenants');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.tenants).toContain('api-tenant-1');
      expect(data.tenants).toContain('api-tenant-2');
    });

    it('GET /tenants/:tenantId should return tenant info', async () => {
      const tenant = manager.getTenant('info-tenant');
      tenant.schemas.register({ collection: 'orders', fields: { total: 'number' } });

      const res = await app.request('/tenants/info-tenant');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.tenantId).toBe('info-tenant');
      expect(data.schemas).toContain('orders');
    });

    it('DELETE /tenants/:tenantId should delete tenant', async () => {
      manager.getTenant('to-delete-tenant');

      const res = await app.request('/tenants/to-delete-tenant', { method: 'DELETE' });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.deleted).toBe(true);
    });
  });

  describe('Tenant-scoped Operations', () => {
    it('should require tenant ID for scoped routes', async () => {
      const res = await app.request('/schemas');
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe('Missing tenant ID');
    });

    it('should accept tenant ID via header', async () => {
      const res = await app.request('/schemas', {
        headers: { 'x-tenant-id': 'header-tenant' },
      });
      expect(res.status).toBe(200);
    });

    it('should accept tenant ID via query param', async () => {
      const res = await app.request('/schemas?tenant_id=query-tenant');
      expect(res.status).toBe(200);
    });

    it('should create schema for specific tenant', async () => {
      const res = await app.request('/schemas/products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': 'schema-tenant',
        },
        body: JSON.stringify({
          fields: { name: 'string', price: 'number' },
        }),
      });
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.schema.collection).toBe('products');
    });

    it('should index documents for specific tenant', async () => {
      // Create schema first
      await app.request('/schemas/items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': 'index-tenant',
        },
        body: JSON.stringify({ fields: { name: 'string' } }),
      });

      // Index document
      const res = await app.request('/documents/items/item1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': 'index-tenant',
        },
        body: JSON.stringify({ name: 'Widget' }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.indexed).toBe(true);
    });

    it('should query documents for specific tenant', async () => {
      const tenantId = 'query-tenant';

      // Setup: create schema and index documents
      await app.request('/schemas/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ fields: { name: 'string', price: 'number' } }),
      });

      await app.request('/documents/products/p1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ name: 'Product A', price: 100 }),
      });

      await app.request('/documents/products/p2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ name: 'Product B', price: 200 }),
      });

      // Query
      const res = await app.request('/query/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ filters: { field: 'price', operator: '>=', value: 150 } }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.documents.length).toBe(1);
      expect(data.documents[0].name).toBe('Product B');
    });

    it('should isolate data between tenants via API', async () => {
      // Tenant A
      await app.request('/schemas/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-a' },
        body: JSON.stringify({ fields: { name: 'string' } }),
      });
      await app.request('/documents/users/u1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-a' },
        body: JSON.stringify({ name: 'Alice' }),
      });

      // Tenant B
      await app.request('/schemas/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-b' },
        body: JSON.stringify({ fields: { name: 'string' } }),
      });
      await app.request('/documents/users/u1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-b' },
        body: JSON.stringify({ name: 'Bob' }),
      });

      // Query Tenant A
      const resA = await app.request('/query/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-a' },
        body: JSON.stringify({}),
      });
      const dataA = await resA.json();
      expect(dataA.documents.length).toBe(1);
      expect(dataA.documents[0].name).toBe('Alice');

      // Query Tenant B
      const resB = await app.request('/query/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-b' },
        body: JSON.stringify({}),
      });
      const dataB = await resB.json();
      expect(dataB.documents.length).toBe(1);
      expect(dataB.documents[0].name).toBe('Bob');
    });
  });

  describe('API Key Auth with Multi-tenant', () => {
    let authApp: ReturnType<typeof createMultiTenantApi>;

    beforeEach(() => {
      authApp = createMultiTenantApi({
        tenantManager: manager,
        apiKeys: ['test-key-456'],
      });
    });

    it('should allow /health without API key', async () => {
      const res = await authApp.request('/health');
      expect(res.status).toBe(200);
    });

    it('should allow /tenants without API key', async () => {
      const res = await authApp.request('/tenants');
      expect(res.status).toBe(200);
    });

    it('should require API key for tenant-scoped routes', async () => {
      const res = await authApp.request('/schemas', {
        headers: { 'x-tenant-id': 'auth-tenant' },
      });
      expect(res.status).toBe(401);
    });

    it('should allow with valid API key', async () => {
      const res = await authApp.request('/schemas', {
        headers: {
          'x-tenant-id': 'auth-tenant',
          'x-api-key': 'test-key-456',
        },
      });
      expect(res.status).toBe(200);
    });
  });
});
