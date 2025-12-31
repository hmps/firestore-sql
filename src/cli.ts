#!/usr/bin/env bun
/**
 * CLI tool for Firestore SQL
 */

import { parseArgs } from 'util';
import { FirestoreSql } from './sdk';
import { generateApiKey } from './auth/api-key';

const HELP = `
Firestore SQL CLI

Usage:
  firestore-sql <command> [options]

Commands:
  serve           Start the HTTP server
  schema          Manage schemas
  index           Index documents
  query           Query documents
  search          Full-text search
  generate-key    Generate an API key

Options:
  -d, --database  Path to SQLite database file (default: :memory:)
  -p, --port      Server port (default: 3000)
  -h, --help      Show this help message

Examples:
  # Start server
  firestore-sql serve -d ./data.db -p 3000

  # Create a schema
  firestore-sql schema create prospects '{"firstName":"string","score":"number"}'

  # Index a document
  firestore-sql index prospects doc1 '{"firstName":"John","score":85}'

  # Query documents
  firestore-sql query prospects '{"filters":{"field":"score","operator":">=","value":80}}'

  # Generate API key
  firestore-sql generate-key
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    console.log(HELP);
    process.exit(0);
  }

  const command = args[0];
  const restArgs = args.slice(1);

  switch (command) {
    case 'serve':
      await serveCommand(restArgs);
      break;
    case 'schema':
      await schemaCommand(restArgs);
      break;
    case 'index':
      await indexCommand(restArgs);
      break;
    case 'query':
      await queryCommand(restArgs);
      break;
    case 'search':
      await searchCommand(restArgs);
      break;
    case 'generate-key':
      generateKeyCommand(restArgs);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

function parseCommonOptions(args: string[]): { database: string; remaining: string[] } {
  let database = ':memory:';
  const remaining: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg === '-d' || arg === '--database') {
      const nextArg = args[++i];
      if (nextArg) database = nextArg;
    } else {
      remaining.push(arg);
    }
  }

  return { database, remaining };
}

async function serveCommand(args: string[]) {
  const { startServer } = await import('./server');

  let port = 3000;
  let database = ':memory:';
  let host = '0.0.0.0';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-p' || arg === '--port') {
      const nextArg = args[++i];
      if (nextArg) port = parseInt(nextArg, 10);
    } else if (arg === '-d' || arg === '--database') {
      const nextArg = args[++i];
      if (nextArg) database = nextArg;
    } else if (arg === '-h' || arg === '--host') {
      const nextArg = args[++i];
      if (nextArg) host = nextArg;
    }
  }

  startServer({ port, database, host });
}

async function schemaCommand(args: string[]) {
  const { database, remaining } = parseCommonOptions(args);
  const db = new FirestoreSql({ database });

  const subcommand = remaining[0];

  switch (subcommand) {
    case 'list': {
      const schemas = db.schemas.getAll();
      console.log(JSON.stringify(schemas, null, 2));
      break;
    }
    case 'get': {
      const collection = remaining[1];
      if (!collection) {
        console.error('Usage: schema get <collection>');
        process.exit(1);
      }
      const schema = db.schemas.get(collection);
      if (!schema) {
        console.error(`Schema not found: ${collection}`);
        process.exit(1);
      }
      console.log(JSON.stringify(schema, null, 2));
      break;
    }
    case 'create': {
      const collection = remaining[1];
      const fieldsJson = remaining[2];
      if (!collection || !fieldsJson) {
        console.error('Usage: schema create <collection> <fields-json>');
        process.exit(1);
      }
      const fields = JSON.parse(fieldsJson);
      const schema = db.defineSchema(collection, fields);
      console.log(JSON.stringify(schema, null, 2));
      break;
    }
    case 'delete': {
      const collection = remaining[1];
      if (!collection) {
        console.error('Usage: schema delete <collection>');
        process.exit(1);
      }
      const deleted = db.schemas.delete(collection);
      console.log(deleted ? 'Schema deleted' : 'Schema not found');
      break;
    }
    default:
      console.error('Usage: schema <list|get|create|delete> [args]');
      process.exit(1);
  }

  db.close();
}

async function indexCommand(args: string[]) {
  const { database, remaining } = parseCommonOptions(args);
  const db = new FirestoreSql({ database });

  const collection = remaining[0];
  const docId = remaining[1];
  const dataJson = remaining[2];

  if (!collection || !docId || !dataJson) {
    console.error('Usage: index <collection> <docId> <data-json>');
    process.exit(1);
  }

  const data = JSON.parse(dataJson);
  const result = db.index(collection, docId, data);
  console.log(JSON.stringify(result, null, 2));

  db.close();
}

async function queryCommand(args: string[]) {
  const { database, remaining } = parseCommonOptions(args);
  const db = new FirestoreSql({ database });

  const collection = remaining[0];
  const queryJson = remaining[1] ?? '{}';

  if (!collection) {
    console.error('Usage: query <collection> [query-json]');
    process.exit(1);
  }

  const querySpec = JSON.parse(queryJson);
  const result = db.query.execute({
    collection,
    ...querySpec,
  });
  console.log(JSON.stringify(result, null, 2));

  db.close();
}

async function searchCommand(args: string[]) {
  const { SearchEngine } = await import('./core/search');
  const { database, remaining } = parseCommonOptions(args);
  const db = new FirestoreSql({ database });

  const collection = remaining[0];
  const query = remaining[1];

  if (!collection || !query) {
    console.error('Usage: search <collection> <query>');
    process.exit(1);
  }

  const search = new SearchEngine(db.database, db.schemas);

  // Create index if needed
  if (!search.hasSearchIndex(collection)) {
    console.log('Creating search index...');
    search.createSearchIndex(collection);
  }

  const result = search.search(collection, query);
  console.log(JSON.stringify(result, null, 2));

  db.close();
}

function generateKeyCommand(args: string[]) {
  const prefix = args[0] ?? 'fssql';
  const key = generateApiKey(prefix);
  console.log(`Generated API Key: ${key}`);
  console.log(`\nAdd to your environment or config:`);
  console.log(`  API_KEYS=${key}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
