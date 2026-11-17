/**
 * Content server for the untrusted content domain (SRD 3.9.1; FR-21 – FR-25; ADR-001,
 * ADR-006 – ADR-008).
 *
 * For every request: host → submission → token → requested file. A failed check never
 * reads or returns submission content. Every response — including errors and redirects —
 * carries the uniform security headers. The server never sets cookies and never reads
 * them (NFR-S2).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import { CONTENT_TYPES } from '@webcove/shared';
import { contentSecurityHeaders, verifyToken } from '@webcove/security';
import { versionKey, type ObjectStore } from '@webcove/storage';

/** The two tables the content server reads. It never writes to the database. */
export interface ContentDatabase {
  submissions: {
    id: string;
    subdomain: string;
    current_version_id: string | null;
    taken_down_at: Date | null;
  };
  retired_subdomains: { subdomain: string };
}

export interface ContentDeps {
  db: Kysely<ContentDatabase>;
  store: ObjectStore;
  logger: Logger;
  tokenKey: Buffer;
  platformOrigin: string;
  /** Registrable content domain, e.g. "example-usercontent.net" (or "localhost" in development). */
  contentDomain: string;
  now?: () => number;
}

export const SUBDOMAIN_LABEL = /^[a-z][a-z0-9]{11}$/;
const EXT = /\.[a-z0-9]+$/i;

