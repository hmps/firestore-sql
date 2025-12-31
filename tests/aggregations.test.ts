/**
 * Tests for aggregation engine
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { DatabaseManager } from '../src/core/database';
import { SchemaRegistry } from '../src/core/schema-registry';
import { DocumentIndexer } from '../src/core/document-indexer';
import { AggregationEngine } from '../src/core/aggregations';

describe('AggregationEngine', () => {
  let db: DatabaseManager;
  let schemas: SchemaRegistry;
  let indexer: DocumentIndexer;
  let agg: AggregationEngine;

  beforeEach(() => {
    db = new DatabaseManager(':memory:');
    schemas = new SchemaRegistry(db);
    indexer = new DocumentIndexer(db, schemas);
    agg = new AggregationEngine(db, schemas);

    schemas.register({
      collection: 'sales',
      fields: {
        product: 'string',
        category: 'string',
        quantity: 'number',
        price: 'number',
        region: 'string',
      },
    });

    // Index test data
    indexer.index('sales', 's1', { product: 'Widget A', category: 'Electronics', quantity: 10, price: 99.99, region: 'North' });
    indexer.index('sales', 's2', { product: 'Widget B', category: 'Electronics', quantity: 5, price: 149.99, region: 'South' });
    indexer.index('sales', 's3', { product: 'Gadget X', category: 'Hardware', quantity: 20, price: 49.99, region: 'North' });
    indexer.index('sales', 's4', { product: 'Gadget Y', category: 'Hardware', quantity: 15, price: 79.99, region: 'East' });
    indexer.index('sales', 's5', { product: 'Tool Z', category: 'Tools', quantity: 8, price: 29.99, region: 'North' });
  });

  afterEach(() => {
    db.close();
  });

  describe('count', () => {
    it('should count all documents', () => {
      const count = agg.count('sales');
      expect(count).toBe(5);
    });

    it('should count with filters', () => {
      const count = agg.count('sales', { field: 'category', operator: '=', value: 'Electronics' });
      expect(count).toBe(2);
    });

    it('should count grouped by field', () => {
      const counts = agg.count('sales', undefined, 'category') as Record<string, number>;
      expect(counts['Electronics']).toBe(2);
      expect(counts['Hardware']).toBe(2);
      expect(counts['Tools']).toBe(1);
    });
  });

  describe('sum', () => {
    it('should sum field values', () => {
      const total = agg.sum('sales', 'quantity');
      expect(total).toBe(58); // 10 + 5 + 20 + 15 + 8
    });

    it('should sum with filters', () => {
      const total = agg.sum('sales', 'quantity', { field: 'region', operator: '=', value: 'North' });
      expect(total).toBe(38); // 10 + 20 + 8
    });

    it('should sum grouped by field', () => {
      const sums = agg.sum('sales', 'quantity', undefined, 'category') as Record<string, number>;
      expect(sums['Electronics']).toBe(15); // 10 + 5
      expect(sums['Hardware']).toBe(35); // 20 + 15
      expect(sums['Tools']).toBe(8);
    });
  });

  describe('avg', () => {
    it('should average field values', () => {
      const avg = agg.avg('sales', 'quantity');
      expect(avg).toBeCloseTo(11.6, 1); // 58 / 5
    });

    it('should average with filters', () => {
      const avg = agg.avg('sales', 'price', { field: 'category', operator: '=', value: 'Electronics' });
      expect(avg).toBeCloseTo(124.99, 1); // (99.99 + 149.99) / 2
    });

    it('should average grouped by field', () => {
      const avgs = agg.avg('sales', 'quantity', undefined, 'category') as Record<string, number>;
      expect(avgs['Electronics']).toBeCloseTo(7.5, 1); // 15 / 2
      expect(avgs['Hardware']).toBeCloseTo(17.5, 1); // 35 / 2
      expect(avgs['Tools']).toBe(8);
    });
  });

  describe('minMax', () => {
    it('should get min and max values', () => {
      const { min, max } = agg.minMax('sales', 'price');
      expect(min).toBeCloseTo(29.99, 2);
      expect(max).toBeCloseTo(149.99, 2);
    });

    it('should get min and max with filters', () => {
      const { min, max } = agg.minMax('sales', 'quantity', { field: 'region', operator: '=', value: 'North' });
      expect(min).toBe(8);
      expect(max).toBe(20);
    });
  });

  describe('stats', () => {
    it('should get all stats for a field', () => {
      const stats = agg.stats('sales', 'quantity');
      expect(stats.count).toBe(5);
      expect(stats.sum).toBe(58);
      expect(stats.avg).toBeCloseTo(11.6, 1);
      expect(stats.min).toBe(5);
      expect(stats.max).toBe(20);
    });

    it('should get stats with filters', () => {
      const stats = agg.stats('sales', 'price', { field: 'category', operator: '=', value: 'Hardware' });
      expect(stats.count).toBe(2);
      expect(stats.min).toBeCloseTo(49.99, 2);
      expect(stats.max).toBeCloseTo(79.99, 2);
    });
  });

  describe('aggregate', () => {
    it('should run custom aggregate query', () => {
      const result = agg.aggregate({
        collection: 'sales',
        aggregates: [
          { field: '*', function: 'COUNT', alias: 'total_count' },
          { field: 'quantity', function: 'SUM', alias: 'total_qty' },
        ],
      });

      expect(result.rows.length).toBe(1);
      expect(result.rows[0]?.total_count).toBe(5);
      expect(result.rows[0]?.total_qty).toBe(58);
    });

    it('should aggregate with GROUP BY', () => {
      const result = agg.aggregate({
        collection: 'sales',
        aggregates: [
          { field: '*', function: 'COUNT', alias: 'count' },
          { field: 'quantity', function: 'SUM', alias: 'total_qty' },
        ],
        groupBy: ['category'],
      });

      expect(result.rows.length).toBe(3);
      const electronics = result.rows.find(r => r.category === 'Electronics');
      expect(electronics?.count).toBe(2);
      expect(electronics?.total_qty).toBe(15);
    });

    it('should aggregate with filters', () => {
      const result = agg.aggregate({
        collection: 'sales',
        aggregates: [{ field: 'quantity', function: 'SUM', alias: 'total' }],
        filters: { field: 'price', operator: '>', value: 50 },
      });

      expect(result.rows[0]?.total).toBe(30); // 10 + 5 + 15 (products with price > 50)
    });

    it('should aggregate with HAVING clause', () => {
      const result = agg.aggregate({
        collection: 'sales',
        aggregates: [
          { field: '*', function: 'COUNT', alias: 'count' },
        ],
        groupBy: ['category'],
        having: { field: 'count', operator: '>', value: 1 },
      });

      expect(result.rows.length).toBe(2); // Electronics and Hardware have count > 1
    });

    it('should aggregate with ORDER BY', () => {
      const result = agg.aggregate({
        collection: 'sales',
        aggregates: [
          { field: 'quantity', function: 'SUM', alias: 'total_qty' },
        ],
        groupBy: ['category'],
        orderBy: { field: 'total_qty', direction: 'DESC' },
      });

      expect(result.rows[0]?.category).toBe('Hardware'); // 35 qty
      expect(result.rows[1]?.category).toBe('Electronics'); // 15 qty
      expect(result.rows[2]?.category).toBe('Tools'); // 8 qty
    });

    it('should aggregate with LIMIT', () => {
      const result = agg.aggregate({
        collection: 'sales',
        aggregates: [
          { field: 'quantity', function: 'SUM', alias: 'total_qty' },
        ],
        groupBy: ['category'],
        orderBy: { field: 'total_qty', direction: 'DESC' },
        limit: 2,
      });

      expect(result.rows.length).toBe(2);
    });

    it('should throw error for missing schema', () => {
      expect(() => {
        agg.aggregate({
          collection: 'nonexistent',
          aggregates: [{ field: '*', function: 'COUNT' }],
        });
      }).toThrow('Schema not found');
    });
  });
});
