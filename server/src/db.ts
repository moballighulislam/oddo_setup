/**
 * PrismaClient singleton.
 *
 * One instance per process. Creating a client per request exhausts the connection
 * pool under any real load.
 */
import { PrismaClient } from '@prisma/client';
import { env, isProduction } from './env.js';
import { logger } from './lib/logger.js';

export const prisma = new PrismaClient({
  log: isProduction
    ? [{ emit: 'event', level: 'error' }]
    : [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
});

prisma.$on('error', (e) => logger.error({ prisma: e }, 'prisma error'));
if (!isProduction) {
  prisma.$on('warn', (e) => logger.warn({ prisma: e }, 'prisma warning'));
}

/** Cheap liveness probe for GET /health. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    logger.error({ err }, 'database ping failed');
    return false;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * SQLite serialises writes and will throw SQLITE_BUSY under concurrent load.
 * Raising the busy timeout makes it wait rather than fail. Irrelevant on MySQL —
 * remove this block when the provider changes.
 */
export async function configureSqlite(): Promise<void> {
  if (!env.DATABASE_URL.startsWith('file:')) return;

  // All three go through $queryRawUnsafe: several PRAGMAs echo their new value
  // back as a row, and $executeRawUnsafe rejects any statement that returns
  // results ("Execute returned results, which is not allowed in SQLite").
  const pragmas = [
    'PRAGMA busy_timeout = 5000', // wait instead of throwing SQLITE_BUSY
    'PRAGMA journal_mode = WAL', // readers do not block the writer
    'PRAGMA foreign_keys = ON', // SQLite leaves FK enforcement off by default
  ];

  for (const pragma of pragmas) {
    try {
      await prisma.$queryRawUnsafe(pragma);
    } catch (err) {
      // Tuning, not correctness. A failed PRAGMA must not stop the service from
      // accepting form submissions.
      logger.warn({ err, pragma }, 'sqlite pragma failed');
    }
  }
}
