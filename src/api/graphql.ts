/**
 * GraphQL API for Firestore SQL Bridge
 *
 * Provides a flexible GraphQL interface for querying indexed collections.
 */

import { createSchema, createYoga } from 'graphql-yoga';
import type { DatabaseManager } from '../core/database';
import type { SchemaRegistry } from '../core/schema-registry';
import type { DocumentIndexer } from '../core/document-indexer';
import type { QueryEngine } from '../core/query-engine';
import type { FilterCondition, FilterGroup } from '../core/types';

export interface GraphQLContext {
  db: DatabaseManager;
  schemas: SchemaRegistry;
  indexer: DocumentIndexer;
  query: QueryEngine;
}

// GraphQL Schema Definition
const typeDefs = /* GraphQL */ `
  scalar JSON

  enum FieldType {
    string
    number
    boolean
    datetime
  }

  enum Operator {
    EQ
    NE
    GT
    GTE
    LT
    LTE
    LIKE
    IN
    NOT_IN
    IS_NULL
    IS_NOT_NULL
  }

  enum SortDirection {
    ASC
    DESC
  }

  enum LogicalOperator {
    AND
    OR
  }

  type FieldDefinition {
    type: FieldType!
    nullable: Boolean
    indexed: Boolean
  }

  type CollectionSchema {
    collection: String!
    fields: JSON!
    createdAt: String!
    updatedAt: String!
  }

  type Document {
    _id: String!
    data: JSON!
  }

  type QueryResult {
    documents: [JSON!]!
    total: Int!
    limit: Int!
    offset: Int!
  }

  type SyncStatus {
    collection: String!
    documentId: String!
    lastSynced: String!
    status: String!
    error: String
  }

  type IndexResult {
    success: Boolean!
    documentId: String!
    error: String
  }

  type BulkIndexResult {
    total: Int!
    successful: Int!
    failed: Int!
  }

  input FieldDefinitionInput {
    type: FieldType!
    nullable: Boolean
    indexed: Boolean
  }

  input FilterInput {
    field: String!
    operator: Operator!
    value: JSON
  }

  input FilterGroupInput {
    operator: LogicalOperator!
    conditions: [FilterInput!]!
  }

  input SortInput {
    field: String!
    direction: SortDirection!
  }

  input DocumentInput {
    id: String!
    data: JSON!
  }

  type Query {
    # Schema queries
    schemas: [CollectionSchema!]!
    schema(collection: String!): CollectionSchema

    # Document queries
    documents(
      collection: String!
      filters: [FilterInput!]
      filterGroup: FilterGroupInput
      sort: [SortInput!]
      limit: Int
      offset: Int
      select: [String!]
    ): QueryResult!

    document(collection: String!, id: String!): JSON

    count(
      collection: String!
      filters: [FilterInput!]
      filterGroup: FilterGroupInput
    ): Int!

    distinct(collection: String!, field: String!): [JSON!]!

    # Sync status
    syncStatus(collection: String!, documentId: String!): SyncStatus
    collectionSyncStatus(collection: String!): [SyncStatus!]!
    erroredDocuments(collection: String): [SyncStatus!]!
  }

  type Mutation {
    # Schema mutations
    createSchema(collection: String!, fields: JSON!): CollectionSchema!
    deleteSchema(collection: String!): Boolean!

    # Document mutations
    indexDocument(collection: String!, id: String!, data: JSON!): IndexResult!
    indexDocuments(collection: String!, documents: [DocumentInput!]!): BulkIndexResult!
    deleteDocument(collection: String!, id: String!): Boolean!
    clearCollection(collection: String!): Boolean!
  }
`;

// Operator mapping from GraphQL enum to SQL operators
const operatorMap: Record<string, string> = {
  EQ: '=',
  NE: '!=',
  GT: '>',
  GTE: '>=',
  LT: '<',
  LTE: '<=',
  LIKE: 'LIKE',
  IN: 'IN',
  NOT_IN: 'NOT IN',
  IS_NULL: 'IS NULL',
  IS_NOT_NULL: 'IS NOT NULL',
};

// Convert GraphQL filter input to our filter format
function convertFilter(filter: {
  field: string;
  operator: string;
  value: unknown;
}): FilterCondition {
  return {
    field: filter.field,
    operator: operatorMap[filter.operator] as FilterCondition['operator'],
    value: filter.value,
  };
}

function convertFilterGroup(group: {
  operator: string;
  conditions: Array<{ field: string; operator: string; value: unknown }>;
}): FilterGroup {
  return {
    operator: group.operator as 'AND' | 'OR',
    conditions: group.conditions.map(convertFilter),
  };
}

