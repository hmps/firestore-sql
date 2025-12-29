/**
 * Firestore SQL SDK - Main client for programmatic usage
 */

import { DatabaseManager } from './core/database';
import { SchemaRegistry, type SchemaInput } from './core/schema-registry';
import { DocumentIndexer } from './core/document-indexer';
import { QueryEngine } from './core/query-engine';
import { FirestoreClient, type FirestoreConfig } from './firestore/client';
import type {
  CollectionSchema,
  FilterCondition,
  FilterGroup,
  QueryResult,
  QuerySpec,
  SortSpec,
  FieldType,
  FieldDefinition,
} from './core/types';

export interface FirestoreSqlConfig {
  /** Path to SQLite database file (use :memory: for in-memory) */
  database?: string;
  /** Firestore configuration (optional, for sync features) */
  firestore?: FirestoreConfig;
}

/**
 * Type-safe query builder for a collection
 */
export class CollectionQuery<T> {
  private spec: QuerySpec;

  constructor(
    private engine: QueryEngine,
    collection: string
  ) {
    this.spec = { collection };
  }

  /** Add a filter condition */
  where(
    field: keyof T | '_id',
    operator: FilterCondition['operator'],
    value: unknown
  ): this {
    const condition: FilterCondition = {
      field: field as string,
      operator,
      value,
    };

    if (!this.spec.filters) {
      this.spec.filters = condition;
    } else if ('operator' in this.spec.filters && 'conditions' in this.spec.filters) {
      // Already a filter group
      (this.spec.filters as FilterGroup).conditions.push(condition);
    } else {
      // Convert single condition to AND group
      this.spec.filters = {
        operator: 'AND',
        conditions: [this.spec.filters as FilterCondition, condition],
      };
    }

    return this;
  }

  /** Add an OR filter group */
  or(
    ...conditions: Array<{
      field: keyof T | '_id';
      operator: FilterCondition['operator'];
      value: unknown;
    }>
  ): this {
    const group: FilterGroup = {
      operator: 'OR',
      conditions: conditions.map((c) => ({
        field: c.field as string,
        operator: c.operator,
        value: c.value,
      })),
    };

    if (!this.spec.filters) {
      this.spec.filters = group;
    } else if ('operator' in this.spec.filters && 'conditions' in this.spec.filters) {
      (this.spec.filters as FilterGroup).conditions.push(group);
    } else {
      this.spec.filters = {
        operator: 'AND',
        conditions: [this.spec.filters as FilterCondition, group],
      };
    }

    return this;
  }

  /** Sort by field */
  orderBy(field: keyof T | '_id', direction: 'ASC' | 'DESC' = 'ASC'): this {
    if (!this.spec.sort) {
      this.spec.sort = [];
    }
    this.spec.sort.push({ field: field as string, direction });
    return this;
  }

  /** Limit results */
  limit(count: number): this {
    this.spec.limit = count;
    return this;
  }

  /** Offset results */
  offset(count: number): this {
    this.spec.offset = count;
    return this;
  }

  /** Select specific fields */
  select(...fields: Array<keyof T | '_id'>): this {
    this.spec.select = fields as string[];
    return this;
  }

  /** Execute the query */
  execute(): QueryResult<T & { _id: string }> {
    return this.engine.execute<T & { _id: string }>(this.spec);
  }

  /** Get first result or null */
  first(): (T & { _id: string }) | null {
    const result = this.limit(1).execute();
    return result.documents[0] ?? null;
  }

  /** Get all results as array */
  all(): Array<T & { _id: string }> {
    return this.execute().documents;
  }

  /** Count matching documents */
  count(): number {
    return this.engine.count(this.spec.collection, this.spec.filters);
  }

  /** Check if any documents match */
  exists(): boolean {
    return this.count() > 0;
  }
}

/**
 * Main Firestore SQL client
 */
export class FirestoreSql {
  private db: DatabaseManager;
  private _schemas: SchemaRegistry;
  private _indexer: DocumentIndexer;
  private _query: QueryEngine;
  private _firestore?: FirestoreClient;

  constructor(config: FirestoreSqlConfig = {}) {
    this.db = new DatabaseManager(config.database ?? ':memory:');
    this._schemas = new SchemaRegistry(this.db);
    this._indexer = new DocumentIndexer(this.db, this._schemas);
    this._query = new QueryEngine(this.db, this._schemas);

    if (config.firestore) {
      this._firestore = new FirestoreClient(config.firestore);
    }
  }

  /** Get the schema registry */
  get schemas(): SchemaRegistry {
    return this._schemas;
  }

  /** Get the document indexer */
  get indexer(): DocumentIndexer {
    return this._indexer;
  }

  /** Get the query engine */
  get query(): QueryEngine {
    return this._query;
  }

  /** Get the Firestore client (if configured) */
  get firestore(): FirestoreClient | undefined {
    return this._firestore;
  }

  /** Get the database manager */
  get database(): DatabaseManager {
    return this.db;
  }

  /**
   * Define a schema for a collection
   */
  defineSchema<T extends Record<string, FieldType | FieldDefinition>>(
    collection: string,
    fields: T
  ): CollectionSchema {
    return this._schemas.register({ collection, fields });
  }

  /**
   * Index a document
   */
  index(
    collection: string,
    documentId: string,
    data: Record<string, unknown>
  ): { success: boolean; error?: string } {
    const result = this._indexer.index(collection, documentId, data);
    return { success: result.success, error: result.error };
  }

  /**
   * Index multiple documents
   */
  indexBulk(
    collection: string,
    documents: Array<{ id: string; data: Record<string, unknown> }>
  ) {
    return this._indexer.indexBulk(collection, documents);
  }

  /**
   * Delete a document from the index
   */
  delete(collection: string, documentId: string): boolean {
    return this._indexer.delete(collection, documentId);
  }

  /**
   * Create a type-safe query builder for a collection
   */
  collection<T>(collection: string): CollectionQuery<T> {
    return new CollectionQuery<T>(this._query, collection);
  }

  /**
   * Execute a raw SQL query on a collection's table
   */
  raw<T = Record<string, unknown>>(
    collection: string,
    sql: string,
    params?: unknown[]
  ): T[] {
    return this._query.raw<T>(collection, sql, params);
  }

  /**
   * Sync a document from Firestore
   */
  async syncDocument(
    collection: string,
    documentId: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this._firestore) {
      return { success: false, error: 'Firestore not configured' };
    }
    return this._firestore.syncDocument(
      collection,
      documentId,
      this._indexer,
      this._schemas
    );
  }

  /**
   * Sync all documents in a collection from Firestore
   */
  async syncCollection(
    collection: string,
    options?: { limit?: number; orderBy?: string }
  ) {
    if (!this._firestore) {
      throw new Error('Firestore not configured');
    }
    return this._firestore.syncCollection(
      collection,
      this._indexer,
      this._schemas,
      options
    );
  }

  /**
   * Watch a collection for real-time Firestore updates
   */
  watchCollection(collection: string): () => void {
    if (!this._firestore) {
      throw new Error('Firestore not configured');
    }
    return this._firestore.watchCollection(
      collection,
      this._indexer,
      this._schemas
    );
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

// Re-export types
export type {
  CollectionSchema,
  FilterCondition,
  FilterGroup,
  QueryResult,
  QuerySpec,
  SortSpec,
  FieldType,
  FieldDefinition,
  FirestoreConfig,
  SchemaInput,
};
