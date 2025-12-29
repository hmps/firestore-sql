/**
 * Core type definitions for Firestore SQL Bridge
 */

/** Supported field types for indexing */
export type FieldType = 'string' | 'number' | 'boolean' | 'datetime';

/** Schema field definition */
export interface FieldDefinition {
  type: FieldType;
  nullable?: boolean;
  indexed?: boolean;
}

/** Collection schema definition */
export interface CollectionSchema {
  collection: string;
  fields: Record<string, FieldDefinition>;
  createdAt: Date;
  updatedAt: Date;
}

/** Document to be indexed */
export interface IndexableDocument {
  id: string;
  data: Record<string, unknown>;
}

/** Comparison operators for queries */
export type ComparisonOperator =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'LIKE'
  | 'IN'
  | 'NOT IN'
  | 'IS NULL'
  | 'IS NOT NULL';

/** Single filter condition */
export interface FilterCondition {
  field: string;
  operator: ComparisonOperator;
  value: unknown;
}

/** Logical operators for combining filters */
export type LogicalOperator = 'AND' | 'OR';

/** Filter group for complex queries */
export interface FilterGroup {
  operator: LogicalOperator;
  conditions: (FilterCondition | FilterGroup)[];
}

/** Sort direction */
export type SortDirection = 'ASC' | 'DESC';

/** Sort specification */
export interface SortSpec {
  field: string;
  direction: SortDirection;
}

/** Query specification */
export interface QuerySpec {
  collection: string;
  filters?: FilterCondition | FilterGroup;
  sort?: SortSpec[];
  limit?: number;
  offset?: number;
  select?: string[];
}

/** Query result */
export interface QueryResult<T = Record<string, unknown>> {
  documents: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Sync status for a document */
export interface SyncStatus {
  collection: string;
  documentId: string;
  lastSynced: Date;
  status: 'synced' | 'pending' | 'error';
  error?: string;
}