// Resolvers
const resolvers = {
  Query: {
    schemas: (_: unknown, __: unknown, ctx: GraphQLContext) => {
      return ctx.schemas.getAll();
    },

    schema: (_: unknown, args: { collection: string }, ctx: GraphQLContext) => {
      return ctx.schemas.get(args.collection);
    },

    documents: (
      _: unknown,
      args: {
        collection: string;
        filters?: Array<{ field: string; operator: string; value: unknown }>;
        filterGroup?: {
          operator: string;
          conditions: Array<{ field: string; operator: string; value: unknown }>;
        };
        sort?: Array<{ field: string; direction: string }>;
        limit?: number;
        offset?: number;
        select?: string[];
      },
      ctx: GraphQLContext
    ) => {
      let filters: FilterCondition | FilterGroup | undefined;

      if (args.filterGroup) {
        filters = convertFilterGroup(args.filterGroup);
      } else if (args.filters && args.filters.length > 0) {
        const firstFilter = args.filters[0];
        if (args.filters.length === 1 && firstFilter) {
          filters = convertFilter(firstFilter);
        } else {
          filters = {
            operator: 'AND',
            conditions: args.filters.map(convertFilter),
          };
        }
      }

      return ctx.query.execute({
        collection: args.collection,
        filters,
        sort: args.sort?.map((s) => ({
          field: s.field,
          direction: s.direction as 'ASC' | 'DESC',
        })),
        limit: args.limit,
        offset: args.offset,
        select: args.select,
      });
    },

    document: (
      _: unknown,
      args: { collection: string; id: string },
      ctx: GraphQLContext
    ) => {
      const result = ctx.query.execute({
        collection: args.collection,
        filters: { field: '_id', operator: '=', value: args.id },
        limit: 1,
      });
      return result.documents[0] ?? null;
    },

    count: (
      _: unknown,
      args: {
        collection: string;
        filters?: Array<{ field: string; operator: string; value: unknown }>;
        filterGroup?: {
          operator: string;
          conditions: Array<{ field: string; operator: string; value: unknown }>;
        };
      },
      ctx: GraphQLContext
    ) => {
      let filters: FilterCondition | FilterGroup | undefined;

      if (args.filterGroup) {
        filters = convertFilterGroup(args.filterGroup);
      } else if (args.filters && args.filters.length > 0) {
        const firstFilter = args.filters[0];
        if (args.filters.length === 1 && firstFilter) {
          filters = convertFilter(firstFilter);
        } else {
          filters = {
            operator: 'AND',
            conditions: args.filters.map(convertFilter),
          };
        }
      }

      return ctx.query.count(args.collection, filters);
    },

    distinct: (
      _: unknown,
      args: { collection: string; field: string },
      ctx: GraphQLContext
    ) => {
      return ctx.query.distinct(args.collection, args.field);
    },

    syncStatus: (
      _: unknown,
      args: { collection: string; documentId: string },
      ctx: GraphQLContext
    ) => {
      return ctx.indexer.getSyncStatus(args.collection, args.documentId);
    },

    collectionSyncStatus: (
      _: unknown,
      args: { collection: string },
      ctx: GraphQLContext
    ) => {
      return ctx.indexer.getCollectionSyncStatus(args.collection);
    },

    erroredDocuments: (
      _: unknown,
      args: { collection?: string },
      ctx: GraphQLContext
    ) => {
      return ctx.indexer.getErroredDocuments(args.collection);
    },
  },

  Mutation: {
    createSchema: (
      _: unknown,
      args: { collection: string; fields: Record<string, unknown> },
      ctx: GraphQLContext
    ) => {
      return ctx.schemas.register({
        collection: args.collection,
        fields: args.fields as Record<string, 'string' | 'number' | 'boolean' | 'datetime'>,
      });
    },

    deleteSchema: (
      _: unknown,
      args: { collection: string },
      ctx: GraphQLContext
    ) => {
      return ctx.schemas.delete(args.collection);
    },

    indexDocument: (
      _: unknown,
      args: { collection: string; id: string; data: Record<string, unknown> },
      ctx: GraphQLContext
    ) => {
      return ctx.indexer.index(args.collection, args.id, args.data);
    },

    indexDocuments: (
      _: unknown,
      args: {
        collection: string;
        documents: Array<{ id: string; data: Record<string, unknown> }>;
      },
      ctx: GraphQLContext
    ) => {
      return ctx.indexer.indexBulk(args.collection, args.documents);
    },

    deleteDocument: (
      _: unknown,
      args: { collection: string; id: string },
      ctx: GraphQLContext
    ) => {
      return ctx.indexer.delete(args.collection, args.id);
    },

    clearCollection: (
      _: unknown,
      args: { collection: string },
      ctx: GraphQLContext
    ) => {
      return ctx.indexer.clearCollection(args.collection);
    },
  },
};

// Create the GraphQL schema
export const graphqlSchema = createSchema({
  typeDefs,
  resolvers,
});

// Create Yoga instance for use with Hono
export function createGraphQLHandler(context: GraphQLContext) {
  return createYoga({
    schema: graphqlSchema,
    context: () => context,
    graphqlEndpoint: '/graphql',
    // Enable GraphiQL for development
    graphiql: true,
  });
}
