/**
 * Firestore client integration for syncing documents
 */

import type { App } from 'firebase-admin/app';
import type { Firestore, DocumentSnapshot } from 'firebase-admin/firestore';
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { DocumentIndexer } from '../core/document-indexer';
import type { SchemaRegistry } from '../core/schema-registry';
import type { CollectionSchema } from '../core/types';

export interface FirestoreConfig {
  /** Path to service account JSON file */
  serviceAccountPath?: string;
  /** Service account object */
  serviceAccount?: object;
  /** Project ID (optional if service account provided) */
  projectId?: string;
  /** Use emulator */
  emulator?: {
    host: string;
    port: number;
  };
}

export interface SyncOptions {
  /** Only sync documents matching this filter */
  where?: Array<{
    field: string;
    operator: FirebaseFirestore.WhereFilterOp;
    value: unknown;
  }>;
  /** Maximum documents to sync */
  limit?: number;
  /** Field to use for ordering */
  orderBy?: string;
}

export class FirestoreClient {
  private app: App;
  private firestore: Firestore;

  constructor(config: FirestoreConfig = {}) {
    // Check for existing app
    const existingApps = getApps();
    if (existingApps.length > 0) {
      this.app = getApp();
    } else if (config.serviceAccountPath) {
      const serviceAccount = require(config.serviceAccountPath);
      this.app = initializeApp({
        credential: cert(serviceAccount),
        projectId: config.projectId ?? serviceAccount.project_id,
      });
    } else if (config.serviceAccount) {
      this.app = initializeApp({
        credential: cert(config.serviceAccount as Parameters<typeof cert>[0]),
        projectId: config.projectId,
      });
    } else if (config.projectId) {
      this.app = initializeApp({
        projectId: config.projectId,
      });
    } else {
      // Default initialization (uses GOOGLE_APPLICATION_CREDENTIALS env var)
      this.app = initializeApp();
    }

    this.firestore = getFirestore(this.app);

    if (config.emulator) {
      this.firestore.settings({
        host: `${config.emulator.host}:${config.emulator.port}`,
        ssl: false,
      });
    }
  }

  /** Get the Firestore instance */
  getFirestore(): Firestore {
    return this.firestore;
  }

  /** Extract document data based on schema */
  private extractDocumentData(
    doc: DocumentSnapshot,
    schema: CollectionSchema
  ): Record<string, unknown> {
    const data = doc.data() ?? {};
    const extracted: Record<string, unknown> = {};

    for (const fieldName of Object.keys(schema.fields)) {
      extracted[fieldName] = data[fieldName];
    }

    return extracted;
  }

  /** Sync a single document from Firestore */
  async syncDocument(
    collection: string,
    documentId: string,
    indexer: DocumentIndexer,
    schemas: SchemaRegistry
  ): Promise<{ success: boolean; error?: string }> {
    const schema = schemas.get(collection);
    if (!schema) {
      return { success: false, error: `Schema not found: ${collection}` };
    }

    try {
      const docRef = this.firestore.collection(collection).doc(documentId);
      const doc = await docRef.get();

      if (!doc.exists) {
        // Document was deleted, remove from index
        indexer.delete(collection, documentId);
        return { success: true };
      }

      const data = this.extractDocumentData(doc, schema);
      const result = indexer.index(collection, documentId, data);

      return { success: result.success, error: result.error };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /** Sync all documents in a collection */
  async syncCollection(
    collection: string,
    indexer: DocumentIndexer,
    schemas: SchemaRegistry,
    options: SyncOptions = {}
  ): Promise<{
    total: number;
    successful: number;
    failed: number;
    errors: Array<{ id: string; error: string }>;
  }> {
    const schema = schemas.get(collection);
    if (!schema) {
      throw new Error(`Schema not found: ${collection}`);
    }

    let query: FirebaseFirestore.Query = this.firestore.collection(collection);

    // Apply filters
    if (options.where) {
      for (const filter of options.where) {
        query = query.where(filter.field, filter.operator, filter.value);
      }
    }

    // Apply ordering
    if (options.orderBy) {
      query = query.orderBy(options.orderBy);
    }

    // Apply limit
    if (options.limit) {
      query = query.limit(options.limit);
    }

    const snapshot = await query.get();

    let successful = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (const doc of snapshot.docs) {
      const data = this.extractDocumentData(doc, schema);
      const result = indexer.index(collection, doc.id, data);

      if (result.success) {
        successful++;
      } else {
        failed++;
        errors.push({ id: doc.id, error: result.error ?? 'Unknown error' });
      }
    }

    return {
      total: snapshot.docs.length,
      successful,
      failed,
      errors,
    };
  }

  /** Watch a collection for real-time updates */
  watchCollection(
    collection: string,
    indexer: DocumentIndexer,
    schemas: SchemaRegistry,
    options: SyncOptions = {}
  ): () => void {
    const schema = schemas.get(collection);
    if (!schema) {
      throw new Error(`Schema not found: ${collection}`);
    }

    let query: FirebaseFirestore.Query = this.firestore.collection(collection);

    if (options.where) {
      for (const filter of options.where) {
        query = query.where(filter.field, filter.operator, filter.value);
      }
    }

    const unsubscribe = query.onSnapshot(
      (snapshot) => {
        for (const change of snapshot.docChanges()) {
          const doc = change.doc;

          switch (change.type) {
            case 'added':
            case 'modified': {
              const data = this.extractDocumentData(doc, schema);
              indexer.index(collection, doc.id, data);
              break;
            }
            case 'removed': {
              indexer.delete(collection, doc.id);
              break;
            }
          }
        }
      },
      (error) => {
        console.error(`Firestore watch error for ${collection}:`, error);
      }
    );

    return unsubscribe;
  }

  /** Fetch a single document from Firestore */
  async getDocument(
    collection: string,
    documentId: string
  ): Promise<Record<string, unknown> | null> {
    const doc = await this.firestore.collection(collection).doc(documentId).get();
    return doc.exists ? doc.data() ?? null : null;
  }
}
