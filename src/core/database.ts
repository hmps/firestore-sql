/**
 * SQLite database management using Bun's native SQLite
 */

import { Database, type SQLQueryBindings } from 'bun:sqlite';
import type { CollectionSchema, FieldType } from './types';

export class DatabaseManager {
  private db: Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.initializeMetaTables();
  }

  /** Initialize meta tables for schema storage */
  private initializeMetaTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _schemas (
        collection TEXT PRIMARY KEY,
        schema_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _sync_status (
        collection TEXT NOT NULL,
        document_id TEXT NOT NULL,
        last_synced TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        PRIMARY KEY (collection, document_id)
      )
    `);
  }

  /** Map field type to SQLite type */
  private mapFieldTypeToSql(type: FieldType): string {
    switch (type) {
      case 'string':
        return 'TEXT';
      case 'number':
        return 'REAL';
      case 'boolean':
        return 'INTEGER';
      case 'datetime':
        return 'TEXT';
      default:
        return 'TEXT';
    }
  }

  /** Get table name for a collection */
  getTableName(collection: string): string {
    // Sanitize collection name to valid SQL identifier
    return `col_${collection.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  }

  /** Create or update table for a collection schema */
  createTableFromSchema(schema: CollectionSchema): void {
    const tableName = this.getTableName(schema.collection);

    // Build column definitions
    const columns = ['_id TEXT PRIMARY KEY'];
    const indexes: string[] = [];

    for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
      const sqlType = this.mapFieldTypeToSql(fieldDef.type);
      const nullable = fieldDef.nullable !== false ? '' : ' NOT NULL';
      columns.push(`${fieldName} ${sqlType}${nullable}`);

      if (fieldDef.indexed) {
        indexes.push(fieldName);
      }
    }

    // Add metadata columns
    columns.push('_indexed_at TEXT NOT NULL');
    columns.push('_updated_at TEXT NOT NULL');

    // Create table
    this.db.exec(`DROP TABLE IF EXISTS ${tableName}`);
    this.db.exec(`CREATE TABLE ${tableName} (${columns.join(', ')})`);

    // Create indexes
    for (const field of indexes) {
      this.db.exec(
        `CREATE INDEX IF NOT EXISTS idx_${tableName}_${field} ON ${tableName}(${field})`
      );
    }
  }

  /** Save schema to meta table */
  saveSchema(schema: CollectionSchema): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO _schemas (collection, schema_json, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      schema.collection,
      JSON.stringify(schema),
      schema.createdAt.toISOString(),
      schema.updatedAt.toISOString()
    );
  }

  /** Get schema from meta table */
  getSchema(collection: string): CollectionSchema | null {
    const stmt = this.db.prepare(
      'SELECT schema_json FROM _schemas WHERE collection = ?'
    );
    const row = stmt.get(collection) as { schema_json: string } | null;

    if (!row) return null;

    const parsed = JSON.parse(row.schema_json);
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      updatedAt: new Date(parsed.updatedAt),
    };
  }

  /** Get all schemas */
  getAllSchemas(): CollectionSchema[] {
    const stmt = this.db.prepare('SELECT schema_json FROM _schemas');
    const rows = stmt.all() as { schema_json: string }[];

    return rows.map((row) => {
      const parsed = JSON.parse(row.schema_json);
      return {
        ...parsed,
        createdAt: new Date(parsed.createdAt),
        updatedAt: new Date(parsed.updatedAt),
      };
    });
  }

  /** Delete schema and its table */
  deleteSchema(collection: string): boolean {
    const schema = this.getSchema(collection);
    if (!schema) return false;

    const tableName = this.getTableName(collection);
    this.db.exec(`DROP TABLE IF EXISTS ${tableName}`);
    this.db.prepare('DELETE FROM _schemas WHERE collection = ?').run(collection);
    this.db
      .prepare('DELETE FROM _sync_status WHERE collection = ?')
      .run(collection);

    return true;
  }

  /** Insert or update a document */
  upsertDocument(
    collection: string,
    documentId: string,
    data: Record<string, unknown>,
    schema: CollectionSchema
  ): void {
    const tableName = this.getTableName(collection);
    const now = new Date().toISOString();

    const fields = ['_id', '_indexed_at', '_updated_at'];
    const placeholders = ['?', '?', '?'];
    const values: unknown[] = [documentId, now, now];

    for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
      fields.push(fieldName);
      placeholders.push('?');

      let value = data[fieldName];

      // Convert value based on type
      if (value !== undefined && value !== null) {
        switch (fieldDef.type) {
          case 'boolean':
            value = value ? 1 : 0;
            break;
          case 'datetime':
            if (value instanceof Date) {
              value = value.toISOString();
            } else if (typeof value === 'object' && 'toDate' in (value as object)) {
              // Handle Firestore Timestamp
              value = (value as { toDate: () => Date }).toDate().toISOString();
            }
            break;
        }
      }

      values.push(value ?? null);
    }

    const sql = `
      INSERT OR REPLACE INTO ${tableName} (${fields.join(', ')})
      VALUES (${placeholders.join(', ')})
    `;

    this.db.prepare(sql).run(...(values as SQLQueryBindings[]));

    // Update sync status
    this.updateSyncStatus(collection, documentId, 'synced');
  }

  /** Delete a document */
  deleteDocument(collection: string, documentId: string): boolean {
    const tableName = this.getTableName(collection);

    const result = this.db
      .prepare(`DELETE FROM ${tableName} WHERE _id = ?`)
      .run(documentId);

    this.db
      .prepare(
        'DELETE FROM _sync_status WHERE collection = ? AND document_id = ?'
      )
      .run(collection, documentId);

    return result.changes > 0;
  }

  /** Update sync status */
  updateSyncStatus(
    collection: string,
    documentId: string,
    status: 'synced' | 'pending' | 'error',
    error?: string
  ): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO _sync_status (collection, document_id, last_synced, status, error)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      collection,
      documentId,
      new Date().toISOString(),
      status,
      error ?? null
    );
  }

  /** Execute a raw query */
  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...(params as SQLQueryBindings[])) as T[];
  }

  /** Execute a raw statement */
  execute(sql: string, params: unknown[] = []): void {
    this.db.prepare(sql).run(...(params as SQLQueryBindings[]));
  }

  /** Get the underlying database instance */
  getDb(): Database {
    return this.db;
  }

  /** Close the database connection */
  close(): void {
    this.db.close();
  }
}
