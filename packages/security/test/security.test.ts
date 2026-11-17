import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  STAFF_TOKEN_SECONDS,
  STUDENT_TOKEN_SECONDS,
  contentSecurityHeaders,
  contentSecurityPolicy,
  parseTokenKey,
  signToken,
  verifyToken,
} from '../src/index.js';

const KEY = Buffer.alloc(32, 7);
const OTHER = Buffer.alloc(32, 8);
const NOW = Date.UTC(2027, 0, 15, 10, 0, 0);
const SUB = 'k7f3x9abcdef';

const forge = (payload: object, key = KEY) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
};

describe('token signing and lifetime (NFR-S3)', () => {
  it('students get at most 1 hour, staff at most 4 hours', () => {
    const s = signToken(KEY, { subdomain: SUB, userId: 'u1', role: 'student' }, NOW);
    const t = signToken(KEY, { subdomain: SUB, userId: 'u2', role: 'ta' }, NOW);
    expect(s.expiresAt.getTime() - NOW).toBe(STUDENT_TOKEN_SECONDS * 1000);
    expect(t.expiresAt.getTime() - NOW).toBe(STAFF_TOKEN_SECONDS * 1000);
    expect(STUDENT_TOKEN_SECONDS).toBeLessThanOrEqual(3600);
    expect(STAFF_TOKEN_SECONDS).toBeLessThanOrEqual(4 * 3600);
  });

  it('verifies a fresh token for its own subdomain', () => {
    const { token } = signToken(KEY, { subdomain: SUB, userId: 'u1', role: 'student' }, NOW);
    const r = verifyToken(KEY, token, SUB, NOW + 1000);
    expect(r).toMatchObject({ ok: true, payload: { s: SUB, u: 'u1', r: 'student' } });
  });

  it('refuses short keys', () => {
    expect(() =>
      signToken(Buffer.alloc(16), { subdomain: SUB, userId: 'u', role: 'student' }),
    ).toThrow();
  });
});

describe('ST-16 / ST-17 token verification failures', () => {
  const { token } = signToken(KEY, { subdomain: SUB, userId: 'u1', role: 'student' }, NOW);

  it('expired', () => {
    expect(verifyToken(KEY, token, SUB, NOW + STUDENT_TOKEN_SECONDS * 1000)).toEqual({
      ok: false,
      reason: 'EXPIRED',
    });
  });
  it("another subdomain (token reused for a classmate's site)", () => {
    expect(verifyToken(KEY, token, 'zzzzzzzzzzzz', NOW)).toEqual({
      ok: false,
      reason: 'WRONG_SUBDOMAIN',
    });
  });
  it('signed with another key', () => {
    const t = signToken(OTHER, { subdomain: SUB, userId: 'u1', role: 'student' }, NOW).token;
    expect(verifyToken(KEY, t, SUB, NOW)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });
  it('payload modified (e.g. extended expiry or changed subdomain)', () => {
    const [body, sig] = token.split('.');
    const p = JSON.parse(Buffer.from(body!, 'base64url').toString());
    p.exp += 3600;
    const tampered = `${Buffer.from(JSON.stringify(p)).toString('base64url')}.${sig}`;
    expect(verifyToken(KEY, tampered, SUB, NOW)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });
  it('signature modified by one character', () => {
    const last = token.at(-1) === 'A' ? 'B' : 'A';
    expect(verifyToken(KEY, token.slice(0, -1) + last, SUB, NOW).ok).toBe(false);
  });
  it('malformed strings', () => {
    for (const bad of [
      '',
      'abc',
      'a.b.c',
      `${token}.x`,
      token.replace('.', ''),
      '../../etc/passwd',
    ]) {
      expect(verifyToken(KEY, bad, SUB, NOW)).toEqual({ ok: false, reason: 'MALFORMED' });
    }
  });
  it('correctly signed but invalid claims: lifetime too long, issued in the future, unknown role, wrong version', () => {
    const iat = Math.floor(NOW / 1000);
    const base = { v: 1, s: SUB, u: 'u', r: 'student', iat, exp: iat + 60 };
    expect(verifyToken(KEY, forge({ ...base, exp: iat + 5 * 3600 }), SUB, NOW).ok).toBe(false);
    expect(verifyToken(KEY, forge({ ...base, iat: iat + 600, exp: iat + 700 }), SUB, NOW).ok).toBe(
      false,
    );
    expect(verifyToken(KEY, forge({ ...base, r: 'superuser' }), SUB, NOW).ok).toBe(false);
    expect(verifyToken(KEY, forge({ ...base, v: 2 }), SUB, NOW).ok).toBe(false);
    expect(verifyToken(KEY, forge({ ...base, exp: iat }), SUB, NOW).ok).toBe(false);
    expect(verifyToken(KEY, forge(base), SUB, NOW).ok).toBe(true); // control
  });
});

describe('key parsing', () => {
  it('accepts base64 or long plain text, refuses short keys', () => {
    expect(parseTokenKey(Buffer.alloc(32, 1).toString('base64')).length).toBe(32);
    expect(parseTokenKey('x'.repeat(40)).length).toBe(40);
    expect(() => parseTokenKey('short')).toThrow();
  });
});

describe('FR-24 uniform header set (SRD Appendix D)', () => {
  it('matches Appendix D exactly', () => {
    expect(contentSecurityPolicy('https://platform.example.com/some/path')).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
        "font-src 'self'; media-src 'self'; connect-src 'self'; worker-src 'none'; frame-src 'none'; " +
        "object-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors https://platform.example.com; " +
        'sandbox allow-scripts allow-forms allow-same-origin allow-modals',
    );
    const h = contentSecurityHeaders({ platformOrigin: 'https://platform.example.com' });
    expect(h).toMatchObject({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'X-Robots-Tag': 'noindex, nofollow',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Cache-Control': 'private, no-store',
    });
    // The sandbox never grants pop-ups, top-level navigation or downloads.
    expect(h['Content-Security-Policy']).not.toMatch(
      /allow-popups|allow-top-navigation|allow-downloads/,
    );
  });
});
