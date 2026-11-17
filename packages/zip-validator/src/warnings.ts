/**
 * Rule warnings (FR-15). These are heuristics that predict what the uniform policy will
 * block; they are advisory only and are NOT a security control — the CSP and origin
 * isolation enforced by the content server are (SRD 3.9.3).
 */
import path from 'node:path/posix';
import { warningMessage, type Issue, type WarningCode } from './messages.js';

export type Warning = Issue<WarningCode>;

export const MAX_SCANNED_BYTES = 1024 * 1024;
export const MAX_WARNINGS = 200;

interface SiteIndex {
  exact: Set<string>;
  lower: Map<string, string>;
}

export function buildIndex(paths: string[]): SiteIndex {
  return { exact: new Set(paths), lower: new Map(paths.map((p) => [p.toLowerCase(), p])) };
}

const EXTERNAL = /^(?:https?:)?\/\//i;
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

type RefKind = 'script' | 'style' | 'frame' | 'form' | 'link' | 'resource';

class Collector {
  readonly items: Warning[] = [];
  private seen = new Set<string>();
  add(code: WarningCode, file: string, detail: string) {
    const key = `${code}|${file}|${detail}`;
    if (this.seen.has(key) || this.items.length >= MAX_WARNINGS) return;
    this.seen.add(key);
    this.items.push({ code, file, message: warningMessage(code, file, detail) });
  }
}

