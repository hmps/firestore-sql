/**
 * Tests for SDK (FirestoreSql class)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { FirestoreSql } from '../src/sdk';

describe('FirestoreSql SDK', () => {
  let db: FirestoreSql;

  beforeEach(() => {
    db = new FirestoreSql({ database: ':memory:' });
  });

  afterEach(() => {
    db.close();
  });

  describe('Schema Management', () => {
    it('should define schema', () => {
      const schema = db.defineSchema('users', {
        name: 'string',
        email: { type: 'string', indexed: true },
        score: 'number',
      });

      expect(schema.collection).toBe('users');
      expect(schema.fields.name.type).toBe('string');
      expect(schema.fields.email.indexed).toBe(true);
    });

    it('should get schema via schemas registry', () => {
      db.defineSchema('users', { name: 'string' });
      const schema = db.schemas.get('users');

      expect(schema).toBeDefined();
      expect(schema?.collection).toBe('users');
    });

    it('should list schemas via schemas registry', () => {
      db.defineSchema('users', { name: 'string' });
      db.defineSchema('posts', { title: 'string' });

      const schemas = db.schemas.getAll();
      expect(schemas.length).toBe(2);
    });

    it('should delete schema via schemas registry', () => {
      db.defineSchema('users', { name: 'string' });
      const deleted = db.schemas.delete('users');

      expect(deleted).toBe(true);
      expect(db.schemas.get('users')).toBeNull();
    });
  });

  describe('Document Indexing', () => {
    beforeEach(() => {
      db.defineSchema('users', {
        name: 'string',
        email: 'string',
        score: 'number',
      });
    });

    it('should index document', () => {
      const result = db.index('users', 'user1', {
        name: 'John',
        email: 'john@example.com',
        score: 100,
      });

      expect(result.success).toBe(true);
    });

    it('should bulk index documents', () => {
      const result = db.indexBulk('users', [
        { id: 'user1', data: { name: 'John', email: 'john@example.com', score: 100 } },
        { id: 'user2', data: { name: 'Jane', email: 'jane@example.com', score: 90 } },
      ]);

      expect(result.total).toBe(2);
      expect(result.successful).toBe(2);
    });

    it('should delete document', () => {
      db.index('users', 'user1', { name: 'John', email: 'john@example.com', score: 100 });
      const deleted = db.delete('users', 'user1');

      expect(deleted).toBe(true);
    });
  });

  describe('Fluent Query API', () => {
    interface User {
      name: string;
      email: string;
      score: number;
      isActive: boolean;
    }

    beforeEach(() => {
      db.defineSchema('users', {
        name: 'string',
        email: 'string',
        score: 'number',
        isActive: 'boolean',
      });

      db.indexBulk('users', [
        { id: 'user1', data: { name: 'John', email: 'john@example.com', score: 100, isActive: true } },
        { id: 'user2', data: { name: 'Jane', email: 'jane@example.com', score: 90, isActive: true } },
        { id: 'user3', data: { name: 'Bob', email: 'bob@example.com', score: 80, isActive: false } },
      ]);
    });

    it('should query all documents', () => {
      const result = db.collection<User>('users').execute();
      expect(result.documents.length).toBe(3);
    });

    it('should filter with where', () => {
      const result = db.collection<User>('users')
        .where('score', '>=', 90)
        .execute();

      expect(result.documents.length).toBe(2);
    });

    it('should chain multiple where clauses', () => {
      const result = db.collection<User>('users')
        .where('score', '>=', 80)
        .where('isActive', '=', true)
        .execute();

      expect(result.documents.length).toBe(2);
    });

    it('should sort ascending', () => {
      const result = db.collection<User>('users')
        .orderBy('score', 'ASC')
        .execute();

      expect(result.documents[0].name).toBe('Bob');
    });

    it('should sort descending', () => {
      const result = db.collection<User>('users')
        .orderBy('score', 'DESC')
        .execute();

      expect(result.documents[0].name).toBe('John');
    });

    it('should limit results', () => {
      const result = db.collection<User>('users')
        .limit(2)
        .execute();

      expect(result.documents.length).toBe(2);
      expect(result.limit).toBe(2);
    });

    it('should offset results', () => {
      const result = db.collection<User>('users')
        .orderBy('score', 'DESC')
        .offset(1)
        .execute();

      expect(result.documents[0].name).toBe('Jane');
      expect(result.offset).toBe(1);
    });

    it('should select specific fields', () => {
      const result = db.collection<User>('users')
        .select('name', 'score')
        .execute();

      expect(result.documents[0]).toHaveProperty('name');
      expect(result.documents[0]).toHaveProperty('score');
    });

    it('should count documents', () => {
      const count = db.collection<User>('users')
        .where('isActive', '=', true)
        .count();

      expect(count).toBe(2);
    });

    it('should get first document', () => {
      const user = db.collection<User>('users')
        .orderBy('score', 'DESC')
        .first();

      expect(user?.name).toBe('John');
    });

    it('should return null for first on empty result', () => {
      const user = db.collection<User>('users')
        .where('score', '>', 1000)
        .first();

      expect(user).toBeNull();
    });

    it('should check if documents exist', () => {
      const exists = db.collection<User>('users')
        .where('name', '=', 'John')
        .exists();

      expect(exists).toBe(true);
    });

    it('should get all documents as array', () => {
      const users = db.collection<User>('users').all();
      expect(users.length).toBe(3);
    });
  });

  describe('Raw SQL Query', () => {
    beforeEach(() => {
      db.defineSchema('users', { name: 'string', score: 'number' });
      db.index('users', 'user1', { name: 'John', score: 100 });
    });

    it('should execute raw SQL on collection', () => {
      const result = db.raw<{ name: string; score: number }>(
        'users',
        'SELECT name, score FROM col_users WHERE score >= ?',
        [50]
      );

      expect(result.length).toBe(1);
      expect(result[0].name).toBe('John');
    });
  });

  describe('Query Engine Direct Access', () => {
    beforeEach(() => {
      db.defineSchema('users', { name: 'string', role: 'string' });
      db.indexBulk('users', [
        { id: 'u1', data: { name: 'John', role: 'admin' } },
        { id: 'u2', data: { name: 'Jane', role: 'user' } },
        { id: 'u3', data: { name: 'Bob', role: 'user' } },
      ]);
    });

    it('should count all documents via query engine', () => {
      const count = db.query.count('users');
      expect(count).toBe(3);
    });

    it('should count with filters via query engine', () => {
      const count = db.query.count('users', { field: 'role', operator: '=', value: 'user' });
      expect(count).toBe(2);
    });

    it('should get distinct values via query engine', () => {
      const roles = db.query.distinct('users', 'role');
      expect(roles).toContain('admin');
      expect(roles).toContain('user');
      expect(roles.length).toBe(2);
    });

    it('should execute query spec via query engine', () => {
      const result = db.query.execute({
        collection: 'users',
        filters: { field: 'role', operator: '=', value: 'admin' },
      });

      expect(result.documents.length).toBe(1);
      expect(result.documents[0].name).toBe('John');
    });
  });
});
