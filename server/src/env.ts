/**
 * Environment configuration, validated once at boot.
 *
 * A missing or malformed variable kills the process immediately with a readable
 * error. That is deliberate: a form-intake service that starts with a broken
 * database URL will accept submissions and lose them. Failing at boot is loud;
 * failing at 3am under load is not.
 */
import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // comma-separated list -> string[]
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),

    // Empty secret disables reCAPTCHA verification entirely (dev convenience).
    // Guarded below so this cannot happen in production.
    RECAPTCHA_SECRET_KEY: z.string().default(''),
    RECAPTCHA_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),

    MIN_SUBMIT_SECONDS: z.coerce.number().min(0).default(3),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
    RATE_LIMIT_WINDOW: z.string().default('1 hour'),
    BLOCK_FREE_EMAIL_DOMAINS: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),

    // Run the job worker inside the API process. Set false when running a
    // dedicated worker process, or the same job is claimed by both.
    RUN_WORKER: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),

    PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
    PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),

    // Deferred integrations. Optional by design — each consumer logs its intent
    // and records a 'skipped' automation_event when its credential is absent.
    SLACK_WEBHOOK_URL: z.string().default(''),
    EMAIL_PROVIDER_API_KEY: z.string().default(''),
    EMAIL_FROM_ADDRESS: z.string().default(''),
    CALENDAR_BOOKING_URL: z.string().default(''),
    CRM_PROVIDER: z.string().default(''),
    CRM_API_KEY: z.string().default(''),

    // Odoo CRM. All four are required together — a partial configuration is a
    // misconfiguration, so the check below treats it as "not configured" rather
    // than failing at the first API call.
    ODOO_URL: z.string().default(''),
    ODOO_DB: z.string().default(''),
    ODOO_USERNAME: z.string().default(''),
    ODOO_API_KEY: z.string().default(''),
    ODOO_SALES_TEAM: z.string().default(''),
  })
  // Production must not run with anti-bot disabled or CORS wide open.
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV !== 'production') return;

    if (!cfg.RECAPTCHA_SECRET_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RECAPTCHA_SECRET_KEY'],
        message: 'required in production — the form endpoint is public',
      });
    }
    if (cfg.CORS_ORIGINS.includes('*')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'wildcard origin is not allowed in production',
      });
    }
  });

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  console.error('\nSee .env.example for the full list.');
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
export type Env = typeof env;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Anti-bot verification is only possible when a secret is configured. */
export const recaptchaEnabled = env.RECAPTCHA_SECRET_KEY.length > 0;

// Warn loudly about anything optional that silently degrades behaviour.
if (!recaptchaEnabled) {
  console.warn('[env] RECAPTCHA_SECRET_KEY not set — bot verification is DISABLED');
}
if (!env.EMAIL_PROVIDER_API_KEY) {
  console.warn('[env] EMAIL_PROVIDER_API_KEY not set — emails will be logged, not sent');
}
if (!env.SLACK_WEBHOOK_URL) {
  console.warn('[env] SLACK_WEBHOOK_URL not set — team alerts will be logged, not sent');
}

const odooVars = [env.ODOO_URL, env.ODOO_DB, env.ODOO_USERNAME, env.ODOO_API_KEY];
if (odooVars.some(Boolean) && !odooVars.every(Boolean)) {
  // Partial config is worse than none: it looks configured and fails at runtime.
  console.warn(
    '[env] Odoo is partially configured — ODOO_URL, ODOO_DB, ODOO_USERNAME and ' +
      'ODOO_API_KEY are all required. CRM push will stay in simulated mode.',
  );
} else if (!odooVars.every(Boolean)) {
  console.warn('[env] Odoo not configured — CRM pushes will be logged, not sent');
}
