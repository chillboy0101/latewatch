// db/index.ts
import 'server-only';

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

function createDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  return drizzle(neon(databaseUrl), { schema });
}

type Database = ReturnType<typeof createDb>;

let cachedDb: Database | null = null;

export function getDb(): Database {
  if (!cachedDb) {
    cachedDb = createDb();
  }

  return cachedDb;
}

export const db = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    const database = getDb();
    const value = Reflect.get(database as object, prop, receiver);
    return typeof value === 'function' ? value.bind(database) : value;
  },
});
