import 'server-only';

import { Pool, type PoolClient } from '@neondatabase/serverless';

// A real connection (over WebSocket) for the few jobs that need a transaction across several
// statements: the backup snapshot and the restore. Everything else uses the HTTP driver in @/db.
export async function withDbClient<T>(work: (client: PoolClient) => Promise<T>) {
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL or DATABASE_URL_UNPOOLED is required');
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
    await pool.end();
  }
}
