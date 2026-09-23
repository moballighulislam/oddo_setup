/**
 * Test bootstrap. Runs before any test module is imported.
 *
 * src/env.ts validates configuration at import time and calls process.exit(1) on
 * failure, so .env must be loaded before anything under src/ is pulled in.
 * Vitest does not load .env by itself.
 */
import { existsSync } from 'node:fs';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

process.env.NODE_ENV = 'test';

// The rate limiter has its own coverage; it must not throttle everything else.
process.env.RATE_LIMIT_MAX = '10000';

// Force anti-bot verification off so tests never make a network call to Google.
process.env.RECAPTCHA_SECRET_KEY = '';

// Clear outbound integrations so the suite never touches a live service.
//
// .env holds real credentials on a developer machine, and loading it above would
// otherwise point the tests at the production Odoo instance and a real mailbox —
// creating junk records there, and failing whenever the network or a key is
// unavailable. A test that depends on an external service is not a test.
//
// tests/integration/odoo.test.ts sets its own values pointing at a local stub.
process.env.ODOO_URL = '';
process.env.ODOO_DB = '';
process.env.ODOO_USERNAME = '';
process.env.ODOO_API_KEY = '';
process.env.EMAIL_PROVIDER_API_KEY = '';
process.env.SLACK_WEBHOOK_URL = '';
process.env.CRM_PROVIDER = '';
process.env.CRM_API_KEY = '';
