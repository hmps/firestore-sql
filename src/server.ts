/**
 * Firestore SQL Server - HTTP API server
 */

import { serve } from 'bun';
import { DatabaseManager } from './core/database';
import { SchemaRegistry } from './core/schema-registry';
import { DocumentIndexer } from './core/document-indexer';
import { QueryEngine } from './core/query-engine';
import { FirestoreClient, type FirestoreConfig } from './firestore/client';
import { createApi } from './api/routes';

export interface ServerConfig {
  /** Port to listen on */
  port?: number;
  /** Host to bind to */
  host?: string;
  /** Path to SQLite database file */
  database?: string;
  /** Firestore configuration */
  firestore?: FirestoreConfig;
}

export function startServer(config: ServerConfig = {}) {
  const port = config.port ?? Number(process.env.PORT) ?? 3000;
  const host = config.host ?? '0.0.0.0';
  const dbPath = config.database ?? process.env.DATABASE_PATH ?? ':memory:';

  // Initialize components
  const db = new DatabaseManager(dbPath);
  const schemas = new SchemaRegistry(db);
  const indexer = new DocumentIndexer(db, schemas);
  const query = new QueryEngine(db, schemas);

  let firestore: FirestoreClient | undefined;
  if (config.firestore) {
    firestore = new FirestoreClient(config.firestore);
  }

  // Create API
  const app = createApi({ db, schemas, indexer, query, firestore });

  // Start server
  const server = serve({
    port,
    hostname: host,
    fetch: app.fetch,
  });

  console.log(`🚀 Firestore SQL server running at http://${host}:${port}`);

  return {
    server,
    db,
    schemas,
    indexer,
    query,
    firestore,
    close: () => {
      db.close();
    },
  };
}

// CLI entry point
if (import.meta.main) {
  const config: ServerConfig = {};

  // Parse command line args
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    switch (arg) {
      case '--port':
      case '-p':
        if (nextArg) {
          config.port = parseInt(nextArg, 10);
          i++;
        }
        break;
      case '--database':
      case '-d':
        if (nextArg) {
          config.database = nextArg;
          i++;
        }
        break;
      case '--host':
      case '-h':
        if (nextArg) {
          config.host = nextArg;
          i++;
        }
        break;
    }
  }

  startServer(config);
}