/** Remove the access token from a URL before logging it (INV-11). */
export const redactUrl = (url: string) => url.replace(/\/_t\/[^/?#]+/g, '/_t/[REDACTED]');

function page(title: string, text: string) {
  // Inline styles are permitted by style-src; no script.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;color:#1d2330"><h1 style="font-size:1.3rem">${title}</h1><p>${text}</p></body></html>`;
}

const PAGES = {
  400: page('Bad request', 'The address of this page is not valid.'),
  403: page(
    'Access link required',
    'This page can only be opened through Web Cove. Open the submission again from the platform to get a new link.',
  ),
  '403_expired': page(
    'Access link expired',
    'This access link has expired. Go back to Web Cove and open the submission again (or use "Refresh preview").',
  ),
  '403_down': page('Site taken down', 'This site has been taken down by the course staff.'),
  404: page(
    'Not found',
    'There is no file at this address in the submission. Links between files must use relative paths, e.g. "css/style.css".',
  ),
  405: page('Method not allowed', 'Only GET and HEAD requests are supported.'),
  410: page('Gone', 'This submission has been deleted.'),
  500: page('Error', 'Something went wrong while loading this page.'),
} as const;

/**
 * Split "/_t/<token>/<rest>" and decode <rest> safely. Returns null when the path has no
 * token prefix, or 'bad' when the remainder cannot be a file inside the site.
 */
export function parseContentPath(
  rawUrl: string,
): { token: string; path: string; trailingSlash: boolean } | null | 'bad' {
  const pathname = rawUrl.split(/[?#]/, 1)[0] ?? '';
  const segments = pathname.split('/');
  if (segments[0] !== '' || segments[1] !== '_t' || !segments[2]) return null;
  const token = segments[2];
  const rest = segments.slice(3);
  if (rest.length === 0) return { token, path: '', trailingSlash: false };
  const decoded: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const raw = rest[i]!;
    if (raw === '') {
      if (i === rest.length - 1) break; // trailing slash
      return 'bad'; // empty segment ("//")
    }
    let seg: string;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return 'bad';
    }
    // eslint-disable-next-line no-control-regex
    if (seg === '.' || seg === '..' || /[/\\\u0000-\u001f\u007f]/.test(seg)) return 'bad';
    decoded.push(seg.normalize('NFC'));
  }
  return { token, path: decoded.join('/'), trailingSlash: rest[rest.length - 1] === '' };
}

export function createContentHandler(deps: ContentDeps) {
  const security = contentSecurityHeaders({ platformOrigin: deps.platformOrigin });
  const suffix = `.${deps.contentDomain.toLowerCase()}`;
  const now = deps.now ?? Date.now;

  function send(
    res: ServerResponse,
    req: IncomingMessage,
    status: number,
    body: string,
    extra: Record<string, string> = {},
  ) {
    res.writeHead(status, {
      ...security,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(body)),
      ...extra,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const started = Date.now();
    res.on('finish', () => {
      deps.logger.info(
        {
          method: req.method,
          host: req.headers.host,
          url: redactUrl(req.url ?? ''),
          status: res.statusCode,
          ms: Date.now() - started,
        },
        'content request',
      );
    });
    try {
      // Host → subdomain label. Only first-level labels of the content domain are served.
      const host = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
      if (!host.endsWith(suffix)) return send(res, req, 404, PAGES[404]);
      const label = host.slice(0, -suffix.length);
      if (!SUBDOMAIN_LABEL.test(label)) return send(res, req, 404, PAGES[404]);

      if (req.method !== 'GET' && req.method !== 'HEAD')
        return send(res, req, 405, PAGES[405], { Allow: 'GET, HEAD' });

      const parsed = parseContentPath(req.url ?? '/');
      // No token prefix (including root-absolute links such as /css/style.css, ADR-008).
      if (parsed === null) return send(res, req, 403, PAGES[403]);
      if (parsed === 'bad') return send(res, req, 400, PAGES[400]);

      // Token: signature, expiry and binding to this subdomain. Cookies are never consulted.
      const verdict = verifyToken(deps.tokenKey, parsed.token, label, now());
      if (!verdict.ok)
        return send(
          res,
          req,
          403,
          verdict.reason === 'EXPIRED' ? PAGES['403_expired'] : PAGES[403],
        );

      if (parsed.path === '' && !parsed.trailingSlash) {
        return send(res, req, 301, '', { Location: `/_t/${parsed.token}/` });
      }

      const sub = await deps.db
        .selectFrom('submissions')
        .select(['current_version_id', 'taken_down_at'])
        .where('subdomain', '=', label)
        .executeTakeFirst();
      if (!sub) {
        const retired = await deps.db
          .selectFrom('retired_subdomains')
          .select('subdomain')
          .where('subdomain', '=', label)
          .executeTakeFirst();
        return send(res, req, retired ? 410 : 404, retired ? PAGES[410] : PAGES[404]);
      }
      // FR-29: take-down overrides every valid token.
      if (sub.taken_down_at) return send(res, req, 403, PAGES['403_down']);
      if (!sub.current_version_id) return send(res, req, 404, PAGES[404]);

      let filePath = parsed.path;
      if (filePath === '' || parsed.trailingSlash)
        filePath = filePath ? `${filePath}/index.html` : 'index.html';
      const ext = (EXT.exec(filePath)?.[0] ?? '').toLowerCase();
      const type = CONTENT_TYPES[ext];

      const object = type
        ? await deps.store.get(versionKey(sub.current_version_id, filePath))
        : null;
      if (!object) {
        // "about" → "about/" when it is a folder with an index page.
        if (!parsed.trailingSlash && !ext) {
          const index = await deps.store.get(
            versionKey(sub.current_version_id, `${filePath}/index.html`),
          );
          if (index) {
            index.body.destroy();
            const last = filePath.split('/').pop()!;
            return send(res, req, 301, '', { Location: `${encodeURIComponent(last)}/` });
          }
        }
        return send(res, req, 404, PAGES[404]);
      }

      // FR-25: content type from the allow-list only, never sniffed (nosniff in `security`).
      res.writeHead(200, {
        ...security,
        'Content-Type': type!,
        'Content-Length': String(object.size),
      });
      if (req.method === 'HEAD') {
        object.body.destroy();
        res.end();
        return;
      }
      await pipeline(object.body, res);
    } catch (err) {
      deps.logger.error({ err, url: redactUrl(req.url ?? '') }, 'content request failed');
      if (!res.headersSent) send(res, req, 500, PAGES[500]);
      else res.destroy();
    }
  };
}
