import { readdir, readFile } from 'node:fs/promises';
import { Pool } from 'pg';

export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const directory = new URL('../../../infra/migrations/', import.meta.url);
    const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      await pool.query(await readFile(new URL(file, directory), 'utf8'));
    }
  } finally {
    await pool.end();
  }
}
