/**
 * Full-text search using SQLite FTS5
 */

import type { Database } from 'bun:sqlite';
import type { DatabaseManager } from './database';
import type { SchemaRegistry } from './schema-registry';
import type { CollectionSchema } from './types';

export interface SearchResult<T = Record<string, unknown>> {
  documents: Array<T & { _id: string; _score: number }>;
  total: number;
}

export interface SearchOptions {
  /** Fields to search in (defaults to all string fields) */
  fields?: string[];
  /** Maximum results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Highlight matching terms */
  highlight?: boolean;
  /** Snippet length for highlights */
  snippetLength?: number;
}

export class SearchEngine {
  constructor(
    private db: DatabaseManager,
    private schemas: SchemaRegistry
  ) {}

  /** Get FTS table name for a collection */
  private getFtsTableName(collection: string): string {
    return `${this.db.getTableName(collection)}_fts`;
  }

  /** Get string fields from schema */
  private getStringFields(schema: CollectionSchema): string[] {
    return Object.entries(schema.fields)
      .filter(([_, def]) => def.type === 'string')
      .map(([name]) => name);
  }

  /**
   * Create FTS5 virtual table for a collection
   */
  createSearchIndex(collection: string): void {
    const schema = this.schemas.get(collection);
    if (!schema) {
      throw new Error(`Schema not found for collection: ${collection}`);
    }

    const stringFields = this.getStringFields(schema);
    if (stringFields.length === 0) {
      throw new Error(`No string fields found in schema for collection: ${collection}`);
    }

    const tableName = this.db.getTableName(collection);
    const ftsTableName = this.getFtsTableName(collection);

    // Drop existing FTS table if exists
    this.db.getDb().exec(`DROP TABLE IF EXISTS ${ftsTableName}`);

    // Create FTS5 virtual table
    const ftsColumns = ['_id', ...stringFields].join(', ');
    this.db.getDb().exec(`
      CREATE VIRTUAL TABLE ${ftsTableName} USING fts5(
        ${ftsColumns},
        content='${tableName}',
        content_rowid='rowid'
      )
    `);

    // Create triggers to keep FTS in sync
    this.db.getDb().exec(`
      CREATE TRIGGER IF NOT EXISTS ${tableName}_ai AFTER INSERT ON ${tableName} BEGIN
        INSERT INTO ${ftsTableName}(rowid, ${ftsColumns})
        VALUES (NEW.rowid, ${['NEW._id', ...stringFields.map(f => `NEW.${f}`)].join(', ')});
      END
    `);

    this.db.getDb().exec(`
      CREATE TRIGGER IF NOT EXISTS ${tableName}_ad AFTER DELETE ON ${tableName} BEGIN
        INSERT INTO ${ftsTableName}(${ftsTableName}, rowid, ${ftsColumns})
        VALUES ('delete', OLD.rowid, ${['OLD._id', ...stringFields.map(f => `OLD.${f}`)].join(', ')});
      END
    `);

    this.db.getDb().exec(`
      CREATE TRIGGER IF NOT EXISTS ${tableName}_au AFTER UPDATE ON ${tableName} BEGIN
        INSERT INTO ${ftsTableName}(${ftsTableName}, rowid, ${ftsColumns})
        VALUES ('delete', OLD.rowid, ${['OLD._id', ...stringFields.map(f => `OLD.${f}`)].join(', ')});
        INSERT INTO ${ftsTableName}(rowid, ${ftsColumns})
        VALUES (NEW.rowid, ${['NEW._id', ...stringFields.map(f => `NEW.${f}`)].join(', ')});
      END
    `);

    // Populate FTS table with existing data
    this.db.getDb().exec(`
      INSERT INTO ${ftsTableName}(rowid, ${ftsColumns})
      SELECT rowid, ${ftsColumns} FROM ${tableName}
    `);
  }

