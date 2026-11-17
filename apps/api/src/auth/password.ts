import { hash, verify } from '@node-rs/argon2';
import { randomInt } from 'node:crypto';

// Argon2id with OWASP-recommended minimum parameters (19 MiB, 2 iterations, 1 lane) (NFR-S4).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, OPTIONS);

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  try {
    return await verify(hashValue, password);
  } catch {
    return false;
  }
}

/** A dummy hash used to keep login timing similar when the e-mail does not exist. */
let dummyHash: Promise<string> | undefined;
export const getDummyHash = () => (dummyHash ??= hashPassword('dummy-password-for-timing'));

const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** One-time temporary password for staff accounts; the user must change it at first sign-in. */
export function generateTemporaryPassword(length = 16): string {
  let out = '';
  for (let i = 0; i < length; i++) out += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)];
  return out;
}
