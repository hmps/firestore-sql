/**
 * REST API routes for Firestore SQL Bridge
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import type { DatabaseManager } from '../core/database';
import type { SchemaRegistry } from '../core/schema-registry';
import type { DocumentIndexer } from '../core/document-indexer';
import type { QueryEngine } from '../core/query-engine';
import type { FirestoreClient } from '../firestore/client';
import type { SearchEngine } from '../core/search';
import type { AggregationEngine } from '../core/aggregations';
import type { IndexQueue } from '../queue/index-queue';
import type {
  FilterCondition,
  FilterGroup,
  FieldType,
  SortSpec,
} from '../core/types';
import { createGraphQLHandler } from './graphql';
import { apiKeyAuth } from '../auth/api-key';

// Zod schemas for validation
const FieldTypeSchema = z.enum(['string', 'number', 'boolean', 'datetime']);

const FieldDefinitionSchema = z.union([
  FieldTypeSchema,
  z.object({
    type: FieldTypeSchema,
    nullable: z.boolean().optional(),
    indexed: z.boolean().optional(),
  }),
]);

const SchemaInputSchema = z.object({
  fields: z.record(z.string(), FieldDefinitionSchema),
});

const DocumentDataSchema = z.record(z.string(), z.unknown());

const BulkDocumentsSchema = z.array(
  z.object({
    id: z.string(),
    data: DocumentDataSchema,
  })
);

const ComparisonOperatorSchema = z.enum([
  '=',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'LIKE',
  'IN',
  'NOT IN',
  'IS NULL',
  'IS NOT NULL',
]);

const FilterConditionSchema: z.ZodType<FilterCondition> = z.object({
  field: z.string(),
  operator: ComparisonOperatorSchema,
  value: z.unknown(),
});

const LogicalOperatorSchema = z.enum(['AND', 'OR']);

const FilterGroupSchema: z.ZodType<FilterGroup> = z.lazy(() =>
  z.object({
    operator: LogicalOperatorSchema,
    conditions: z.array(z.union([FilterConditionSchema, FilterGroupSchema])),
  })
);

const SortSpecSchema = z.object({
  field: z.string(),
  direction: z.enum(['ASC', 'DESC']),
});

const QueryInputSchema = z.object({
  filters: z.union([FilterConditionSchema, FilterGroupSchema]).optional(),
  sort: z.array(SortSpecSchema).optional(),
  limit: z.number().min(1).max(1000).optional(),
  offset: z.number().min(0).optional(),
  select: z.array(z.string()).optional(),
});

export interface ApiDependencies {
  db: DatabaseManager;
  schemas: SchemaRegistry;
  indexer: DocumentIndexer;
  query: QueryEngine;
  firestore?: FirestoreClient;
  search?: SearchEngine;
  aggregations?: AggregationEngine;
  queue?: IndexQueue;
  apiKeys?: string[];
}

export function createApi(deps: ApiDependencies): Hono {
  const app = new Hono();

  // Enable CORS for cross-origin requests
  app.use('*', cors());

  // API key authentication (if configured)
  if (deps.apiKeys && deps.apiKeys.length > 0) {
    app.use('*', apiKeyAuth({
      apiKeys: deps.apiKeys,
      excludePaths: ['/health', '/graphql'],
    }));
  }

  // Health check
  app.get('/health', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ============ GraphQL ============
  const graphqlHandler = createGraphQLHandler({
    db: deps.db,
    schemas: deps.schemas,
    indexer: deps.indexer,
    query: deps.query,
  });

  // Mount GraphQL at /graphql
  app.on(['GET', 'POST'], '/graphql', async (c) => {
    const response = await graphqlHandler.fetch(c.req.raw, {
      db: deps.db,
      schemas: deps.schemas,
      indexer: deps.indexer,
      query: deps.query,
    });
    return response;
  });

  // ============ Schema Routes ============

  // List all schemas
  app.get('/schemas', (c) => {
    const schemas = deps.schemas.getAll();
    return c.json({ schemas });
  });

  // Get schema for a collection
  app.get('/schemas/:collection', (c) => {
    const { collection } = c.req.param();
    const schema = deps.schemas.get(collection);

    if (!schema) {
      return c.json({ error: 'Schema not found' }, 404);
    }

    return c.json({ schema });
  });

  // Create or update a schema
  app.post('/schemas/:collection', async (c) => {
    const { collection } = c.req.param();

    try {
      const body = await c.req.json();
      const parsed = SchemaInputSchema.safeParse(body);

      if (!parsed.success) {
        return c.json({ error: 'Invalid schema', details: parsed.error.issues }, 400);
      }

      const schema = deps.schemas.register({
        collection,
        fields: parsed.data.fields as Record<string, FieldType>,
      });

      return c.json({ schema }, 201);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        400
      );
    }
  });

  // Delete a schema
  app.delete('/schemas/:collection', (c) => {
    const { collection } = c.req.param();
    const deleted = deps.schemas.delete(collection);

    if (!deleted) {
      return c.json({ error: 'Schema not found' }, 404);
    }

    return c.json({ deleted: true });
  });

  // ============ Document Routes ============

  // Index a single document
  app.post('/documents/:collection/:docId', async (c) => {
    const { collection, docId } = c.req.param();

    try {
      const body = await c.req.json();
      const parsed = DocumentDataSchema.safeParse(body);

      if (!parsed.success) {
        return c.json({ error: 'Invalid document data' }, 400);
      }

      const result = deps.indexer.index(collection, docId, parsed.data);

      if (!result.success) {
        return c.json({ error: result.error }, 400);
      }

      return c.json({ indexed: true, documentId: docId });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        400
      );
    }
  });

  // Index multiple documents
  app.post('/documents/:collection', async (c) => {
    const { collection } = c.req.param();

    try {
      const body = await c.req.json();
      const parsed = BulkDocumentsSchema.safeParse(body);

      if (!parsed.success) {
        return c.json({ error: 'Invalid bulk documents data' }, 400);
      }

      const result = deps.indexer.indexBulk(collection, parsed.data);
      return c.json(result);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        400
      );
    }
  });

  // Delete a document
  app.delete('/documents/:collection/:docId', (c) => {
    const { collection, docId } = c.req.param();
    const deleted = deps.indexer.delete(collection, docId);

    if (!deleted) {
      return c.json({ error: 'Document not found' }, 404);
    }

    return c.json({ deleted: true });
  });

  // Get sync status for a document
  app.get('/documents/:collection/:docId/status', (c) => {
    const { collection, docId } = c.req.param();
    const status = deps.indexer.getSyncStatus(collection, docId);

    if (!status) {
      return c.json({ error: 'Status not found' }, 404);
    }

    return c.json({ status });
  });

  // Clear all documents in a collection
  app.delete('/documents/:collection', (c) => {
    const { collection } = c.req.param();
    const cleared = deps.indexer.clearCollection(collection);

    if (!cleared) {
      return c.json({ error: 'Collection not found' }, 404);
    }

    return c.json({ cleared: true });
  });

  // ============ Query Routes ============

  // Query documents
  app.post('/query/:collection', async (c) => {
    const { collection } = c.req.param();

    try {
      const body = await c.req.json();
      const parsed = QueryInputSchema.safeParse(body);

      if (!parsed.success) {
        return c.json({ error: 'Invalid query', details: parsed.error.issues }, 400);
      }

      const result = deps.query.execute({
        collection,
        filters: parsed.data.filters as FilterCondition | FilterGroup | undefined,
        sort: parsed.data.sort as SortSpec[] | undefined,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        select: parsed.data.select,
      });

      return c.json(result);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        400
      );
    }
  });

  // Count documents
  app.post('/count/:collection', async (c) => {
    const { collection } = c.req.param();

    try {
      const body = await c.req.json().catch(() => ({}));
      const filters = body.filters as FilterCondition | FilterGroup | undefined;

      const count = deps.query.count(collection, filters);
      return c.json({ count });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        400
      );
    }
  });

  // Get distinct values
  app.get('/distinct/:collection/:field', (c) => {
    const { collection, field } = c.req.param();

    try {
      const values = deps.query.distinct(collection, field);
      return c.json({ field, values });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        400
      );
    }
  });

  // ============ Firestore Sync Routes ============

  // Sync a single document from Firestore
  app.post('/sync/:collection/:docId', async (c) => {
    const { collection, docId } = c.req.param();

    if (!deps.firestore) {
      return c.json({ error: 'Firestore not configured' }, 400);
    }

    const result = await deps.firestore.syncDocument(
      collection,
      docId,
      deps.indexer,
      deps.schemas
    );

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({ synced: true, documentId: docId });
  });

  // Sync entire collection from Firestore
  app.post('/sync/:collection', async (c) => {
    const { collection } = c.req.param();

    if (!deps.firestore) {
      return c.json({ error: 'Firestore not configured' }, 400);
    }

    try {
      const body = await c.req.json().catch(() => ({}));
      const result = await deps.firestore.syncCollection(
        collection,
        deps.indexer,
        deps.schemas,
        {
          limit: body.limit,
          orderBy: body.orderBy,
        }
      );

      return c.json(result);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        400
      );
    }
  });

  // Get collection sync status
  app.get('/sync/:collection/status', (c) => {
    const { collection } = c.req.param();
    const statuses = deps.indexer.getCollectionSyncStatus(collection);
    return c.json({ statuses });
  });

  // Get errored documents
  app.get('/sync/errors', (c) => {
    const collection = c.req.query('collection');
    const errors = deps.indexer.getErroredDocuments(collection);
    return c.json({ errors });
  });

  // ============ Search Routes ============

  // Full-text search
  app.post('/search/:collection', async (c) => {
    const { collection } = c.req.param();

    if (!deps.search) {
      return c.json({ error: 'Search not configured' }, 400);
    }

    try {
      const body = await c.req.json();
      const { query, limit, offset, highlight } = body;

      if (!query) {
        return c.json({ error: 'Query is required' }, 400);
      }

      const result = deps.search.search(collection, query, { limit, offset, highlight });
      return c.json(result);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        400
      );
    }
  });

  // Create search index
  app.post('/search/:collection/index', (c) => {
    const { collection } = c.req.param();

    if (!deps.search) {
      return c.json({ error: 'Search not configured' }, 400);
    }

    try {
      deps.search.createSearchIndex(collection);
      return c.json({ success: true, message: 'Search index created' });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        400
      );
    }
  });

  // Check if search index exists
  app.get('/search/:collection/index', (c) => {
    const { collection } = c.req.param();

    if (!deps.search) {
      return c.json({ error: 'Search not configured' }, 400);
    }

    const exists = deps.search.hasSearchIndex(collection);
    return c.json({ exists });
  });

  // ============ Aggregation Routes ============

  // Run aggregation query
  app.post('/aggregate/:collection', async (c) => {
    const { collection } = c.req.param();

    if (!deps.aggregations) {
      return c.json({ error: 'Aggregations not configured' }, 400);
    }

    try {
      const body = await c.req.json();
      const result = deps.aggregations.aggregate({
        collection,
        ...body,
      });
      return c.json(result);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        400
      );
    }
  });

  // Get stats for a field
  app.post('/aggregate/:collection/stats', async (c) => {
    const { collection } = c.req.param();

    if (!deps.aggregations) {
      return c.json({ error: 'Aggregations not configured' }, 400);
    }

    try {
      const body = await c.req.json();
      const { field, filters } = body;

      if (!field) {
        return c.json({ error: 'Field is required' }, 400);
      }

      const result = deps.aggregations.stats(collection, field, filters);
      return c.json(result);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        400
      );
    }
  });

  // ============ Queue Routes ============

  // Add document to index queue
  app.post('/queue/:collection/:docId', async (c) => {
    const { collection, docId } = c.req.param();

    if (!deps.queue) {
      return c.json({ error: 'Queue not configured' }, 400);
    }

    try {
      const body = await c.req.json();
      const jobId = await deps.queue.addIndexJob(collection, docId, body);
      return c.json({ jobId, status: 'queued' });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        400
      );
    }
  });

  // Add bulk documents to queue
  app.post('/queue/:collection', async (c) => {
    const { collection } = c.req.param();

    if (!deps.queue) {
      return c.json({ error: 'Queue not configured' }, 400);
    }

    try {
      const body = await c.req.json();
      const jobId = await deps.queue.addBulkJob(collection, body);
      return c.json({ jobId, status: 'queued' });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        400
      );
    }
  });

  // Get queue stats
  app.get('/queue/stats', async (c) => {
    if (!deps.queue) {
      return c.json({ error: 'Queue not configured' }, 400);
    }

    try {
      const stats = await deps.queue.getStats();
      return c.json(stats);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        400
      );
    }
  });

  // Get job status
  app.get('/queue/job/:jobId', async (c) => {
    const { jobId } = c.req.param();

    if (!deps.queue) {
      return c.json({ error: 'Queue not configured' }, 400);
    }

    try {
      const job = await deps.queue.getJob(jobId);
      if (!job) {
        return c.json({ error: 'Job not found' }, 404);
      }
      return c.json({
        id: job.id,
        data: job.data,
        state: await job.getState(),
        progress: job.progress,
        attemptsMade: job.attemptsMade,
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        400
      );
    }
  });

  // ============ Schema Inference Route ============

  // Infer schema from document
  app.post('/schemas/:collection/infer', async (c) => {
    const { collection } = c.req.param();

    try {
      const body = await c.req.json();
      const schema = deps.schemas.registerFromDocument(collection, body);
      return c.json({ schema }, 201);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        400
      );
    }
  });

  return app;
}
