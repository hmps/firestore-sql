/**
 * Firestore SQL - A bridge between Firestore and SQL for advanced querying
 *
 * @example
 * ```typescript
 * import { FirestoreSql } from 'firestore-sql';
 *
 * const db = new FirestoreSql({ database: './data.db' });
 *
 * // Define a schema
 * db.defineSchema('prospects', {
 *   firstName: 'string',
 *   lastName: 'string',
 *   email: { type: 'string', indexed: true },
 *   company: 'string',
 *   score: 'number',
 *   isActive: 'boolean',
 *   createdAt: 'datetime',
 * });
 *
 * // Index documents
 * db.index('prospects', 'doc1', {
 *   firstName: 'John',
 *   lastName: 'Doe',
 *   email: 'john@example.com',
 *   company: 'Acme Inc',
 *   score: 85,
 *   isActive: true,
 * });
 *
 * // Query with type safety
 * const results = db.collection<{
 *   firstName: string;
 *   lastName: string;
 *   email: string;
 *   score: number;
 * }>('prospects')
 *   .where('score', '>=', 80)
 *   .where('isActive', '=', true)
 *   .orderBy('score', 'DESC')
 *   .limit(10)
 *   .execute();
 * ```
 */

export { FirestoreSql, CollectionQuery } from './sdk';
export { startServer } from './server';
export { createApi } from './api/routes';
export { createGraphQLHandler, graphqlSchema } from './api/graphql';

// Core exports
export { DatabaseManager } from './core/database';
export { SchemaRegistry } from './core/schema-registry';
export { DocumentIndexer } from './core/document-indexer';
export { QueryEngine } from './core/query-engine';
export { FirestoreClient } from './firestore/client';

// Type exports
export type {
  CollectionSchema,
  FieldType,
  FieldDefinition,
  FilterCondition,
  FilterGroup,
  QueryResult,
  QuerySpec,
  SortSpec,
  SyncStatus,
  IndexableDocument,
  ComparisonOperator,
  LogicalOperator,
  SortDirection,
} from './core/types';

export type { FirestoreConfig } from './firestore/client';
export type { SchemaInput } from './core/schema-registry';
export type { FirestoreSqlConfig } from './sdk';
export type { ServerConfig } from './server';
