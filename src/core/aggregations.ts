/**
 * Aggregation support for SQL-like GROUP BY, SUM, AVG, etc.
 */

import type { DatabaseManager } from './database';
import type { SchemaRegistry } from './schema-registry';
import type { FilterCondition, FilterGroup, CollectionSchema } from './types';

export type AggregateFunction = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';

export interface AggregateField {
  /** Field to aggregate */
  field: string;
  /** Aggregation function */
  function: AggregateFunction;
  /** Alias for the result */
  alias?: string;
}

export interface AggregateQuery {
  /** Collection to query */
  collection: string;
  /** Fields to aggregate */
  aggregates: AggregateField[];
  /** Fields to group by */
  groupBy?: string[];
  /** Filters to apply before aggregation */
  filters?: FilterCondition | FilterGroup;
  /** Having clause for filtering after aggregation */
  having?: {
    field: string;
    operator: '=' | '!=' | '>' | '>=' | '<' | '<=';
    value: number;
  };
  /** Order by aggregate result */
  orderBy?: {
    field: string;
    direction: 'ASC' | 'DESC';
  };
  /** Limit results */
  limit?: number;
}

export interface AggregateResult {
  rows: Record<string, unknown>[];
  total: number;
}

export class AggregationEngine {
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
      default:
        params.push(value);
        return `${field} ${operator} ?`;
    }
  }

  /**
   * Execute an aggregation query
   */
  aggregate(query: AggregateQuery): AggregateResult {
    const schema = this.schemas.get(query.collection);
    if (!schema) {
      throw new Error(`Schema not found for collection: ${query.collection}`);
    }

    const tableName = this.db.getTableName(query.collection);
    const params: unknown[] = [];

    // Build SELECT clause
    const selectParts: string[] = [];

    // Add GROUP BY fields
    if (query.groupBy && query.groupBy.length > 0) {
      selectParts.push(...query.groupBy);
    }

    // Add aggregate functions
    for (const agg of query.aggregates) {
      const alias = agg.alias ?? `${agg.function.toLowerCase()}_${agg.field}`;
      if (agg.function === 'COUNT' && agg.field === '*') {
        selectParts.push(`COUNT(*) as ${alias}`);
      } else {
        selectParts.push(`${agg.function}(${agg.field}) as ${alias}`);
      }
    }

    // Build WHERE clause
    let whereClause = '';
    if (query.filters) {
      whereClause = `WHERE ${this.buildWhereClause(query.filters, schema, params)}`;
    }

    // Build GROUP BY clause
    let groupByClause = '';
    if (query.groupBy && query.groupBy.length > 0) {
      groupByClause = `GROUP BY ${query.groupBy.join(', ')}`;
    }

    // Build HAVING clause
    let havingClause = '';
    if (query.having) {
      const { field, operator, value } = query.having;
      havingClause = `HAVING ${field} ${operator} ?`;
      params.push(value);
    }

    // Build ORDER BY clause
    let orderByClause = '';
    if (query.orderBy) {
      orderByClause = `ORDER BY ${query.orderBy.field} ${query.orderBy.direction}`;
    }

    // Build LIMIT clause
    let limitClause = '';
    if (query.limit) {
      limitClause = `LIMIT ${query.limit}`;
    }

    // Build and execute query
    const sql = `
      SELECT ${selectParts.join(', ')}
      FROM ${tableName}
      ${whereClause}
      ${groupByClause}
      ${havingClause}
      ${orderByClause}
      ${limitClause}
    `.trim();

    const rows = this.db.query<Record<string, unknown>>(sql, params);

    return {
      rows,
      total: rows.length,
    };
  }

  /**
   * Quick count aggregation
   */
  count(
    collection: string,
    filters?: FilterCondition | FilterGroup,
    groupBy?: string
  ): number | Record<string, number> {
    const result = this.aggregate({
      collection,
      aggregates: [{ field: '*', function: 'COUNT', alias: 'count' }],
      filters,
      groupBy: groupBy ? [groupBy] : undefined,
    });

    if (groupBy) {
      const grouped: Record<string, number> = {};
      for (const row of result.rows) {
        const key = String(row[groupBy]);
        grouped[key] = row.count as number;
      }
      return grouped;
    }

    return (result.rows[0]?.count as number) ?? 0;
  }

  /**
   * Quick sum aggregation
   */
  sum(
    collection: string,
    field: string,
    filters?: FilterCondition | FilterGroup,
    groupBy?: string
  ): number | Record<string, number> {
    const result = this.aggregate({
      collection,
      aggregates: [{ field, function: 'SUM', alias: 'sum' }],
      filters,
      groupBy: groupBy ? [groupBy] : undefined,
    });

    if (groupBy) {
      const grouped: Record<string, number> = {};
      for (const row of result.rows) {
        const key = String(row[groupBy]);
        grouped[key] = (row.sum as number) ?? 0;
      }
      return grouped;
    }

    return (result.rows[0]?.sum as number) ?? 0;
  }

  /**
   * Quick average aggregation
   */
  avg(
    collection: string,
    field: string,
    filters?: FilterCondition | FilterGroup,
    groupBy?: string
  ): number | Record<string, number> {
    const result = this.aggregate({
      collection,
      aggregates: [{ field, function: 'AVG', alias: 'avg' }],
      filters,
      groupBy: groupBy ? [groupBy] : undefined,
    });

    if (groupBy) {
      const grouped: Record<string, number> = {};
      for (const row of result.rows) {
        const key = String(row[groupBy]);
        grouped[key] = (row.avg as number) ?? 0;
      }
      return grouped;
    }

    return (result.rows[0]?.avg as number) ?? 0;
  }

  /**
   * Quick min/max aggregation
   */
  minMax(
    collection: string,
    field: string,
    filters?: FilterCondition | FilterGroup
  ): { min: number; max: number } {
    const result = this.aggregate({
      collection,
      aggregates: [
        { field, function: 'MIN', alias: 'min' },
        { field, function: 'MAX', alias: 'max' },
      ],
      filters,
    });

    return {
      min: (result.rows[0]?.min as number) ?? 0,
      max: (result.rows[0]?.max as number) ?? 0,
    };
  }

  /**
   * Get statistics for a numeric field
   */
  stats(
    collection: string,
    field: string,
    filters?: FilterCondition | FilterGroup
  ): { count: number; sum: number; avg: number; min: number; max: number } {
    const result = this.aggregate({
      collection,
      aggregates: [
        { field: '*', function: 'COUNT', alias: 'count' },
        { field, function: 'SUM', alias: 'sum' },
        { field, function: 'AVG', alias: 'avg' },
        { field, function: 'MIN', alias: 'min' },
        { field, function: 'MAX', alias: 'max' },
      ],
      filters,
    });

    const row = result.rows[0] ?? {};
    return {
      count: (row.count as number) ?? 0,
      sum: (row.sum as number) ?? 0,
      avg: (row.avg as number) ?? 0,
      min: (row.min as number) ?? 0,
      max: (row.max as number) ?? 0,
    };
  }
}
