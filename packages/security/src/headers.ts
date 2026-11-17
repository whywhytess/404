/**
 * The uniform security header set for every content-domain response (FR-24, SRD Appendix D,
 * ADR-007). Students cannot weaken it: a <meta> CSP can only add restrictions.
 */
export function contentSecurityPolicy(platformOrigin: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "media-src 'self'",
    "connect-src 'self'",
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "base-uri 'none'",
    `frame-ancestors ${new URL(platformOrigin).origin}`,
    'sandbox allow-scripts allow-forms allow-same-origin allow-modals',
  ].join('; ');
}

export function contentSecurityHeaders(opts: { platformOrigin: string }): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(opts.platformOrigin),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'private, no-store',
    // Ignored by browsers over plain HTTP (local development), effective over HTTPS.
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  };
}

/** Attributes of the review iframe (SRD Appendix D). */
export const REVIEW_IFRAME_SANDBOX = 'allow-scripts allow-forms allow-same-origin allow-modals';
