/**
 * BullMQ-based queue for async document indexing
 *
 * Provides backpressure handling and retry logic for high-volume indexing.
 */

import { Queue, Worker, Job } from 'bullmq';
import type { DocumentIndexer } from '../core/document-indexer';
import type { SchemaRegistry } from '../core/schema-registry';

export interface IndexJob {
  type: 'index' | 'delete' | 'bulk';
  collection: string;
  documentId?: string;
  data?: Record<string, unknown>;
  documents?: Array<{ id: string; data: Record<string, unknown> }>;
}

export interface QueueConfig {
  /** Redis connection URL */
  redisUrl?: string;
  /** Redis host */
  redisHost?: string;
  /** Redis port */
  redisPort?: number;
  /** Queue name */
  queueName?: string;
  /** Number of concurrent workers */
  concurrency?: number;
}

const DEFAULT_QUEUE_NAME = 'firestore-sql-index';

export class IndexQueue {
  private queue: Queue<IndexJob>;
  private worker?: Worker<IndexJob>;
  private readonly queueName: string;
  private readonly redisConnection: { host: string; port: number };

  constructor(config: QueueConfig = {}) {
    this.queueName = config.queueName ?? DEFAULT_QUEUE_NAME;

    // Parse Redis URL or use host/port
    if (config.redisUrl) {
      const url = new URL(config.redisUrl);
      this.redisConnection = {
        host: url.hostname,
        port: parseInt(url.port, 10) || 6379,
      };
    } else {
      this.redisConnection = {
        host: config.redisHost ?? 'localhost',
        port: config.redisPort ?? 6379,
      };
    }

    this.queue = new Queue<IndexJob>(this.queueName, {
      connection: this.redisConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 1000,
      },
    });
  }

  /**
   * Start the worker to process jobs
   */
  startWorker(
    indexer: DocumentIndexer,
    schemas: SchemaRegistry,
    concurrency: number = 5
  ): void {
    this.worker = new Worker<IndexJob>(
      this.queueName,
      async (job: Job<IndexJob>) => {
        const { type, collection, documentId, data, documents } = job.data;

        switch (type) {
          case 'index':
            if (!documentId || !data) {
              throw new Error('Missing documentId or data for index job');
            }
            const indexResult = indexer.index(collection, documentId, data);
            if (!indexResult.success) {
              throw new Error(indexResult.error);
            }
            return { success: true, documentId };

          case 'delete':
            if (!documentId) {
              throw new Error('Missing documentId for delete job');
            }
            const deleted = indexer.delete(collection, documentId);
            return { success: deleted, documentId };

          case 'bulk':
            if (!documents) {
              throw new Error('Missing documents for bulk job');
            }
            const bulkResult = indexer.indexBulk(collection, documents);
            return bulkResult;

          default:
            throw new Error(`Unknown job type: ${type}`);
        }
      },
      {
        connection: this.redisConnection,
        concurrency,
      }
    );

    this.worker.on('completed', (job) => {
      console.log(`Job ${job.id} completed for ${job.data.collection}`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`Job ${job?.id} failed:`, err.message);
    });
  }

  /**
   * Add an index job to the queue
   */
  async addIndexJob(
    collection: string,
    documentId: string,
    data: Record<string, unknown>
  ): Promise<string> {
    const job = await this.queue.add('index', {
      type: 'index',
      collection,
      documentId,
      data,
    });
    return job.id ?? 'unknown';
  }

  /**
   * Add a delete job to the queue
   */
  async addDeleteJob(collection: string, documentId: string): Promise<string> {
    const job = await this.queue.add('delete', {
      type: 'delete',
      collection,
      documentId,
    });
    return job.id ?? 'unknown';
  }

  /**
   * Add a bulk index job to the queue
   */
  async addBulkJob(
    collection: string,
    documents: Array<{ id: string; data: Record<string, unknown> }>
  ): Promise<string> {
    const job = await this.queue.add('bulk', {
      type: 'bulk',
      collection,
      documents,
    });
    return job.id ?? 'unknown';
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    const [waiting, active, completed, failed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
    ]);
    return { waiting, active, completed, failed };
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string): Promise<Job<IndexJob> | undefined> {
    return this.queue.getJob(jobId);
  }

  /**
   * Close the queue and worker
   */
  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}
