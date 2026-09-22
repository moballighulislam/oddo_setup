/**
 * Health endpoints.
 *
 * /health is the load balancer probe: it must actually touch the database, because
 * a process that is up but cannot write is worse than one that is down — it accepts
 * form submissions and loses them.
 */
import type { FastifyInstance } from 'fastify';
import { pingDatabase } from '../db.js';
import { queueStats } from '../queue/driver.js';
import { env } from '../env.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply) => {
    const dbOk = await pingDatabase();

    // Queue depth lives in the same database, so it is only readable when the
    // database is up.
    const queue = dbOk ? await queueStats() : null;

    return reply.code(dbOk ? 200 : 503).send({
      status: dbOk ? 'ok' : 'degraded',
      checks: {
        database: dbOk ? 'ok' : 'unreachable',
        queue,
      },
      env: env.NODE_ENV,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  /** Liveness only — no dependency checks. For container restart policies. */
  app.get('/health/live', async (_req, reply) => reply.code(200).send({ status: 'alive' }));
}
