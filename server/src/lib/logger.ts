/**
 * Shared structured logger.
 *
 * Redaction is not cosmetic here: every form submission carries an email, a phone
 * number and an IP address. Logging those in full turns the log store into a
 * second copy of the lead database with none of its access controls.
 */
import pino from 'pino';
import { env, isProduction } from '../env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.email',
      '*.phone',
      '*.phoneE164',
      '*.ipAddress',
      '*.consentIp',
      '*.rawPayload',
      'body.email',
      'body.phone',
    ],
    censor: '[redacted]',
  },
  // Pretty output in dev; newline-delimited JSON in production for log shipping.
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
});

export type Logger = typeof logger;
