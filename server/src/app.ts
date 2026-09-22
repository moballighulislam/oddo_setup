/**
 * Fastify application factory.
 *
 * Separate from index.ts so tests can build an app and call `.inject()` without
 * binding a port.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { env, isProduction } from './env.js';
import { logger } from './lib/logger.js';
import { healthRoutes } from './routes/health.js';
import { submitRoutes } from './routes/submit.js';
import { newsletterRoutes } from './routes/newsletter.js';

// Return type is inferred rather than annotated as FastifyInstance: passing a
// concrete pino instance narrows Fastify's logger generic, and the plain
// FastifyInstance alias no longer matches it.
export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    // The form endpoint sits behind Cloudflare/nginx, so the proxy chain is what
    // carries the real client IP. Without this, every request appears to come
    // from the load balancer and the rate limiter becomes useless.
    trustProxy: true,
    bodyLimit: 256 * 1024, // generous for a form; far below anything abusive
  });

  await app.register(helmet, {
    // This is a JSON API, not a page renderer — CSP here protects nothing and
    // only interferes with error pages.
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: false,
    maxAge: 86_400,
  });

  // Global ceiling. The submit route tightens this further via its own config.
  await app.register(rateLimit, {
    global: false,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    // In-memory for now; move to the Redis store once the queue lands, otherwise
    // the limit is per-instance and multiplies with every replica.
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: () => ({
      ok: false,
      error: 'rate_limited',
      message: 'Too many submissions. Please try again later.',
    }),
  });

  await app.register(healthRoutes);
  await app.register(submitRoutes);
  await app.register(newsletterRoutes);

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ ok: false, error: 'not_found' }),
  );

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    req.log.error({ err }, 'unhandled error');

    const status = err.statusCode ?? 500;
    return reply.code(status).send({
      ok: false,
      error: status >= 500 ? 'internal_error' : 'request_error',
      // Never leak an internal error message to a public form endpoint.
      message: isProduction && status >= 500 ? 'Something went wrong.' : err.message,
    });
  });

  return app;
}
