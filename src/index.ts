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
export { SearchEngine } from './core/search';
export { AggregationEngine } from './core/aggregations';
export { FirestoreClient } from './firestore/client';

// Queue exports
export { IndexQueue } from './queue/index-queue';

// Auth exports
export { apiKeyAuth, generateApiKey } from './auth/api-key';

// Client SDK exports
export {
  FirestoreSqlClient,
  createCollectionClient,
} from './client';

// Multi-tenant exports
export { TenantManager } from './tenants/tenant-manager';
export { tenantMiddleware, getTenant } from './tenants/tenant-middleware';
export { createMultiTenantApi } from './api/multi-tenant-routes';
export { startMultiTenantServer } from './multi-tenant-server';

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

// Search types
export type { SearchResult, SearchOptions } from './core/search';

// Aggregation types
export type {
  AggregateFunction,
  AggregateField,
  AggregateQuery,
  AggregateResult,
} from './core/aggregations';

// Queue types
export type { IndexJob, QueueConfig } from './queue/index-queue';

// Auth types
export type { ApiKeyConfig } from './auth/api-key';

// Client types
export type {
  ClientConfig,
  QueryOptions,
  QueryResult as ClientQueryResult,
} from './client';

// Multi-tenant types
export type { TenantConfig, TenantContext } from './tenants/tenant-manager';
export type { TenantMiddlewareConfig } from './tenants/tenant-middleware';
export type { MultiTenantApiConfig } from './api/multi-tenant-routes';
export type { MultiTenantServerConfig } from './multi-tenant-server';
