#!/usr/bin/env node
import { createDatabasePool } from './client.js';
import { Migrator } from './migrator.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('FATAL: DATABASE_URL environment variable is required.');
  process.exit(1);
}

const pool = createDatabasePool({ connectionString: databaseUrl });
const migrator = new Migrator(pool);

const command = process.argv[2] ?? 'up';

async function main() {
  try {
    if (command === 'up') {
      const applied = await migrator.up();
      console.info(`Migration UP complete. Applied ${applied.length} migration(s):`, applied);
    } else if (command === 'down') {
      const reverted = await migrator.down();
      console.info(`Migration DOWN complete. Reverted ${reverted.length} migration(s):`, reverted);
    } else {
      console.error(`Unknown command: ${command}. Use 'up' or 'down'.`);
      process.exit(1);
    }
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
