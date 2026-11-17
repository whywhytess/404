import { z } from 'zod';

export const Email = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email({ message: 'Enter a valid e-mail address' }))
  .transform((e) => e.toLowerCase());

/** NIST SP 800-63B: at least 8 characters; allow long passphrases; no composition rules. */
export const Password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

export const Name = z.string().trim().min(1, 'Name is required').max(100);
