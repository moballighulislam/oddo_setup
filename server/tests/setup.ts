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
