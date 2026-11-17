/**
 * Access tokens (FR-23, NFR-S3, ADR-006).
 *
 * A token is `base64url(payload).base64url(HMAC-SHA-256(key, base64url(payload)))`.
 * It is stateless and carried in the URL path, not in a cookie. It is a BEARER
 * credential: anyone holding a valid link can use it until it expires (SRD limitation 5).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type ViewerRole = 'student' | 'ta' | 'instructor' | 'admin';

export interface TokenPayload {
  /** Format version. */
  v: 1;
  /** Subdomain (one submission) the token is bound to. */
  s: string;
  /** User ID the platform issued the token to (for audit; not re-authenticated by the content server). */
  u: string;
  /** Viewer role at issue time. */
  r: ViewerRole;
  /** Issued at / expires at, in seconds since the epoch. */
  iat: number;
  exp: number;
}

/** NFR-S3: ≤ 1 hour for students; ≤ 4 hours (one marking session) for staff. */
export const STUDENT_TOKEN_SECONDS = 60 * 60;
export const STAFF_TOKEN_SECONDS = 4 * 60 * 60;
export const MAX_TOKEN_SECONDS = STAFF_TOKEN_SECONDS;
/** Allowed clock difference between the API and the content server. */
const CLOCK_SKEW_SECONDS = 60;

export const lifetimeFor = (role: ViewerRole) =>
  role === 'student' ? STUDENT_TOKEN_SECONDS : STAFF_TOKEN_SECONDS;

const b64u = (b: Buffer) => b.toString('base64url');

function assertKey(key: Buffer) {
  if (key.length < 32) throw new Error('Token signing key must be at least 32 bytes');
}

function mac(key: Buffer, data: string) {
  return createHmac('sha256', key).update(data).digest();
}

export function signToken(
  key: Buffer,
  input: { subdomain: string; userId: string; role: ViewerRole },
  now = Date.now(),
): { token: string; expiresAt: Date } {
  assertKey(key);
  const iat = Math.floor(now / 1000);
  const payload: TokenPayload = {
    v: 1,
    s: input.subdomain,
    u: input.userId,
    r: input.role,
    iat,
    exp: iat + lifetimeFor(input.role),
  };
  const body = b64u(Buffer.from(JSON.stringify(payload)));
  return { token: `${body}.${b64u(mac(key, body))}`, expiresAt: new Date(payload.exp * 1000) };
}

export type VerifyFailure =
  'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'WRONG_SUBDOMAIN' | 'BAD_CLAIMS';
export type VerifyResult =
  { ok: true; payload: TokenPayload } | { ok: false; reason: VerifyFailure };

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{10,2048}\.[A-Za-z0-9_-]{43}$/;

/** Verify signature first (constant time), then claims, then the binding to `subdomain`. */
export function verifyToken(
  key: Buffer,
  token: string,
  subdomain: string,
  now = Date.now(),
): VerifyResult {
  assertKey(key);
  if (!TOKEN_SHAPE.test(token)) return { ok: false, reason: 'MALFORMED' };
  const [body, sig] = token.split('.') as [string, string];
  const expected = mac(key, body);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return { ok: false, reason: 'BAD_SIGNATURE' };

  let p: TokenPayload;
  try {
    p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }
  const nowS = Math.floor(now / 1000);
  if (
    p?.v !== 1 ||
    typeof p.s !== 'string' ||
    typeof p.u !== 'string' ||
    !['student', 'ta', 'instructor', 'admin'].includes(p.r) ||
    !Number.isInteger(p.iat) ||
    !Number.isInteger(p.exp) ||
    p.exp <= p.iat ||
    p.exp - p.iat > MAX_TOKEN_SECONDS ||
    p.iat > nowS + CLOCK_SKEW_SECONDS
  ) {
    return { ok: false, reason: 'BAD_CLAIMS' };
  }
  if (p.exp <= nowS) return { ok: false, reason: 'EXPIRED' };
  if (p.s !== subdomain) return { ok: false, reason: 'WRONG_SUBDOMAIN' };
  return { ok: true, payload: p };
}

/** Decode the shared secret from configuration (base64 or plain text, at least 32 bytes). */
export function parseTokenKey(value: string): Buffer {
  const key =
    /^[A-Za-z0-9+/=]+$/.test(value) && value.length >= 44
      ? Buffer.from(value, 'base64')
      : Buffer.from(value, 'utf8');
  assertKey(key);
  return key;
}
