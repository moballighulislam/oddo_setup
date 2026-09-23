/**
 * IP geolocation.
 *
 * Cloudflare's free plan supplies only `cf-ipcountry`. City, region, timezone and
 * postal code are Enterprise-only headers, so anything finer than country needs a
 * lookup.
 *
 * Runs in the `enrich` job, never in the request path — an external call must not
 * sit between a visitor pressing submit and the response.
 *
 * PRIVACY: the default provider sends the visitor's IP to a third party, which makes
 * that service a data processor under GDPR and means it belongs in the privacy policy.
 * `GEO_PROVIDER=none` disables lookups entirely, and swapping to a local MaxMind
 * database later means replacing one function — nothing else changes.
 */
import { env } from '../env.js';
import { logger } from '../lib/logger.js';

export interface GeoResult {
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  postalCode: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
  /** The network the visitor is on. A corporate ISP is a useful B2B signal. */
  isp: string | null;
  organisation: string | null;
  /** True when the IP belongs to a hosting provider, VPN or proxy. */
  isHosting: boolean;
}

const EMPTY: GeoResult = {
  country: null,
  countryCode: null,
  region: null,
  city: null,
  postalCode: null,
  timezone: null,
  latitude: null,
  longitude: null,
  isp: null,
  organisation: null,
  isHosting: false,
};

/** Private and reserved ranges — never worth a lookup. */
function isPrivateIp(ip: string): boolean {
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('172.16.') ||
    ip.startsWith('172.17.') ||
    ip.startsWith('172.18.') ||
    ip.startsWith('172.19.') ||
    ip.startsWith('172.2') ||
    ip.startsWith('172.30.') ||
    ip.startsWith('172.31.') ||
    ip.startsWith('169.254.') ||
    ip.startsWith('fc') ||
    ip.startsWith('fd') ||
    // TEST-NET ranges used in seed and test data
    ip.startsWith('203.0.113.') ||
    ip.startsWith('198.51.100.') ||
    ip.startsWith('192.0.2.')
  );
}

/**
 * Look up an IP.
 *
 * Never throws. Geolocation is an enrichment, not a requirement — a failed lookup
 * must not fail the job that carries the lead.
 */
export async function lookupIp(ip: string | null): Promise<GeoResult> {
  if (!ip || isPrivateIp(ip)) return EMPTY;
  if (env.GEO_PROVIDER === 'none') return EMPTY;

  try {
    return await lookupViaIpApi(ip);
  } catch (err) {
    logger.warn({ err, ip }, 'geo lookup failed — continuing without it');
    return EMPTY;
  }
}

/**
 * ip-api.com — free, no key, 45 requests/minute.
 *
 * Well above this service's volume. The free tier is HTTP-only, so the IP travels
 * unencrypted; that is one more reason this is the swap-me-out provider rather than
 * a long-term choice.
 */
async function lookupViaIpApi(ip: string): Promise<GeoResult> {
  const fields = 'status,country,countryCode,regionName,city,zip,timezone,lat,lon,isp,org,hosting';
  const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${fields}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`geo provider returned ${res.status}`);

    const data = (await res.json()) as {
      status: string;
      country?: string;
      countryCode?: string;
      regionName?: string;
      city?: string;
      zip?: string;
      timezone?: string;
      lat?: number;
      lon?: number;
      isp?: string;
      org?: string;
      hosting?: boolean;
    };

    if (data.status !== 'success') return EMPTY;

    return {
      country: data.country ?? null,
      countryCode: data.countryCode ?? null,
      region: data.regionName ?? null,
      city: data.city ?? null,
      postalCode: data.zip ?? null,
      timezone: data.timezone ?? null,
      latitude: data.lat ?? null,
      longitude: data.lon ?? null,
      isp: data.isp ?? null,
      organisation: data.org ?? null,
      isHosting: data.hosting === true,
    };
  } finally {
    clearTimeout(timeout);
  }
}
