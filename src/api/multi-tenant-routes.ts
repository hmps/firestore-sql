/**
 * Multi-tenant API routes
 *
 * All routes are scoped to a tenant via header, query param, or path
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { TenantManager } from '../tenants/tenant-manager';
import { tenantMiddleware, getTenant } from '../tenants/tenant-middleware';
import { apiKeyAuth } from '../auth/api-key';
import { createGraphQLHandler } from './graphql';

export interface MultiTenantApiConfig {
  /** Tenant manager instance */
  tenantManager: TenantManager;
  /** API keys for authentication (if empty, auth is disabled) */
  apiKeys?: string[];
  /** Enable GraphQL endpoint */
  enableGraphQL?: boolean;
}

export function createMultiTenantApi(config: MultiTenantApiConfig) {
  const app = new Hono();

  // Enable CORS
  app.use('*', cors());

  // Health check (no tenant required)
  app.get('/health', (c) => {
    const stats = config.tenantManager.getStats();
    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      multiTenant: true,
      ...stats,
    });
  });

  // Tenant management endpoints (no tenant context required)
  app.get('/tenants', (c) => {
    const tenants = config.tenantManager.listTenants();
    return c.json({ tenants, count: tenants.length });
  });

  app.get('/tenants/:tenantId', (c) => {
    const tenantId = c.req.param('tenantId');
    const exists = config.tenantManager.tenantExists(tenantId);
    if (!exists) {
      return c.json({ error: 'Tenant not found' }, 404);
    }
    const tenant = config.tenantManager.getTenant(tenantId);
    return c.json({
      tenantId,
      schemas: tenant.schemas.getAll().map((s) => s.collection),
    });
  });

  app.delete('/tenants/:tenantId', (c) => {
    const tenantId = c.req.param('tenantId');
    const deleted = config.tenantManager.deleteTenant(tenantId);
    return c.json({ deleted, tenantId });
  });

  // API key auth (if configured)
  if (config.apiKeys && config.apiKeys.length > 0) {
    app.use(
      '*',
      apiKeyAuth({
        apiKeys: config.apiKeys,
        excludePaths: ['/health', '/tenants'],
      })
    );
  }

  // Tenant middleware for all other routes
  app.use(
    '*',
    tenantMiddleware({
      tenantManager: config.tenantManager,
      excludePaths: ['/health', '/tenants'],
    })
  );

  // Schema routes
  app.get('/schemas', (c) => {
    const tenant = getTenant(c);
    return c.json({ schemas: tenant.schemas.getAll() });
  });

  app.post('/schemas/:collection', async (c) => {
    const tenant = getTenant(c);
    const collection = c.req.param('collection');
    const body = await c.req.json();

    const schema = tenant.schemas.register({ collection, fields: body.fields });
    return c.json({ schema }, 201);
  });

  app.post('/schemas/:collection/infer', async (c) => {
    const tenant = getTenant(c);
    const collection = c.req.param('collection');
    const body = await c.req.json();

    const schema = tenant.schemas.registerFromDocument(collection, body);
    return c.json({ schema, inferred: true }, 201);
  });

  app.get('/schemas/:collection', (c) => {
    const tenant = getTenant(c);
    const collection = c.req.param('collection');
    const schema = tenant.schemas.get(collection);

    if (!schema) {
      return c.json({ error: 'Schema not found' }, 404);
    }

    return c.json({ schema });
  });

  app.delete('/schemas/:collection', (c) => {
    const tenant = getTenant(c);
    const collection = c.req.param('collection');
    const deleted = tenant.schemas.delete(collection);
    return c.json({ deleted });
  });

  // Document routes
  app.post('/documents/:collection/:id', async (c) => {
    const tenant = getTenant(c);
    const collection = c.req.param('collection');
    const id = c.req.param('id');
    const data = await c.req.json();

    const result = tenant.indexer.index(collection, id, data);
    return c.json({ indexed: result.success, documentId: id, error: result.error });
  });

  app.post('/documents/:collection', async (c) => {
    const tenant = getTenant(c);
    const collection = c.req.param('collection');
    const documents = await c.req.json();

    if (!Array.isArray(documents)) {
      return c.json({ error: 'Expected array of documents' }, 400);
    }

    const result = tenant.indexer.indexBulk(collection, documents);
    return c.json(result);
  });

  app.delete('/documents/:collection/:id', (c) => {
    const tenant = getTenant(c);
    const collection = c.req.param('collection');
    const id = c.req.param('id');

    const deleted = tenant.indexer.delete(collection, id);
    return c.json({ deleted, documentId: id });
  });

  // Query routes
  app.post('/query/:collection', async (c) => {
    const tenant = getTenant(c);
    const collection = c.req.param('collection');
    const body = await c.req.json();

    const result = tenant.query.execute({
      collection,
      ...body,
    });

    return c.json(result);
  });

  app.post('/count/:collection', async (c) => {
    const tenant = getTenant(c);
    const collection = c.req.param('collection');
    const body = await c.req.json();

    const count = tenant.query.count(collection, body.filters);
    return c.json({ count, collection });
  });

  app.get('/distinct/:collection/:field', (c) => {
    const tenant = getTenant(c);
    const collection = c.req.param('collection');
    const field = c.req.param('field');

    const values = tenant.query.distinct(collection, field);
    return c.json({ field, values, count: values.length });
  });

  // Search routes
  app.post('/search/:collection/index', (c) => {
    const tenant = getTenant(c);
    const collection = c.req.param('collection');

    tenant.search.createSearchIndex(collection);
    return c.json({ success: true, collection });
  });

  app.delete('/search/:collection/index', (c) => {
    const tenant = getTenant(c);
    const collection = c.req.param('collection');

    tenant.search.dropSearchIndex(collection);
    return c.json({ success: true, collection });
  });

  app.post('/search/:collection', async (c) => {
    const tenant = getTenant(c);
    const collection = c.req.param('collection');
    const body = await c.req.json();

    const result = tenant.search.search(collection, body.query, {
      limit: body.limit,
      offset: body.offset,
      highlight: body.highlight,
    });

    return c.json(result);
  });

  // Aggregation routes
  app.post('/aggregate/:collection', async (c) => {
    const tenant = getTenant(c);
    const collection = c.req.param('collection');
    const body = await c.req.json();

    const result = tenant.aggregations.aggregate({
      collection,
      ...body,
    });

    return c.json(result);
  });

  app.post('/aggregate/:collection/stats', async (c) => {
    const tenant = getTenant(c);
    const collection = c.req.param('collection');
    const body = await c.req.json();

    const stats = tenant.aggregations.stats(collection, body.field, body.filters);
    return c.json(stats);
  });

  // GraphQL endpoint (optional)
  if (config.enableGraphQL !== false) {
    app.all('/graphql', async (c) => {
      const tenant = getTenant(c);
      const handler = createGraphQLHandler({
        db: tenant.db,
        schemas: tenant.schemas,
        query: tenant.query,
        indexer: tenant.indexer,
      });
      return handler({ request: c.req.raw });
    });
  }

  return app;
}
