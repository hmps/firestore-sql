/**
 * Tests for FTS5 full-text search
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { DatabaseManager } from '../src/core/database';
import { SchemaRegistry } from '../src/core/schema-registry';
import { DocumentIndexer } from '../src/core/document-indexer';
import { SearchEngine } from '../src/core/search';

describe('SearchEngine', () => {
  let db: DatabaseManager;
  let schemas: SchemaRegistry;
  let indexer: DocumentIndexer;
  let search: SearchEngine;

  beforeEach(() => {
    db = new DatabaseManager(':memory:');
    schemas = new SchemaRegistry(db);
    indexer = new DocumentIndexer(db, schemas);
    search = new SearchEngine(db, schemas);

    schemas.register({
      collection: 'articles',
      fields: {
        title: 'string',
        content: 'string',
        author: 'string',
        views: 'number',
      },
    });

    // Index test data
    indexer.index('articles', 'art1', {
      title: 'Introduction to TypeScript',
      content: 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.',
      author: 'John Doe',
      views: 1000,
    });
    indexer.index('articles', 'art2', {
      title: 'Advanced JavaScript Patterns',
      content: 'Learn about closures, prototypes, and modern JavaScript features.',
      author: 'Jane Smith',
      views: 500,
    });
    indexer.index('articles', 'art3', {
      title: 'Getting Started with Bun',
      content: 'Bun is a fast all-in-one JavaScript runtime with a bundler, transpiler, and package manager.',
      author: 'Bob Wilson',
      views: 750,
    });
  });

  afterEach(() => {
    db.close();
  });

  it('should create search index', () => {
    search.createSearchIndex('articles');
    expect(search.hasSearchIndex('articles')).toBe(true);
  });

  it('should drop search index', () => {
    search.createSearchIndex('articles');
    search.dropSearchIndex('articles');
    expect(search.hasSearchIndex('articles')).toBe(false);
  });

  it('should search documents by term', () => {
    search.createSearchIndex('articles');

    const result = search.search('articles', 'TypeScript');
    expect(result.documents.length).toBe(1);
    expect(result.documents[0]?._id).toBe('art1');
    expect(result.documents[0]?._score).toBeGreaterThan(0);
  });

  it('should search documents with multiple matches', () => {
    search.createSearchIndex('articles');

    const result = search.search('articles', 'JavaScript');
    expect(result.documents.length).toBe(3); // TypeScript mentions JavaScript, and art2/art3 have JavaScript
  });

  it('should return total count', () => {
    search.createSearchIndex('articles');

    const result = search.search('articles', 'JavaScript');
    expect(result.total).toBe(3);
  });

  it('should paginate results', () => {
    search.createSearchIndex('articles');

    const result = search.search('articles', 'JavaScript', { limit: 2, offset: 1 });
    expect(result.documents.length).toBe(2);
    expect(result.total).toBe(3);
  });

  it('should throw error for missing search index', () => {
    expect(() => {
      search.search('articles', 'test');
    }).toThrow('Search index not found');
  });

  it('should throw error for non-existent schema', () => {
    expect(() => {
      search.createSearchIndex('nonexistent');
    }).toThrow('Schema not found');
  });

  it('should auto-sync with document updates', () => {
    search.createSearchIndex('articles');

    // Add new document
    indexer.index('articles', 'art4', {
      title: 'Rust Programming',
      content: 'Rust is a systems programming language focused on safety and performance.',
      author: 'Alice Brown',
      views: 200,
    });

    const result = search.search('articles', 'Rust');
    expect(result.documents.length).toBe(1);
    expect(result.documents[0]?._id).toBe('art4');
  });

  it('should auto-sync with document deletes', () => {
    search.createSearchIndex('articles');

    // Verify document exists in search
    let result = search.search('articles', 'Bun');
    expect(result.documents.length).toBe(1);

    // Delete document
    indexer.delete('articles', 'art3');

    // Verify document is removed from search
    result = search.search('articles', 'Bun');
    expect(result.documents.length).toBe(0);
  });

  it('should suggest matching document IDs', () => {
    search.createSearchIndex('articles');

    const suggestions = search.suggest('articles', 'Type');
    expect(suggestions.length).toBeGreaterThan(0);
  });
});
