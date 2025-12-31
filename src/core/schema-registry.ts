/**
 * Schema registry for managing collection schemas
 */

import type { DatabaseManager } from './database';
import type { CollectionSchema, FieldDefinition, FieldType } from './types';

export interface SchemaInput {
  collection: string;
  fields: Record<string, FieldDefinition | FieldType>;
}

export class SchemaRegistry {
  constructor(private db: DatabaseManager) {}

  /** Normalize field definition */
  private normalizeField(field: FieldDefinition | FieldType): FieldDefinition {
    if (typeof field === 'string') {
      return { type: field, nullable: true, indexed: false };
    }
    return {
      type: field.type,
      nullable: field.nullable ?? true,
      indexed: field.indexed ?? false,
    };
  }

  /** Register or update a schema */
  register(input: SchemaInput): CollectionSchema {
    const existing = this.db.getSchema(input.collection);
    const now = new Date();

    const normalizedFields: Record<string, FieldDefinition> = {};
    for (const [name, field] of Object.entries(input.fields)) {
      normalizedFields[name] = this.normalizeField(field);
    }

    const schema: CollectionSchema = {
      collection: input.collection,
      fields: normalizedFields,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    // Create or update the table
    this.db.createTableFromSchema(schema);

    // Save schema metadata
    this.db.saveSchema(schema);

    return schema;
  }

  /** Get a schema by collection name */
  get(collection: string): CollectionSchema | null {
    return this.db.getSchema(collection);
  }

  /** Get all registered schemas */
  getAll(): CollectionSchema[] {
    return this.db.getAllSchemas();
  }

  /** Check if a schema exists */
  exists(collection: string): boolean {
    return this.db.getSchema(collection) !== null;
  }

  /** Delete a schema and its data */
  delete(collection: string): boolean {
    return this.db.deleteSchema(collection);
  }

  /**
   * Infer schema from a document
   * Useful for auto-creating schemas from first document
   */
  inferSchema(data: Record<string, unknown>): Record<string, FieldDefinition> {
    const fields: Record<string, FieldDefinition> = {};

    for (const [key, value] of Object.entries(data)) {
      // Skip internal fields
      if (key.startsWith('_')) continue;

      let type: FieldType = 'string';

      if (value === null || value === undefined) {
        type = 'string'; // Default to string for null values
      } else if (typeof value === 'number') {
        type = 'number';
      } else if (typeof value === 'boolean') {
        type = 'boolean';
      } else if (value instanceof Date) {
        type = 'datetime';
      } else if (typeof value === 'object' && 'toDate' in value) {
        // Firestore Timestamp
        type = 'datetime';
      } else if (typeof value === 'string') {
        // Check if it looks like a date string
        if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
          type = 'datetime';
        } else {
          type = 'string';
        }
      }

      fields[key] = {
        type,
        nullable: true,
        indexed: false,
      };
    }

    return fields;
  }

  /**
   * Register schema by inferring from a document
   */
  registerFromDocument(
    collection: string,
    data: Record<string, unknown>
  ): CollectionSchema {
    const fields = this.inferSchema(data);
    return this.register({ collection, fields });
  }

  /**
   * Get or create schema - creates from document if doesn't exist
   */
  getOrCreate(
    collection: string,
    data: Record<string, unknown>
  ): CollectionSchema {
    const existing = this.get(collection);
    if (existing) return existing;
    return this.registerFromDocument(collection, data);
  }

  /** Validate data against a schema */
  validate(
    collection: string,
    data: Record<string, unknown>
  ): { valid: boolean; errors: string[] } {
    const schema = this.get(collection);
    if (!schema) {
      return { valid: false, errors: [`Schema not found for collection: ${collection}`] };
    }

    const errors: string[] = [];

    for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
      const value = data[fieldName];

      // Check required fields
      if (!fieldDef.nullable && (value === undefined || value === null)) {
        errors.push(`Field "${fieldName}" is required`);
        continue;
      }

      if (value === undefined || value === null) continue;

      // Type validation
      switch (fieldDef.type) {
        case 'string':
          if (typeof value !== 'string') {
            errors.push(`Field "${fieldName}" must be a string`);
          }
          break;
        case 'number':
          if (typeof value !== 'number') {
            errors.push(`Field "${fieldName}" must be a number`);
          }
          break;
        case 'boolean':
          if (typeof value !== 'boolean') {
            errors.push(`Field "${fieldName}" must be a boolean`);
          }
          break;
        case 'datetime':
          if (
            !(value instanceof Date) &&
            typeof value !== 'string' &&
            !(typeof value === 'object' && 'toDate' in (value as object))
          ) {
            errors.push(`Field "${fieldName}" must be a date`);
          }
          break;
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