function shorten(s: string, n = 80) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Check one URL reference found in `file`. */
function checkRef(c: Collector, idx: SiteIndex, file: string, rawUrl: string, kind: RefKind) {
  const url = rawUrl.trim();
  if (!url || url.startsWith('#') || url.startsWith('data:') || url.startsWith('blob:')) return;
  if (/^javascript:/i.test(url)) {
    c.add('JAVASCRIPT_URL', file, shorten(url));
    return;
  }
  if (EXTERNAL.test(url)) {
    const code: Record<RefKind, WarningCode | null> = {
      script: 'EXTERNAL_SCRIPT',
      style: 'EXTERNAL_STYLE',
      frame: 'EXTERNAL_FRAME',
      form: 'EXTERNAL_FORM',
      link: null, // ordinary links to other sites are navigation, not loading
      resource: 'EXTERNAL_RESOURCE',
    };
    const w = code[kind];
    if (w) c.add(w, file, shorten(url));
    return;
  }
  if (OTHER_SCHEME.test(url)) return; // mailto:, tel:, etc.
  if (url.startsWith('/')) {
    c.add('ROOT_ABSOLUTE_PATH', file, shorten(url.split(/[?#]/)[0] ?? url));
    return;
  }
  let target = url.split(/[?#]/)[0] ?? '';
  if (!target) return;
  try {
    target = decodeURIComponent(target);
  } catch {
    /* keep raw */
  }
  let resolved = path.normalize(path.join(path.dirname(file), target)).normalize('NFC');
  if (resolved.startsWith('../') || resolved === '..') {
    c.add('MISSING_FILE', file, shorten(url));
    return;
  }
  if (target.endsWith('/') || resolved === '.') resolved = path.join(resolved, 'index.html');
  if (idx.exact.has(resolved)) return;
  const ci = idx.lower.get(resolved.toLowerCase());
  if (ci) c.add('CASE_MISMATCH', file, shorten(url));
  else c.add('MISSING_FILE', file, shorten(url));
}

const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(tagBody: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of tagBody.matchAll(ATTR)) {
    const name = m[1]!.toLowerCase();
    if (!attrs.has(name)) attrs.set(name, m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

const RESOURCE_TAGS = new Set([
  'img',
  'source',
  'video',
  'audio',
  'track',
  'embed',
  'object',
  'input',
]);

export function scanHtml(c: Collector, idx: SiteIndex, file: string, html: string) {
  const text = html.replace(/<!--[\s\S]*?-->/g, '');

  // Inline <script> blocks (data blocks such as application/json are not executed).
  for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = parseAttrs(m[1] ?? '');
    const type = (attrs.get('type') ?? '').toLowerCase();
    const isData = type !== '' && !/^(text\/javascript|module|application\/javascript)$/.test(type);
    if (!attrs.has('src') && !isData && (m[2] ?? '').trim() !== '')
      c.add('INLINE_SCRIPT', file, '<script>');
  }

  for (const m of text.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g)) {
    const tag = m[1]!.toLowerCase();
    const attrs = parseAttrs(m[2] ?? '');
    for (const [name, value] of attrs) {
      if (/^on[a-z]+$/.test(name)) c.add('INLINE_HANDLER', file, `${name}="${shorten(value, 40)}"`);
    }
    const src = attrs.get('src');
    const href = attrs.get('href');
    if (tag === 'script' && src !== undefined) checkRef(c, idx, file, src, 'script');
    else if (tag === 'iframe' || tag === 'frame') {
      if (src !== undefined) checkRef(c, idx, file, src, 'frame');
    } else if (tag === 'link' && href !== undefined) {
      const rel = (attrs.get('rel') ?? '').toLowerCase();
      checkRef(c, idx, file, href, rel.includes('stylesheet') ? 'style' : 'resource');
    } else if (tag === 'a' || tag === 'area') {
      if (href !== undefined) checkRef(c, idx, file, href, 'link');
    } else if (tag === 'form') {
      const action = attrs.get('action');
      if (action) checkRef(c, idx, file, action, 'form');
    } else if (RESOURCE_TAGS.has(tag)) {
      if (src !== undefined) checkRef(c, idx, file, src, 'resource');
      const poster = attrs.get('poster');
      if (poster) checkRef(c, idx, file, poster, 'resource');
      const data = attrs.get('data');
      if (tag === 'object' && data) checkRef(c, idx, file, data, 'resource');
    }
    const srcset = attrs.get('srcset');
    if (srcset) {
      for (const candidate of srcset.split(',')) {
        const u = candidate.trim().split(/\s+/)[0];
        if (u) checkRef(c, idx, file, u, 'resource');
      }
    }
    const style = attrs.get('style');
    if (style) scanCssUrls(c, idx, file, style);
  }

  for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi))
    scanCssUrls(c, idx, file, m[1] ?? '');
}

function scanCssUrls(c: Collector, idx: SiteIndex, file: string, css: string) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)) {
    checkRef(c, idx, file, m[1] ?? m[2] ?? m[3] ?? '', 'resource');
  }
  for (const m of clean.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) {
    checkRef(c, idx, file, m[1] ?? m[2] ?? '', 'style');
  }
}

export function scanCss(c: Collector, idx: SiteIndex, file: string, css: string) {
  scanCssUrls(c, idx, file, css);
}

export function scanJs(c: Collector, file: string, js: string) {
  for (const m of js.matchAll(
    /\b(?:fetch|open|EventSource|WebSocket|sendBeacon)\s*\(\s*(?:['"`]\s*(?:GET|POST)\s*['"`]\s*,\s*)?['"`]((?:https?:|wss?:)?\/\/[^'"`]+)['"`]/g,
  )) {
    c.add('EXTERNAL_REQUEST', file, shorten(m[1]!));
  }
  for (const m of js.matchAll(
    /\bimport\s*(?:[\w*{}\s,]+from\s*)?['"]((?:https?:)?\/\/[^'"]+)['"]/g,
  )) {
    c.add('EXTERNAL_SCRIPT', file, shorten(m[1]!));
  }
  if (/\beval\s*\(/.test(js)) c.add('EVAL', file, 'eval()');
  if (/\bnew\s+Function\s*\(/.test(js)) c.add('EVAL', file, 'new Function()');
}

export function newCollector() {
  return new Collector();
}
export type { Collector };
