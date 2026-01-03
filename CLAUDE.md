# Firestore SQL

A bridge between Firestore and SQL for advanced querying - like Typesense but for Firestore collections.

## Overview

This service indexes Firestore documents into SQLite, enabling SQL-like querying capabilities for large collections that are impractical to filter client-side.

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (fully typed)
- **Database**: SQLite (via bun:sqlite)
- **API Framework**: Hono
- **GraphQL**: graphql-yoga
- **Validation**: Zod
- **Firestore**: firebase-admin

## Project Structure

```
src/
├── core/           # Core business logic
│   ├── database.ts      # SQLite database management
│   ├── schema-registry.ts # Collection schema management
│   ├── document-indexer.ts # Document sync operations
│   ├── query-engine.ts   # SQL query builder
│   └── types.ts         # Type definitions
├── api/            # REST API & GraphQL
│   ├── routes.ts        # Hono routes
│   └── graphql.ts       # GraphQL schema & resolvers
├── firestore/      # Firestore integration
│   └── client.ts        # Firebase Admin SDK wrapper
├── sdk.ts          # Main SDK client
├── server.ts       # HTTP server entry point
└── index.ts        # Main exports
```

## Commands

```bash
# Development server with hot reload
bun run dev

# Production server
bun run start

# Run example
bun run example

# Type check
bun run typecheck

# Run tests
bun test
```

## Usage

### SDK Usage

```typescript
import { FirestoreSql } from 'firestore-sql';

const db = new FirestoreSql({ database: './data.db' });

// Define schema
db.defineSchema('prospects', {
  firstName: 'string',
  lastName: 'string',
  email: { type: 'string', indexed: true },
  score: 'number',
  isActive: 'boolean',
});

// Index documents
db.index('prospects', 'doc1', {
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  score: 85,
  isActive: true,
});

// Query with type safety
const results = db.collection<Prospect>('prospects')
  .where('score', '>=', 80)
  .where('isActive', '=', true)
  .orderBy('score', 'DESC')
  .limit(10)
  .execute();
```

### REST API

```bash
# Start server
bun run start

# Define schema
curl -X POST http://localhost:3000/schemas/prospects \
  -H "Content-Type: application/json" \
  -d '{"fields": {"firstName": "string", "score": "number"}}'

# Index document
curl -X POST http://localhost:3000/documents/prospects/doc1 \
  -H "Content-Type: application/json" \
  -d '{"firstName": "John", "score": 85}'

# Query
curl -X POST http://localhost:3000/query/prospects \
  -H "Content-Type: application/json" \
  -d '{"filters": {"field": "score", "operator": ">=", "value": 80}}'
```

### GraphQL API

The server also exposes a GraphQL endpoint at `/graphql` with GraphiQL interface enabled.

```bash
# Query documents with filtering
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ documents(collection: \"prospects\", filters: [{field: \"score\", operator: GTE, value: 80}], sort: [{field: \"score\", direction: DESC}]) { documents total } }"
  }'

# Get all schemas
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ schemas { collection fields } }"}'
```

#### GraphQL Query Operators

- `EQ` (=), `NE` (!=), `GT` (>), `GTE` (>=), `LT` (<), `LTE` (<=)
- `LIKE` - Pattern matching
- `IN`, `NOT_IN` - Array membership
- `IS_NULL`, `IS_NOT_NULL` - Null checks

## Field Types

- `string` - Text data
- `number` - Numeric data (stored as REAL)
- `boolean` - Boolean (stored as INTEGER 0/1)
- `datetime` - Date/time (stored as ISO string)

## Query Operators

- `=`, `!=`, `>`, `>=`, `<`, `<=`
- `LIKE` - Pattern matching with `%` wildcards
- `IN`, `NOT IN` - Value in array
- `IS NULL`, `IS NOT NULL` - Null checks

## Multi-Tenant Mode

For SaaS applications, use multi-tenant mode where each customer gets their own isolated SQLite database:

```typescript
import { startMultiTenantServer } from 'firestore-sql';

startMultiTenantServer({
  dataDir: './data/tenants',  // Each tenant gets: ./data/tenants/{tenantId}.db
  apiKeys: ['your-api-key'],  // Optional API key auth
});
```

### Multi-Tenant API Usage

```bash
# List all tenants
curl http://localhost:3000/tenants

# Tenant-scoped operations (via header)
curl -X POST http://localhost:3000/schemas/products \
  -H "x-tenant-id: customer-123" \
  -H "Content-Type: application/json" \
  -d '{"fields": {"name": "string", "price": "number"}}'

# Query a tenant's data
curl -X POST http://localhost:3000/query/products \
  -H "x-tenant-id: customer-123" \
  -H "Content-Type: application/json" \
  -d '{"filters": {"field": "price", "operator": ">=", "value": 100}}'

# Delete a tenant and all their data
curl -X DELETE http://localhost:3000/tenants/customer-123
```

### Tenant ID Resolution

Tenant ID can be provided via:
1. `x-tenant-id` header
2. `tenant_id` query parameter
3. Path parameter (if configured)

## Bun Development Notes

- Use `bun:sqlite` for SQLite (not better-sqlite3)
- Use Hono for HTTP framework
- Bun auto-loads `.env` files (no dotenv needed)
- Use `bun test` for testing
- Prefer `Bun.file` over `node:fs` where applicable