  /**
   * Drop FTS index for a collection
   */
  dropSearchIndex(collection: string): void {
    const tableName = this.db.getTableName(collection);
    const ftsTableName = this.getFtsTableName(collection);

    this.db.getDb().exec(`DROP TRIGGER IF EXISTS ${tableName}_ai`);
    this.db.getDb().exec(`DROP TRIGGER IF EXISTS ${tableName}_ad`);
    this.db.getDb().exec(`DROP TRIGGER IF EXISTS ${tableName}_au`);
    this.db.getDb().exec(`DROP TABLE IF EXISTS ${ftsTableName}`);
  }

  /**
   * Check if FTS index exists for a collection
   */
  hasSearchIndex(collection: string): boolean {
    const ftsTableName = this.getFtsTableName(collection);
    const result = this.db.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [ftsTableName]
    );
    return result.length > 0;
  }

  /**
   * Search documents using FTS5
   */
  search<T = Record<string, unknown>>(
    collection: string,
    query: string,
    options: SearchOptions = {}
  ): SearchResult<T> {
    const schema = this.schemas.get(collection);
    if (!schema) {
      throw new Error(`Schema not found for collection: ${collection}`);
    }

    const tableName = this.db.getTableName(collection);
    const ftsTableName = this.getFtsTableName(collection);

    // Check if FTS table exists
    if (!this.hasSearchIndex(collection)) {
      throw new Error(`Search index not found for collection: ${collection}. Call createSearchIndex first.`);
    }

    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    // Escape query for FTS5
    const escapedQuery = query.replace(/"/g, '""');

    // Get total count
    const countSql = `
      SELECT COUNT(*) as count
      FROM ${ftsTableName}
      WHERE ${ftsTableName} MATCH ?
    `;
    const countResult = this.db.query<{ count: number }>(countSql, [`"${escapedQuery}"`]);
    const total = countResult[0]?.count ?? 0;

    // Get documents with scores
    let selectFields = '*';
    if (options.highlight) {
      const stringFields = this.getStringFields(schema);
      const snippetLen = options.snippetLength ?? 64;
      selectFields = stringFields
        .map((f, i) => `snippet(${ftsTableName}, ${i + 1}, '<mark>', '</mark>', '...', ${snippetLen}) as ${f}_highlighted`)
        .join(', ') + ', *';
    }

    const sql = `
      SELECT ${selectFields}, bm25(${ftsTableName}) as _score
      FROM ${ftsTableName}
      WHERE ${ftsTableName} MATCH ?
      ORDER BY _score
      LIMIT ? OFFSET ?
    `;

    const documents = this.db.query<T & { _id: string; _score: number }>(
      sql,
      [`"${escapedQuery}"`, limit, offset]
    );

    // Fetch full documents from main table
    const fullDocs = documents.map((doc) => {
      const fullDoc = this.db.query<T>(
        `SELECT * FROM ${tableName} WHERE _id = ?`,
        [doc._id]
      )[0];

      return {
        ...fullDoc,
        _id: doc._id,
        _score: Math.abs(doc._score), // BM25 returns negative scores
      } as T & { _id: string; _score: number };
    });

    return {
      documents: fullDocs,
      total,
    };
  }

  /**
   * Autocomplete/suggest based on prefix
   */
  suggest(
    collection: string,
    prefix: string,
    options: { limit?: number; field?: string } = {}
  ): string[] {
    if (!this.hasSearchIndex(collection)) {
      throw new Error(`Search index not found for collection: ${collection}`);
    }

    const ftsTableName = this.getFtsTableName(collection);
    const limit = options.limit ?? 10;

    // Use FTS5 prefix search
    const sql = `
      SELECT DISTINCT _id
      FROM ${ftsTableName}
      WHERE ${ftsTableName} MATCH ?
      LIMIT ?
    `;

    const results = this.db.query<{ _id: string }>(sql, [`${prefix}*`, limit]);
    return results.map((r) => r._id);
  }
}
