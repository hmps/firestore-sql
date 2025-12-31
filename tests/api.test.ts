/**
 * Tests for REST API routes
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { DatabaseManager } from '../src/core/database';
import { SchemaRegistry } from '../src/core/schema-registry';
import { DocumentIndexer } from '../src/core/document-indexer';
import { QueryEngine } from '../src/core/query-engine';
import { SearchEngine } from '../src/core/search';
import { AggregationEngine } from '../src/core/aggregations';
import { createApi } from '../src/api/routes';

describe('REST API', () => {
  let db: DatabaseManager;
  let schemas: SchemaRegistry;
  let indexer: DocumentIndexer;
  let query: QueryEngine;
  let search: SearchEngine;
  let aggregations: AggregationEngine;
  let app: ReturnType<typeof createApi>;

  beforeEach(() => {
    db = new DatabaseManager(':memory:');
    schemas = new SchemaRegistry(db);
    indexer = new DocumentIndexer(db, schemas);
    query = new QueryEngine(db, schemas);
    search = new SearchEngine(db, schemas);
    aggregations = new AggregationEngine(db, schemas);
    app = createApi({ db, schemas, indexer, query, search, aggregations });
  });

  afterEach(() => {
    db.close();
  });

  describe('Health', () => {
    it('GET /health should return status', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.timestamp).toBeDefined();
    });
  });

  describe('Schemas', () => {
    it('GET /schemas should return empty list', async () => {
      const res = await app.request('/schemas');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.schemas).toEqual([]);
    });

    it('POST /schemas/:collection should create schema', async () => {
      const res = await app.request('/schemas/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            name: 'string',
            email: { type: 'string', indexed: true },
            age: 'number',
          },
        }),
      });
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.schema.collection).toBe('users');
      expect(data.schema.fields.name.type).toBe('string');
      expect(data.schema.fields.email.indexed).toBe(true);
    });

    it('GET /schemas/:collection should return schema', async () => {
      // Create schema first
      await app.request('/schemas/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { name: 'string' } }),
      });

      const res = await app.request('/schemas/users');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.schema.collection).toBe('users');
    });

    it('DELETE /schemas/:collection should delete schema', async () => {
      // Create schema first
      await app.request('/schemas/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { name: 'string' } }),
      });

      const res = await app.request('/schemas/users', { method: 'DELETE' });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.deleted).toBe(true);
    });
  });

  describe('Documents', () => {
    beforeEach(async () => {
      // Create schema
      await app.request('/schemas/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: { name: 'string', email: 'string', score: 'number' },
        }),
      });
    });

    it('POST /documents/:collection/:id should index document', async () => {
      const res = await app.request('/documents/users/user1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John', email: 'john@example.com', score: 100 }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.indexed).toBe(true);
      expect(data.documentId).toBe('user1');
    });

    it('POST /documents/:collection should bulk index', async () => {
      const res = await app.request('/documents/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { id: 'user1', data: { name: 'John', email: 'john@example.com', score: 100 } },
          { id: 'user2', data: { name: 'Jane', email: 'jane@example.com', score: 90 } },
        ]),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.total).toBe(2);
      expect(data.successful).toBe(2);
    });

    it('DELETE /documents/:collection/:id should delete document', async () => {
      // Index first
      await app.request('/documents/users/user1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John', email: 'john@example.com', score: 100 }),
      });

      const res = await app.request('/documents/users/user1', { method: 'DELETE' });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.deleted).toBe(true);
    });
  });

  describe('Queries', () => {
    beforeEach(async () => {
      // Create schema and index documents
      await app.request('/schemas/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: { name: 'string', score: 'number', isActive: 'boolean' },
        }),
      });

      await app.request('/documents/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { id: 'user1', data: { name: 'John', score: 100, isActive: true } },
          { id: 'user2', data: { name: 'Jane', score: 90, isActive: true } },
          { id: 'user3', data: { name: 'Bob', score: 80, isActive: false } },
        ]),
      });
    });

    it('POST /query/:collection should query all', async () => {
      const res = await app.request('/query/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.documents.length).toBe(3);
      expect(data.total).toBe(3);
    });

    it('POST /query/:collection should filter', async () => {
      const res = await app.request('/query/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: { field: 'score', operator: '>=', value: 90 },
        }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.documents.length).toBe(2);
    });

    it('POST /query/:collection should sort and paginate', async () => {
      const res = await app.request('/query/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sort: [{ field: 'score', direction: 'DESC' }],
          limit: 2,
        }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.documents.length).toBe(2);
      expect(data.documents[0].name).toBe('John');
    });

    it('POST /count/:collection should count', async () => {
      const res = await app.request('/count/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: { field: 'isActive', operator: '=', value: true } }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.count).toBe(2);
    });

    it('GET /distinct/:collection/:field should return distinct values', async () => {
      const res = await app.request('/distinct/users/isActive');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.field).toBe('isActive');
      expect(data.values.length).toBe(2);
    });
  });

  describe('Aggregations', () => {
    beforeEach(async () => {
      // Create schema and index documents
      await app.request('/schemas/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: { product: 'string', category: 'string', quantity: 'number', price: 'number' },
        }),
      });

      await app.request('/documents/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { id: 's1', data: { product: 'A', category: 'Electronics', quantity: 10, price: 100 } },
          { id: 's2', data: { product: 'B', category: 'Electronics', quantity: 5, price: 150 } },
          { id: 's3', data: { product: 'C', category: 'Hardware', quantity: 20, price: 50 } },
        ]),
      });
    });

    it('POST /aggregate/:collection should aggregate', async () => {
      const res = await app.request('/aggregate/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aggregates: [
            { field: '*', function: 'COUNT', alias: 'total' },
            { field: 'quantity', function: 'SUM', alias: 'total_qty' },
          ],
        }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.rows[0].total).toBe(3);
      expect(data.rows[0].total_qty).toBe(35);
    });

    it('POST /aggregate/:collection/stats should return stats', async () => {
      const res = await app.request('/aggregate/sales/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: 'quantity' }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.count).toBe(3);
      expect(data.sum).toBe(35);
      expect(data.min).toBe(5);
      expect(data.max).toBe(20);
    });
  });

  describe('Search', () => {
    beforeEach(async () => {
      // Create schema and index documents
      await app.request('/schemas/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: { title: 'string', content: 'string' },
        }),
      });

      await app.request('/documents/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { id: 'a1', data: { title: 'TypeScript Guide', content: 'Learn TypeScript from scratch' } },
          { id: 'a2', data: { title: 'JavaScript Basics', content: 'Introduction to JavaScript programming' } },
        ]),
      });
    });

    it('POST /search/:collection/index should create search index', async () => {
      const res = await app.request('/search/articles/index', { method: 'POST' });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('POST /search/:collection should search documents', async () => {
      // Create index first
      await app.request('/search/articles/index', { method: 'POST' });

      const res = await app.request('/search/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'TypeScript' }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.documents.length).toBe(1);
      expect(data.documents[0]._id).toBe('a1');
    });
  });

  describe('API Key Auth', () => {
    let authApp: ReturnType<typeof createApi>;

    beforeEach(() => {
      authApp = createApi({
        db,
        schemas,
        indexer,
        query,
        search,
        aggregations,
        apiKeys: ['test-key-123'],
      });
    });

    it('should reject requests without API key', async () => {
      const res = await authApp.request('/schemas');
      expect(res.status).toBe(401);
    });

    it('should reject requests with invalid API key', async () => {
      const res = await authApp.request('/schemas', {
        headers: { 'x-api-key': 'invalid-key' },
      });
      expect(res.status).toBe(403);
    });

    it('should allow requests with valid API key', async () => {
      const res = await authApp.request('/schemas', {
        headers: { 'x-api-key': 'test-key-123' },
      });
      expect(res.status).toBe(200);
    });

    it('should allow /health without API key', async () => {
      const res = await authApp.request('/health');
      expect(res.status).toBe(200);
    });

    it('should allow /graphql without API key', async () => {
      const res = await authApp.request('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ schemas { collection } }' }),
      });
      expect(res.status).toBe(200);
    });
  });
});
