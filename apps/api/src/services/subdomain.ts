import { randomInt } from 'node:crypto';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const ALPHANUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const SUBDOMAIN_LENGTH = 12;

/**
 * FR-21: a random DNS label (starts with a letter, a–z0–9) with about 61 bits of entropy.
 * It contains no personal data, so old links and logs reveal nothing about the student.
 */
export function generateSubdomain(): string {
  let s = LETTERS[randomInt(LETTERS.length)]!;
  for (let i = 1; i < SUBDOMAIN_LENGTH; i++) s += ALPHANUM[randomInt(ALPHANUM.length)];
  return s;
}

export const SUBDOMAIN_PATTERN = /^[a-z][a-z0-9]{11}$/;
