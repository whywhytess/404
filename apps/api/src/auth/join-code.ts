import { randomInt } from 'node:crypto';

// No 0/O, 1/I/L, to avoid misreading when the code is written on a slide.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_LENGTH = 8;

export function generateJoinCode(): string {
  let out = '';
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Accept user input with spaces, dashes or lower case. */
export function normaliseJoinCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}
