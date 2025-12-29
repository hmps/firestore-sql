/**
 * Query engine for SQL-like filtering of indexed documents
 */

import type { DatabaseManager } from './database';
import type { SchemaRegistry } from './schema-registry';
import type {
  FilterCondition,
  FilterGroup,
  QueryResult,
  QuerySpec,
  SortSpec,
  CollectionSchema,
} from './types';

export class QueryEngine {
  constructor(
    private db: DatabaseManager,
    private schemas: SchemaRegistry
  ) {}

  /** Check if a filter is a group */
  private isFilterGroup(
    filter: FilterCondition | FilterGroup
  ): filter is FilterGroup {
    return 'operator' in filter && 'conditions' in filter;
  }

  /** Build WHERE clause from filters */
  private buildWhereClause(
    filter: FilterCondition | FilterGroup,
    schema: CollectionSchema,
    params: unknown[]
  ): string {
    if (this.isFilterGroup(filter)) {
      const clauses = filter.conditions.map((c) =>
        this.buildWhereClause(c, schema, params)
      );
      return `(${clauses.join(` ${filter.operator} `)})`;
    }

    const { field, operator, value } = filter;

    // Validate field exists in schema
    if (field !== '_id' && !schema.fields[field]) {
      throw new Error(`Field "${field}" not found in schema`);
    }

    switch (operator) {
      case 'IS NULL':
        return `${field} IS NULL`;

      case 'IS NOT NULL':
        return `${field} IS NOT NULL`;

      case 'IN':
      case 'NOT IN': {
        if (!Array.isArray(value)) {
          throw new Error(`${operator} requires an array value`);
        }
        const placeholders = value.map(() => '?').join(', ');
        params.push(...value);
        return `${field} ${operator} (${placeholders})`;
      }

      case 'LIKE':
        params.push(value);
        return `${field} LIKE ?`;

      default:
        params.push(value);
        return `${field} ${operator} ?`;
    }
  }

  /** Build ORDER BY clause */
  private buildOrderByClause(sort: SortSpec[]): string {
    if (sort.length === 0) return '';
    const clauses = sort.map((s) => `${s.field} ${s.direction}`);
    return `ORDER BY ${clauses.join(', ')}`;
  }

  /** Build SELECT clause */
  private buildSelectClause(select?: string[], schema?: CollectionSchema): string {
    if (!select || select.length === 0) {
      return '*';
    }

    // Always include _id
    const fields = new Set(['_id', ...select]);

    // Validate fields exist
    if (schema) {
      for (const field of select) {
        if (field !== '_id' && !schema.fields[field]) {
          throw new Error(`Field "${field}" not found in schema`);
        }
      }
    }

    return Array.from(fields).join(', ');
  }

  /** Execute a query */
  execute<T = Record<string, unknown>>(query: QuerySpec): QueryResult<T> {
    const schema = this.schemas.get(query.collection);
    if (!schema) {
      throw new Error(`Schema not found for collection: ${query.collection}`);
    }

    const tableName = this.db.getTableName(query.collection);
    const params: unknown[] = [];

    // Build SELECT
    const selectClause = this.buildSelectClause(query.select, schema);

    // Build WHERE
    let whereClause = '';
    if (query.filters) {
      whereClause = `WHERE ${this.buildWhereClause(query.filters, schema, params)}`;
    }

    // Build ORDER BY
    const orderByClause = query.sort ? this.buildOrderByClause(query.sort) : '';

    // Build LIMIT and OFFSET
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    const limitClause = `LIMIT ${limit} OFFSET ${offset}`;

    // Get total count
    const countSql = `SELECT COUNT(*) as count FROM ${tableName} ${whereClause}`;
    const countResult = this.db.query<{ count: number }>(countSql, [...params]);
    const total = countResult[0]?.count ?? 0;

    // Get documents
    const dataSql = `SELECT ${selectClause} FROM ${tableName} ${whereClause} ${orderByClause} ${limitClause}`;
    const documents = this.db.query<T>(dataSql, params);

    // Transform boolean fields back
    const transformedDocs = documents.map((doc) => {
      const transformed = { ...doc } as Record<string, unknown>;
      for (const [field, fieldDef] of Object.entries(schema.fields)) {
        if (fieldDef.type === 'boolean' && field in transformed) {
          transformed[field] = transformed[field] === 1;
        }
      }
      return transformed as T;
    });

    return {
      documents: transformedDocs,
      total,
      limit,
      offset,
    };
  }

  /** Execute a raw SQL query (for advanced use cases) */
  raw<T = Record<string, unknown>>(
    collection: string,
    sql: string,
    params: unknown[] = []
  ): T[] {
    const schema = this.schemas.get(collection);
    if (!schema) {
      throw new Error(`Schema not found for collection: ${collection}`);
    }

    const tableName = this.db.getTableName(collection);
    const fullSql = sql.replace(/\$TABLE/g, tableName);

    return this.db.query<T>(fullSql, params);
  }

  /** Count documents matching a filter */
  count(collection: string, filters?: FilterCondition | FilterGroup): number {
    const schema = this.schemas.get(collection);
    if (!schema) {
      throw new Error(`Schema not found for collection: ${collection}`);
    }

    const tableName = this.db.getTableName(collection);
    const params: unknown[] = [];

    let whereClause = '';
    if (filters) {
      whereClause = `WHERE ${this.buildWhereClause(filters, schema, params)}`;
    }

    const sql = `SELECT COUNT(*) as count FROM ${tableName} ${whereClause}`;
    const result = this.db.query<{ count: number }>(sql, params);

    return result[0]?.count ?? 0;
  }

  /** Check if any documents match a filter */
  exists(collection: string, filters: FilterCondition | FilterGroup): boolean {
    return this.count(collection, filters) > 0;
  }

  /** Get distinct values for a field */
  distinct(collection: string, field: string): unknown[] {
    const schema = this.schemas.get(collection);
    if (!schema) {
      throw new Error(`Schema not found for collection: ${collection}`);
    }

    if (!schema.fields[field]) {
      throw new Error(`Field "${field}" not found in schema`);
    }

    const tableName = this.db.getTableName(collection);
    const sql = `SELECT DISTINCT ${field} FROM ${tableName} WHERE ${field} IS NOT NULL ORDER BY ${field}`;
    const results = this.db.query<Record<string, unknown>>(sql, []);

    return results.map((r) => r[field]);
  }
}
