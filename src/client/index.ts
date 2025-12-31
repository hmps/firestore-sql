/**
 * TypeScript client SDK for Firestore SQL API
 *
 * Use this to consume the Firestore SQL API from other applications.
 */

export interface ClientConfig {
  /** Base URL of the Firestore SQL server */
  baseUrl: string;
  /** API key for authentication */
  apiKey?: string;
  /** Custom fetch implementation */
  fetch?: typeof fetch;
}

export interface FilterCondition {
  field: string;
  operator: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'IN' | 'NOT IN' | 'IS NULL' | 'IS NOT NULL';
  value: unknown;
}

export interface FilterGroup {
  operator: 'AND' | 'OR';
  conditions: (FilterCondition | FilterGroup)[];
}

export interface QueryOptions {
  filters?: FilterCondition | FilterGroup;
  sort?: Array<{ field: string; direction: 'ASC' | 'DESC' }>;
  limit?: number;
  offset?: number;
  select?: string[];
}

export interface QueryResult<T> {
  documents: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Schema {
  collection: string;
  fields: Record<string, { type: string; nullable?: boolean; indexed?: boolean }>;
  createdAt: string;
  updatedAt: string;
}

export interface IndexResult {
  success: boolean;
  documentId: string;
  error?: string;
}

export interface BulkIndexResult {
  total: number;
  successful: number;
  failed: number;
}

export interface SearchResult<T> {
  documents: Array<T & { _score: number }>;
  total: number;
}

export interface AggregateQuery {
  aggregates: Array<{
    field: string;
    function: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
    alias?: string;
  }>;
  groupBy?: string[];
  filters?: FilterCondition | FilterGroup;
  having?: {
    field: string;
    operator: '=' | '!=' | '>' | '>=' | '<' | '<=';
    value: number;
  };
  orderBy?: { field: string; direction: 'ASC' | 'DESC' };
  limit?: number;
}

export class FirestoreSqlClient {
  private baseUrl: string;
  private apiKey?: string;
  private fetchFn: typeof fetch;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.fetchFn = config.fetch ?? fetch;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error ?? `HTTP ${response.status}`);
    }

    return response.json();
  }

  // ============ Health ============

  async health(): Promise<{ status: string; timestamp: string }> {
    return this.request('GET', '/health');
  }

  // ============ Schemas ============

  async listSchemas(): Promise<{ schemas: Schema[] }> {
    return this.request('GET', '/schemas');
  }

  async getSchema(collection: string): Promise<{ schema: Schema }> {
    return this.request('GET', `/schemas/${collection}`);
  }

  async createSchema(
    collection: string,
    fields: Record<string, string | { type: string; nullable?: boolean; indexed?: boolean }>
  ): Promise<{ schema: Schema }> {
    return this.request('POST', `/schemas/${collection}`, { fields });
  }

  async deleteSchema(collection: string): Promise<{ deleted: boolean }> {
    return this.request('DELETE', `/schemas/${collection}`);
  }

  // ============ Documents ============

  async indexDocument(
    collection: string,
    docId: string,
    data: Record<string, unknown>
  ): Promise<{ indexed: boolean; documentId: string }> {
    return this.request('POST', `/documents/${collection}/${docId}`, data);
  }

  async indexDocuments(
    collection: string,
    documents: Array<{ id: string; data: Record<string, unknown> }>
  ): Promise<BulkIndexResult> {
    return this.request('POST', `/documents/${collection}`, documents);
  }

  async deleteDocument(
    collection: string,
    docId: string
  ): Promise<{ deleted: boolean }> {
    return this.request('DELETE', `/documents/${collection}/${docId}`);
  }

  async clearCollection(collection: string): Promise<{ cleared: boolean }> {
    return this.request('DELETE', `/documents/${collection}`);
  }

  // ============ Queries ============

  async query<T = Record<string, unknown>>(
    collection: string,
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    return this.request('POST', `/query/${collection}`, options);
  }

  async count(
    collection: string,
    filters?: FilterCondition | FilterGroup
  ): Promise<{ count: number }> {
    return this.request('POST', `/count/${collection}`, { filters });
  }

  async distinct(
    collection: string,
    field: string
  ): Promise<{ field: string; values: unknown[] }> {
    return this.request('GET', `/distinct/${collection}/${field}`);
  }

  // ============ Search ============

  async search<T = Record<string, unknown>>(
    collection: string,
    query: string,
    options: { limit?: number; offset?: number; highlight?: boolean } = {}
  ): Promise<SearchResult<T>> {
    return this.request('POST', `/search/${collection}`, { query, ...options });
  }

  async createSearchIndex(collection: string): Promise<{ success: boolean }> {
    return this.request('POST', `/search/${collection}/index`);
  }

  // ============ Aggregations ============

  async aggregate(
    collection: string,
    query: AggregateQuery
  ): Promise<{ rows: Record<string, unknown>[]; total: number }> {
    return this.request('POST', `/aggregate/${collection}`, query);
  }

  async stats(
    collection: string,
    field: string,
    filters?: FilterCondition | FilterGroup
  ): Promise<{ count: number; sum: number; avg: number; min: number; max: number }> {
    return this.request('POST', `/aggregate/${collection}/stats`, { field, filters });
  }

  // ============ Queue ============

  async indexAsync(
    collection: string,
    docId: string,
    data: Record<string, unknown>
  ): Promise<{ jobId: string }> {
    return this.request('POST', `/queue/${collection}/${docId}`, data);
  }

  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    return this.request('GET', '/queue/stats');
  }

  async getJob(jobId: string): Promise<{ job: unknown }> {
    return this.request('GET', `/queue/job/${jobId}`);
  }

  // ============ GraphQL ============

  async graphql<T = unknown>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<{ data: T; errors?: Array<{ message: string }> }> {
    return this.request('POST', '/graphql', { query, variables });
  }
}

/**
 * Create a collection-specific client with type safety
 */
export function createCollectionClient<T extends Record<string, unknown>>(
  client: FirestoreSqlClient,
  collection: string
) {
  return {
    index: (docId: string, data: T) =>
      client.indexDocument(collection, docId, data),

    indexBulk: (documents: Array<{ id: string; data: T }>) =>
      client.indexDocuments(collection, documents),

    delete: (docId: string) =>
      client.deleteDocument(collection, docId),

    query: (options?: QueryOptions) =>
      client.query<T>(collection, options),

    count: (filters?: FilterCondition | FilterGroup) =>
      client.count(collection, filters),

    search: (query: string, options?: { limit?: number; offset?: number }) =>
      client.search<T>(collection, query, options),

    distinct: (field: keyof T) =>
      client.distinct(collection, field as string),
  };
}
