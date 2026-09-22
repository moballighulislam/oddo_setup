/**
 * Client IP and device extraction.
 *
 * The IP is used for consent records and geolocation, so it must come from the
 * proxy chain rather than the request body. A client-supplied `ip_address` field
 * is ignored everywhere.
 */
import type { FastifyRequest } from 'fastify';
import type { DeviceType } from '../schemas/enums.js';

/**
 * Resolve the originating IP.
 *
 * Header order matters: Cloudflare's own header first, since it cannot be spoofed
 * by the client when traffic is actually proxied through Cloudflare. Only the
 * FIRST entry of x-forwarded-for is the real client; the rest are proxy hops.
 */
export function clientIp(req: FastifyRequest): string | null {
  const cf = header(req, 'cf-connecting-ip');
  if (cf) return cf;

  const xff = header(req, 'x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }

  const real = header(req, 'x-real-ip');
  if (real) return real;

  return req.ip || null;
}

/** Two-letter country from Cloudflare, when available. */
export function clientCountry(req: FastifyRequest): string | null {
  const code = header(req, 'cf-ipcountry');
  if (!code) return null;
  // XX = unknown, T1 = Tor exit node. Neither is a country.
  if (code === 'XX' || code === 'T1') return null;
  return code.toUpperCase();
}

export function userAgent(req: FastifyRequest): string | null {
  return header(req, 'user-agent');
}

/**
 * Coarse device classification from the user agent.
 * Only used when the client tracking snippet did not report one.
 */
export function deviceFromUserAgent(ua: string | null): DeviceType | null {
  if (!ua) return null;
  const s = ua.toLowerCase();
  // Tablet check first — every tablet UA also contains a mobile token.
  if (/ipad|tablet|playbook|silk/.test(s)) return 'tablet';
  if (/mobi|android|iphone|ipod|phone/.test(s)) return 'mobile';
  return 'desktop';
}

function header(req: FastifyRequest, name: string): string | null {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return typeof value === 'string' ? value.trim() || null : null;
}
