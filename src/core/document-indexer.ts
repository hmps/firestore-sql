/**
 * Document indexer for syncing Firestore documents to SQL
 */

import type { DatabaseManager } from './database';
import type { SchemaRegistry } from './schema-registry';
import type { IndexableDocument, SyncStatus } from './types';

export interface IndexResult {
  success: boolean;
  documentId: string;
  error?: string;
}

export interface BulkIndexResult {
  total: number;
  successful: number;
  failed: number;
  results: IndexResult[];
}

export class DocumentIndexer {
  constructor(
    private db: DatabaseManager,
    private schemas: SchemaRegistry
  ) {}

  /** Index a single document */
  index(
    collection: string,
    documentId: string,
    data: Record<string, unknown>
  ): IndexResult {
    const schema = this.schemas.get(collection);
    if (!schema) {
      return {
        success: false,
        documentId,
        error: `Schema not found for collection: ${collection}`,
      };
    }

    // Validate data
    const validation = this.schemas.validate(collection, data);
    if (!validation.valid) {
      this.db.updateSyncStatus(
        collection,
        documentId,
        'error',
        validation.errors.join('; ')
      );
      return {
        success: false,
        documentId,
        error: validation.errors.join('; '),
      };
    }

    try {
      this.db.upsertDocument(collection, documentId, data, schema);
      return { success: true, documentId };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.db.updateSyncStatus(collection, documentId, 'error', errorMessage);
      return { success: false, documentId, error: errorMessage };
    }
  }

  /** Index multiple documents */
  indexBulk(collection: string, documents: IndexableDocument[]): BulkIndexResult {
    const results: IndexResult[] = [];
    let successful = 0;
    let failed = 0;

    for (const doc of documents) {
      const result = this.index(collection, doc.id, doc.data);
      results.push(result);
      if (result.success) {
        successful++;
      } else {
        failed++;
      }
    }

    return {
      total: documents.length,
      successful,
      failed,
      results,
    };
  }

  /** Delete a document from the index */
  delete(collection: string, documentId: string): boolean {
    const schema = this.schemas.get(collection);
    if (!schema) {
      return false;
    }

    return this.db.deleteDocument(collection, documentId);
  }

  /** Delete multiple documents */
  deleteBulk(collection: string, documentIds: string[]): number {
    let deleted = 0;
    for (const id of documentIds) {
      if (this.delete(collection, id)) {
        deleted++;
      }
    }
    return deleted;
  }

  /** Get sync status for a document */
  getSyncStatus(collection: string, documentId: string): SyncStatus | null {
    const result = this.db.query<{
      collection: string;
      document_id: string;
      last_synced: string;
      status: string;
      error: string | null;
    }>(
      'SELECT * FROM _sync_status WHERE collection = ? AND document_id = ?',
      [collection, documentId]
    );

    const row = result[0];
    if (!row) return null;

    return {
      collection: row.collection,
      documentId: row.document_id,
      lastSynced: new Date(row.last_synced),
      status: row.status as 'synced' | 'pending' | 'error',
      error: row.error ?? undefined,
    };
  }

  /** Get all sync statuses for a collection */
  getCollectionSyncStatus(collection: string): SyncStatus[] {
    const results = this.db.query<{
      collection: string;
      document_id: string;
      last_synced: string;
      status: string;
      error: string | null;
    }>('SELECT * FROM _sync_status WHERE collection = ?', [collection]);

    return results.map((row) => ({
      collection: row.collection,
      documentId: row.document_id,
      lastSynced: new Date(row.last_synced),
      status: row.status as 'synced' | 'pending' | 'error',
      error: row.error ?? undefined,
    }));
  }

  /** Get documents with errors */
  getErroredDocuments(collection?: string): SyncStatus[] {
    const sql = collection
      ? 'SELECT * FROM _sync_status WHERE status = ? AND collection = ?'
      : 'SELECT * FROM _sync_status WHERE status = ?';

    const params = collection ? ['error', collection] : ['error'];

    const results = this.db.query<{
      collection: string;
      document_id: string;
      last_synced: string;
      status: string;
      error: string | null;
    }>(sql, params);

    return results.map((row) => ({
      collection: row.collection,
      documentId: row.document_id,
      lastSynced: new Date(row.last_synced),
      status: row.status as 'synced' | 'pending' | 'error',
      error: row.error ?? undefined,
    }));
  }

  /** Clear all documents in a collection */
  clearCollection(collection: string): boolean {
    const schema = this.schemas.get(collection);
    if (!schema) {
      return false;
    }

    const tableName = this.db.getTableName(collection);
    this.db.execute(`DELETE FROM ${tableName}`);
    this.db.execute('DELETE FROM _sync_status WHERE collection = ?', [
      collection,
    ]);

    return true;
  }
}
