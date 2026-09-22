/**
 * Server entry point.
 *
 * Graceful shutdown matters more than usual here: an in-flight form submission
 * killed mid-transaction is a lead lost silently, with the visitor believing it
 * went through.
 */
import { buildApp } from './app.js';
import { env } from './env.js';
import { configureSqlite, disconnectDatabase, pingDatabase } from './db.js';
import { logger } from './lib/logger.js';
import { Worker, startJobPruner } from './queue/worker.js';

async function main(): Promise<void> {
  await configureSqlite();

  // Fail fast. A service that starts without a database accepts submissions and
  // loses them — far worse than refusing to start.
  if (!(await pingDatabase())) {
    logger.fatal('database unreachable at boot — refusing to start');
    process.exit(1);
  }

  const app = await buildApp();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info(`dn-backend listening on :${env.PORT} (${env.NODE_ENV})`);

  // Worker runs in-process. Simplest thing that works, and correct while the
  // queue is database-backed: there is no broker to connect to, and the poll is a
  // cheap indexed query. Split it out with RUN_WORKER=false plus a separate
  // `npm run worker` when job volume starts competing with request handling.
  const worker = env.RUN_WORKER ? new Worker() : null;
  worker?.start();
  if (worker) startJobPruner();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'shutting down');
    try {
      // Order matters: stop accepting new work, let in-flight jobs finish, then
      // drop the database connection. Reversing this kills a running job midway.
      await app.close();
      await worker?.stop();
      await disconnectDatabase();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // An unhandled rejection leaves the process in an unknown state. Log it loudly
  // rather than letting Node exit silently.
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled promise rejection');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
