/**
 * Tests for core modules: database, schema-registry, document-indexer, query-engine
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { DatabaseManager } from '../src/core/database';
import { SchemaRegistry } from '../src/core/schema-registry';
import { DocumentIndexer } from '../src/core/document-indexer';
import { QueryEngine } from '../src/core/query-engine';

describe('DatabaseManager', () => {
  let db: DatabaseManager;

  beforeEach(() => {
    db = new DatabaseManager(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('should create tables from schema', () => {
    const schema = {
      collection: 'users',
      fields: {
        name: { type: 'string' as const, nullable: false, indexed: true },
        email: { type: 'string' as const, nullable: false, indexed: true },
        age: { type: 'number' as const, nullable: true, indexed: false },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    db.createTableFromSchema(schema);
    const tableName = db.getTableName('users');

    // Verify table exists
    const result = db.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [tableName]
    );
    expect(result.length).toBe(1);
  });

  it('should upsert documents', () => {
    const schema = {
      collection: 'users',
      fields: {
        name: { type: 'string' as const, nullable: false, indexed: false },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    db.createTableFromSchema(schema);

    // Insert
    db.upsertDocument('users', 'user1', { name: 'John' }, schema);
    let result = db.query<{ _id: string; name: string }>(
      `SELECT * FROM ${db.getTableName('users')} WHERE _id = ?`,
      ['user1']
    );
    expect(result[0]?.name).toBe('John');

    // Update
    db.upsertDocument('users', 'user1', { name: 'Jane' }, schema);
    result = db.query<{ _id: string; name: string }>(
      `SELECT * FROM ${db.getTableName('users')} WHERE _id = ?`,
      ['user1']
    );
    expect(result[0]?.name).toBe('Jane');
  });

  it('should delete documents', () => {
    const schema = {
      collection: 'users',
      fields: {
        name: { type: 'string' as const, nullable: false, indexed: false },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    db.createTableFromSchema(schema);
    db.upsertDocument('users', 'user1', { name: 'John' }, schema);

    const deleted = db.deleteDocument('users', 'user1');
    expect(deleted).toBe(true);

    const result = db.query<{ _id: string }>(
      `SELECT * FROM ${db.getTableName('users')} WHERE _id = ?`,
      ['user1']
    );
    expect(result.length).toBe(0);
  });
});

describe('SchemaRegistry', () => {
  let db: DatabaseManager;
  let schemas: SchemaRegistry;

  beforeEach(() => {
    db = new DatabaseManager(':memory:');
    schemas = new SchemaRegistry(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should register schemas', () => {
    const schema = schemas.register({
      collection: 'users',
      fields: {
        name: 'string',
        email: { type: 'string', indexed: true },
        age: 'number',
      },
    });

    expect(schema.collection).toBe('users');
    expect(schema.fields.name.type).toBe('string');
    expect(schema.fields.email.indexed).toBe(true);
  });

  it('should get registered schemas', () => {
    schemas.register({ collection: 'users', fields: { name: 'string' } });

    const schema = schemas.get('users');
    expect(schema).toBeDefined();
    expect(schema?.collection).toBe('users');
  });

  it('should list all schemas', () => {
    schemas.register({ collection: 'users', fields: { name: 'string' } });
    schemas.register({ collection: 'posts', fields: { title: 'string' } });

    const all = schemas.getAll();
    expect(all.length).toBe(2);
  });

  it('should infer schema from document', () => {
    const inferred = schemas.inferSchema({
      name: 'John',
      age: 30,
      isActive: true,
      createdAt: '2024-01-01T00:00:00Z',
      tags: ['a', 'b'],
      nested: { foo: 'bar' },
    });

    expect(inferred.name.type).toBe('string');
    expect(inferred.age.type).toBe('number');
    expect(inferred.isActive.type).toBe('boolean');
    expect(inferred.createdAt.type).toBe('datetime');
    expect(inferred.tags.type).toBe('string'); // Arrays are JSON stringified
    expect(inferred.nested.type).toBe('string'); // Objects are JSON stringified
  });

  it('should register schema from first document', () => {
    const schema = schemas.registerFromDocument('users', {
      name: 'John',
      email: 'john@example.com',
      score: 100,
    });

    expect(schema.fields.name.type).toBe('string');
    expect(schema.fields.email.type).toBe('string');
    expect(schema.fields.score.type).toBe('number');
  });
});

describe('DocumentIndexer', () => {
  let db: DatabaseManager;
  let schemas: SchemaRegistry;
  let indexer: DocumentIndexer;

  beforeEach(() => {
    db = new DatabaseManager(':memory:');
    schemas = new SchemaRegistry(db);
    indexer = new DocumentIndexer(db, schemas);

    schemas.register({
      collection: 'users',
      fields: {
        name: 'string',
        email: { type: 'string', indexed: true },
        score: 'number',
      },
    });
  });

  afterEach(() => {
    db.close();
  });

  it('should index documents', () => {
    const result = indexer.index('users', 'user1', {
      name: 'John',
      email: 'john@example.com',
      score: 100,
    });

    expect(result.success).toBe(true);
    expect(result.documentId).toBe('user1');
  });

  it('should handle missing schema', () => {
    const result = indexer.index('nonexistent', 'doc1', { foo: 'bar' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Schema not found');
  });

  it('should bulk index documents', () => {
    const result = indexer.indexBulk('users', [
      { id: 'user1', data: { name: 'John', email: 'john@example.com', score: 100 } },
      { id: 'user2', data: { name: 'Jane', email: 'jane@example.com', score: 90 } },
    ]);

    expect(result.total).toBe(2);
    expect(result.successful).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('should delete documents', () => {
    indexer.index('users', 'user1', { name: 'John', email: 'john@example.com', score: 100 });

    const deleted = indexer.delete('users', 'user1');
    expect(deleted).toBe(true);
  });
});

describe('QueryEngine', () => {
  let db: DatabaseManager;
  let schemas: SchemaRegistry;
  let indexer: DocumentIndexer;
  let query: QueryEngine;

  beforeEach(() => {
    db = new DatabaseManager(':memory:');
    schemas = new SchemaRegistry(db);
    indexer = new DocumentIndexer(db, schemas);
    query = new QueryEngine(db, schemas);

    schemas.register({
      collection: 'users',
      fields: {
        name: 'string',
        email: { type: 'string', indexed: true },
        score: 'number',
        isActive: 'boolean',
      },
    });

    // Index test data
    indexer.index('users', 'user1', { name: 'John', email: 'john@example.com', score: 100, isActive: true });
    indexer.index('users', 'user2', { name: 'Jane', email: 'jane@example.com', score: 90, isActive: true });
    indexer.index('users', 'user3', { name: 'Bob', email: 'bob@example.com', score: 80, isActive: false });
  });

  afterEach(() => {
    db.close();
  });

  it('should query all documents', () => {
    const result = query.execute({ collection: 'users' });
    expect(result.documents.length).toBe(3);
    expect(result.total).toBe(3);
  });

  it('should filter with equals', () => {
    const result = query.execute({
      collection: 'users',
      filters: { field: 'name', operator: '=', value: 'John' },
    });
    expect(result.documents.length).toBe(1);
    expect(result.documents[0]?.name).toBe('John');
  });

  it('should filter with greater than', () => {
    const result = query.execute({
      collection: 'users',
      filters: { field: 'score', operator: '>', value: 85 },
    });
    expect(result.documents.length).toBe(2);
  });

  it('should filter with boolean', () => {
    const result = query.execute({
      collection: 'users',
      filters: { field: 'isActive', operator: '=', value: true },
    });
    expect(result.documents.length).toBe(2);
  });

  it('should filter with LIKE', () => {
    const result = query.execute({
      collection: 'users',
      filters: { field: 'email', operator: 'LIKE', value: '%example.com' },
    });
    expect(result.documents.length).toBe(3);
  });

  it('should filter with IN', () => {
    const result = query.execute({
      collection: 'users',
      filters: { field: 'name', operator: 'IN', value: ['John', 'Jane'] },
    });
    expect(result.documents.length).toBe(2);
  });

  it('should filter with AND group', () => {
    const result = query.execute({
      collection: 'users',
      filters: {
        operator: 'AND',
        conditions: [
          { field: 'score', operator: '>=', value: 90 },
          { field: 'isActive', operator: '=', value: true },
        ],
      },
    });
    expect(result.documents.length).toBe(2);
  });

  it('should filter with OR group', () => {
    const result = query.execute({
      collection: 'users',
      filters: {
        operator: 'OR',
        conditions: [
          { field: 'name', operator: '=', value: 'John' },
          { field: 'name', operator: '=', value: 'Bob' },
        ],
      },
    });
    expect(result.documents.length).toBe(2);
  });

  it('should sort ascending', () => {
    const result = query.execute({
      collection: 'users',
      sort: [{ field: 'score', direction: 'ASC' }],
    });
    expect(result.documents[0]?.name).toBe('Bob');
    expect(result.documents[2]?.name).toBe('John');
  });

  it('should sort descending', () => {
    const result = query.execute({
      collection: 'users',
      sort: [{ field: 'score', direction: 'DESC' }],
    });
    expect(result.documents[0]?.name).toBe('John');
    expect(result.documents[2]?.name).toBe('Bob');
  });

  it('should paginate with limit and offset', () => {
    const result = query.execute({
      collection: 'users',
      sort: [{ field: 'score', direction: 'DESC' }],
      limit: 2,
      offset: 1,
    });
    expect(result.documents.length).toBe(2);
    expect(result.documents[0]?.name).toBe('Jane');
    expect(result.total).toBe(3);
    expect(result.limit).toBe(2);
    expect(result.offset).toBe(1);
  });

  it('should select specific fields', () => {
    const result = query.execute({
      collection: 'users',
      select: ['name', 'score'],
    });
    expect(result.documents[0]).toHaveProperty('name');
    expect(result.documents[0]).toHaveProperty('score');
    expect(result.documents[0]).not.toHaveProperty('email');
  });

  it('should count documents', () => {
    const count = query.count('users');
    expect(count).toBe(3);
  });

  it('should count with filters', () => {
    const count = query.count('users', { field: 'isActive', operator: '=', value: true });
    expect(count).toBe(2);
  });

  it('should get distinct values', () => {
    const values = query.distinct('users', 'isActive');
    expect(values.length).toBe(2);
    expect(values).toContain(1); // true stored as 1
    expect(values).toContain(0); // false stored as 0
  });
});
