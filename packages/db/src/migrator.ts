import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class Migrator {
  private migrationsDir: string;

  constructor(
    private pool: pg.Pool,
    customMigrationsDir?: string
  ) {
    this.migrationsDir = customMigrationsDir ?? path.join(__dirname, 'migrations');
  }

  private async ensureMigrationTable(client: pg.PoolClient): Promise<void> {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
      );
    `);
  }

  public async up(): Promise<string[]> {
    const client = await this.pool.connect();
    const applied: string[] = [];

    try {
      await client.query('BEGIN');
      await this.ensureMigrationTable(client);

      const res = await client.query('SELECT version FROM schema_migrations ORDER BY version ASC');
      const alreadyApplied = new Set(res.rows.map((r) => r.version));

      const files = fs
        .readdirSync(this.migrationsDir)
        .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
        .sort();

      for (const file of files) {
        if (!alreadyApplied.has(file)) {
          const sql = fs.readFileSync(path.join(this.migrationsDir, file), 'utf-8');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
          applied.push(file);
        }
      }

      await client.query('COMMIT');
      return applied;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async down(): Promise<string[]> {
    const client = await this.pool.connect();
    const reverted: string[] = [];

    try {
      await client.query('BEGIN');
      await this.ensureMigrationTable(client);

      const res = await client.query(
        'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1'
      );
      if (res.rows.length === 0) {
        await client.query('COMMIT');
        return [];
      }

      const lastVersion = res.rows[0].version as string;
      const downFile = lastVersion.replace('.sql', '.down.sql');
      const downPath = path.join(this.migrationsDir, downFile);

      if (!fs.existsSync(downPath)) {
        throw new Error(
          `Rollback file missing for migration: ${lastVersion} (expected: ${downFile})`
        );
      }

      const sql = fs.readFileSync(downPath, 'utf-8');
      await client.query(sql);
      await client.query('DELETE FROM schema_migrations WHERE version = $1', [lastVersion]);
      reverted.push(lastVersion);

      await client.query('COMMIT');
      return reverted;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
