/**
 * Basic usage example for Firestore SQL
 *
 * Run with: bun run examples/basic-usage.ts
 */

import { FirestoreSql } from '../src';

// Initialize with in-memory database (or use a file path like './data.db')
const db = new FirestoreSql({ database: ':memory:' });

// Define schema for prospects collection
console.log('📋 Defining schema for prospects...\n');

db.defineSchema('prospects', {
  firstName: 'string',
  lastName: 'string',
  email: { type: 'string', indexed: true },
  company: 'string',
  score: 'number',
  isActive: 'boolean',
  tags: 'string', // Store as comma-separated for simplicity
  createdAt: 'datetime',
});

// Index some sample documents
console.log('📥 Indexing sample prospects...\n');

const sampleProspects = [
  {
    id: 'prospect-1',
    data: {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@acme.com',
      company: 'Acme Inc',
      score: 85,
      isActive: true,
      tags: 'enterprise,hot-lead',
      createdAt: new Date('2024-01-15'),
    },
  },
  {
    id: 'prospect-2',
    data: {
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane@techcorp.io',
      company: 'TechCorp',
      score: 92,
      isActive: true,
      tags: 'startup,warm-lead',
      createdAt: new Date('2024-02-20'),
    },
  },
  {
    id: 'prospect-3',
    data: {
      firstName: 'Bob',
      lastName: 'Wilson',
      email: 'bob@bigco.com',
      company: 'BigCo',
      score: 65,
      isActive: false,
      tags: 'enterprise,cold-lead',
      createdAt: new Date('2024-03-10'),
    },
  },
  {
    id: 'prospect-4',
    data: {
      firstName: 'Alice',
      lastName: 'Johnson',
      email: 'alice@startup.io',
      company: 'Startup.io',
      score: 78,
      isActive: true,
      tags: 'startup,warm-lead',
      createdAt: new Date('2024-04-05'),
    },
  },
  {
    id: 'prospect-5',
    data: {
      firstName: 'Charlie',
      lastName: 'Brown',
      email: 'charlie@megacorp.com',
      company: 'MegaCorp',
      score: 95,
      isActive: true,
      tags: 'enterprise,hot-lead',
      createdAt: new Date('2024-05-01'),
    },
  },
];

const bulkResult = db.indexBulk('prospects', sampleProspects);
console.log(`Indexed ${bulkResult.successful} of ${bulkResult.total} documents\n`);

// Type definition for our prospects
interface Prospect {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  score: number;
  isActive: boolean;
  tags: string;
  createdAt: string;
}

// Example 1: Simple filter - get active prospects
console.log('🔍 Query 1: Active prospects\n');
const activeProspects = db
  .collection<Prospect>('prospects')
  .where('isActive', '=', true)
  .all();

console.log(`Found ${activeProspects.length} active prospects:`);
activeProspects.forEach((p) => console.log(`  - ${p.firstName} ${p.lastName}`));
console.log();

// Example 2: Score filter with sorting
console.log('🔍 Query 2: High-scoring prospects (score >= 80), sorted by score DESC\n');
const highScorers = db
  .collection<Prospect>('prospects')
  .where('score', '>=', 80)
  .orderBy('score', 'DESC')
  .all();

console.log(`Found ${highScorers.length} high-scoring prospects:`);
highScorers.forEach((p) => console.log(`  - ${p.firstName} ${p.lastName}: ${p.score}`));
console.log();

// Example 3: Compound filters
console.log('🔍 Query 3: Active prospects from enterprise companies\n');
const enterpriseActive = db
  .collection<Prospect>('prospects')
  .where('isActive', '=', true)
  .where('tags', 'LIKE', '%enterprise%')
  .all();

console.log(`Found ${enterpriseActive.length} active enterprise prospects:`);
enterpriseActive.forEach((p) => console.log(`  - ${p.firstName} ${p.lastName} (${p.company})`));
console.log();

// Example 4: Pagination
console.log('🔍 Query 4: Paginated results (page 1 of 2, 2 per page)\n');
const page1 = db
  .collection<Prospect>('prospects')
  .orderBy('lastName', 'ASC')
  .limit(2)
  .offset(0)
  .execute();

console.log(`Page 1 (showing ${page1.documents.length} of ${page1.total} total):`);
page1.documents.forEach((p) => console.log(`  - ${p.lastName}, ${p.firstName}`));
console.log();

// Example 5: Select specific fields
console.log('🔍 Query 5: Select only email and company\n');
const emailsOnly = db
  .collection<Prospect>('prospects')
  .where('isActive', '=', true)
  .select('email', 'company')
  .all();

console.log('Active prospect emails:');
emailsOnly.forEach((p) => console.log(`  - ${p.email} (${p.company})`));
console.log();

// Example 6: Count query
console.log('📊 Query 6: Count queries\n');
const totalCount = db.collection<Prospect>('prospects').count();
const activeCount = db.collection<Prospect>('prospects').where('isActive', '=', true).count();
const highScoreCount = db.collection<Prospect>('prospects').where('score', '>=', 90).count();

console.log(`Total prospects: ${totalCount}`);
console.log(`Active prospects: ${activeCount}`);
console.log(`High scorers (90+): ${highScoreCount}`);
console.log();

// Example 7: Get distinct values
console.log('📊 Query 7: Distinct companies\n');
const companies = db.query.distinct('prospects', 'company');
console.log('Companies:', companies.join(', '));
console.log();

// Example 8: Check existence
console.log('🔍 Query 8: Existence checks\n');
const hasHotLeads = db
  .collection<Prospect>('prospects')
  .where('tags', 'LIKE', '%hot-lead%')
  .exists();

const hasPerfectScore = db
  .collection<Prospect>('prospects')
  .where('score', '=', 100)
  .exists();

console.log(`Has hot leads: ${hasHotLeads}`);
console.log(`Has perfect score (100): ${hasPerfectScore}`);
console.log();

// Example 9: Get first result
console.log('🔍 Query 9: Get top scorer\n');
const topScorer = db
  .collection<Prospect>('prospects')
  .orderBy('score', 'DESC')
  .first();

if (topScorer) {
  console.log(`Top scorer: ${topScorer.firstName} ${topScorer.lastName} with score ${topScorer.score}`);
}
console.log();

// Example 10: Raw SQL query
console.log('🔍 Query 10: Raw SQL - Average score by active status\n');
const avgScores = db.raw<{ isActive: number; avg_score: number }>(
  'prospects',
  'SELECT isActive, AVG(score) as avg_score FROM $TABLE GROUP BY isActive'
);

avgScores.forEach((row) => {
  const status = row.isActive ? 'Active' : 'Inactive';
  console.log(`  ${status}: ${row.avg_score.toFixed(1)}`);
});

// Clean up
db.close();
console.log('\n✅ Example completed successfully!');
