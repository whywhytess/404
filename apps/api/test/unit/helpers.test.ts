import { describe, expect, it } from 'vitest';
import { JOIN_CODE_LENGTH, generateJoinCode, normaliseJoinCode } from '../../src/auth/join-code.js';
import { generateTemporaryPassword } from '../../src/auth/password.js';
import { courseHasEnded } from '../../src/routes/courses.js';
import { redactUrl } from '../../src/logger.js';

describe('join codes', () => {
  it('uses an unambiguous alphabet and fixed length', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateJoinCode();
      expect(code).toHaveLength(JOIN_CODE_LENGTH);
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
    }
  });
  it('normalises user input', () => {
    expect(normaliseJoinCode(' ab cd-ef 23 ')).toBe('ABCDEF23');
  });
});

describe('temporary passwords', () => {
  it('are 16 characters and differ each time', () => {
    const set = new Set(Array.from({ length: 50 }, () => generateTemporaryPassword()));
    expect(set.size).toBe(50);
    for (const p of set) expect(p).toHaveLength(16);
  });
});

describe('course end date (FR-36)', () => {
  const now = new Date('2027-05-30T12:00:00Z');
  it('is open on and before the end date and ended after it', () => {
    expect(courseHasEnded(null, now)).toBe(false);
    expect(courseHasEnded('2027-05-30', now)).toBe(false);
    expect(courseHasEnded('2027-05-29', now)).toBe(true);
  });
});

describe('log redaction (INV-11)', () => {
  it('removes access tokens from URLs', () => {
    expect(redactUrl('/_t/eyJabc.def/index.html?x=1')).toBe('/_t/[REDACTED]/index.html?x=1');
    expect(redactUrl('/api/courses')).toBe('/api/courses');
  });
});
