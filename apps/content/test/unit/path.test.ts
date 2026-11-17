import { describe, expect, it } from 'vitest';
import { parseContentPath, redactUrl } from '../../src/app.js';

describe('parseContentPath (token prefix and safe decoding)', () => {
  it('splits token and file path', () => {
    expect(parseContentPath('/_t/TOKEN/index.html')).toEqual({
      token: 'TOKEN',
      path: 'index.html',
      trailingSlash: false,
    });
    expect(parseContentPath('/_t/TOKEN/css/site.css?v=2#x')).toEqual({
      token: 'TOKEN',
      path: 'css/site.css',
      trailingSlash: false,
    });
    expect(parseContentPath('/_t/TOKEN/about/')).toEqual({
      token: 'TOKEN',
      path: 'about',
      trailingSlash: true,
    });
    expect(parseContentPath('/_t/TOKEN/')).toEqual({
      token: 'TOKEN',
      path: '',
      trailingSlash: true,
    });
    expect(parseContentPath('/_t/TOKEN')).toEqual({
      token: 'TOKEN',
      path: '',
      trailingSlash: false,
    });
    expect(parseContentPath('/_t/TOKEN/my%20page.html')).toEqual({
      token: 'TOKEN',
      path: 'my page.html',
      trailingSlash: false,
    });
  });

  it('returns null without a token prefix (root-absolute links, ADR-008)', () => {
    expect(parseContentPath('/')).toBeNull();
    expect(parseContentPath('/css/style.css')).toBeNull();
    expect(parseContentPath('/_t/')).toBeNull();
    expect(parseContentPath('_t/TOKEN/x')).toBeNull();
  });

  it("rejects traversal and encoded separators so a request can never leave the version's folder", () => {
    for (const bad of [
      '/_t/T/../x.html',
      '/_t/T/a/../../x.html',
      '/_t/T/%2e%2e/x.html',
      '/_t/T/%2E%2E/x.html',
      '/_t/T/a%2f..%2f..%2fx.html',
      '/_t/T/a%5c..%5cx.html',
      '/_t/T/./x.html',
      '/_t/T/a//b.html',
      '/_t/T/%00.html',
      '/_t/T/%E0%A4%A.html',
    ]) {
      expect(parseContentPath(bad), bad).toBe('bad');
    }
  });
});

describe('redactUrl', () => {
  it('removes the token', () => {
    expect(redactUrl('/_t/abc.def/index.html')).toBe('/_t/[REDACTED]/index.html');
  });
});
