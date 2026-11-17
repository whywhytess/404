import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { pino } from 'pino';
import { FIXTURES } from '@webcove/zip-validator/fixtures';
import { contentSecurityHeaders, signToken } from '@webcove/security';
import {
  ORIGIN,
  TEST_CONTENT_DOMAIN,
  TEST_TOKEN_KEY,
  createCourseWithMembers,
  createUser,
  setupHarness,
  uploadZip,
  type Client,
  type Harness,
} from '../../../api/test/helpers/harness.js';
import { createContentHandler, type ContentDatabase } from '../../src/app.js';

let h: Harness;
let admin: Client;
let ctx: Awaited<ReturnType<typeof createCourseWithMembers>>;
let content: ReturnType<typeof createContentHandler>;
let clock = Date.now();

interface Published {
  subId: string;
  sub: string;
  token: string;
  url: string;
}
let mine: Published;
let classmate: Published;
let assignmentId: string;

const SECURITY = contentSecurityHeaders({ platformOrigin: ORIGIN });
const host = (sub: string) => `${sub}.${TEST_CONTENT_DOMAIN}`;
const get = (sub: string, path: string) => request(content).get(path).set('Host', host(sub));

async function publish(c: Client, zip: Buffer): Promise<Published> {
  const up = await uploadZip(c, assignmentId, zip);
  expect(up.status).toBe(201);
  const t = await c.post(`/api/submissions/${up.body.submission.id}/view-token`);
  expect(t.status).toBe(200);
  const token = new URL(t.body.url).pathname.split('/')[2]!;
  return { subId: up.body.submission.id, sub: t.body.subdomain, token, url: t.body.url };
}

function expectSecurityHeaders(res: request.Response) {
  for (const [k, v] of Object.entries(SECURITY)) expect(res.headers[k.toLowerCase()], k).toBe(v);
  expect(res.headers['set-cookie']).toBeUndefined();
}

beforeAll(async () => {
  h = await setupHarness();
  admin = (await createUser(h, 'admin', 'Admin')).c;
  ctx = await createCourseWithMembers(h, admin);
  const a = await ctx.instructor.c.post(`/api/courses/${ctx.course.id}/assignments`, {
    title: 'Site',
  });
  assignmentId = a.body.assignment.id;
  const mate = await createUser(h, 'student', 'Classmate');
  await mate.c.post('/api/courses/join', { joinCode: ctx.course.joinCode });
  content = createContentHandler({
    db: h.db.kysely as unknown as Kysely<ContentDatabase>,
    store: h.store,
    logger: pino({ level: 'silent' }),
    tokenKey: TEST_TOKEN_KEY,
    platformOrigin: ORIGIN,
    contentDomain: TEST_CONTENT_DOMAIN,
    now: () => clock,
  });
  mine = await publish(ctx.student.c, FIXTURES['disguised-html']!());
  classmate = await publish(mate.c, FIXTURES['valid-site']!());
});
afterAll(async () => h.close());

describe('FR-22 / FR-23 serving a published submission', () => {
  it('serves index.html at the token root with the uniform headers and no cookie', async () => {
    const res = await get(mine.sub, `/_t/${mine.token}/`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.text).toContain('<h1>Hi</h1>');
    expectSecurityHeaders(res);
  });

  it('serves nested files with content types from the allow-list (FR-25)', async () => {
    const css = await get(mine.sub, `/_t/${mine.token}/css/style.css`);
    expect(css.status).toBe(200);
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
    const png = await get(mine.sub, `/_t/${mine.token}/img/logo.png`);
    expect(png.headers['content-type']).toBe('image/png');
  });

  it('ST-13: an HTML payload with a .png name is sent as image/png with nosniff', async () => {
    const res = await get(mine.sub, `/_t/${mine.token}/img/photo.png`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('redirects the bare token path to the folder form so relative links resolve', async () => {
    const res = await get(mine.sub, `/_t/${mine.token}`);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(`/_t/${mine.token}/`);
    expectSecurityHeaders(res);
  });

  it('HEAD returns headers without a body', async () => {
    const res = await request(content)
      .head(`/_t/${mine.token}/index.html`)
      .set('Host', host(mine.sub));
    expect(res.status).toBe(200);
    expect(res.text ?? '').toBe('');
  });

  it('returns 404 for a missing file and for the API never present on the content domain', async () => {
    expect((await get(mine.sub, `/_t/${mine.token}/nope.html`)).status).toBe(404);
    expect((await get(mine.sub, `/_t/${mine.token}/api/auth/me`)).status).toBe(404);
  });

  it('serves the CURRENT version: a new upload is visible through the same token (SRD: not version-pinned)', async () => {
    const before = await get(mine.sub, `/_t/${mine.token}/img/photo.png`);
    expect(before.status).toBe(200);
    await uploadZip(ctx.student.c, assignmentId, FIXTURES['valid-site']!());
    const after = await get(mine.sub, `/_t/${mine.token}/img/photo.png`);
    expect(after.status).toBe(404); // the new version has no photo.png
  });
});

describe('access control on the content domain', () => {
  it('requests without a token, including root-absolute links, are refused (ADR-008)', async () => {
    for (const p of ['/', '/index.html', '/css/style.css', `/_t//index.html`]) {
      const res = await get(mine.sub, p);
      expect(res.status, p).toBe(403);
      expectSecurityHeaders(res);
    }
  });

  it('ST-16: a valid token for one submission does not open another subdomain', async () => {
    const res = await get(classmate.sub, `/_t/${mine.token}/`);
    expect(res.status).toBe(403);
  });

  it('ST-17: tampered and expired tokens are refused', async () => {
    const tampered = mine.token.slice(0, -2) + (mine.token.endsWith('AA') ? 'BB' : 'AA');
    expect((await get(mine.sub, `/_t/${tampered}/`)).status).toBe(403);
    const saved = clock;
    clock = Date.now() + 61 * 60 * 1000; // student tokens last 1 hour
    try {
      const res = await get(mine.sub, `/_t/${mine.token}/`);
      expect(res.status).toBe(403);
      expect(res.text).toContain('expired');
    } finally {
      clock = saved;
    }
  });

  it('a token signed with a different key is refused', async () => {
    const forged = signToken(Buffer.alloc(32, 1), {
      subdomain: mine.sub,
      userId: 'x',
      role: 'admin',
    }).token;
    expect((await get(mine.sub, `/_t/${forged}/`)).status).toBe(403);
  });

  it('ST-18 (automated part): cookies never influence the decision and none are set', async () => {
    const forged = 'session=forged; Domain=.usercontent.test; wc.sid=stolen';
    const ok = await get(mine.sub, `/_t/${mine.token}/`).set('Cookie', forged);
    expect(ok.status).toBe(200);
    expect(ok.headers['set-cookie']).toBeUndefined();
    const bad = await get(mine.sub, '/index.html').set('Cookie', forged);
    expect(bad.status).toBe(403);
    expect(bad.headers['set-cookie']).toBeUndefined();
  });

  it('rejects traversal attempts sent over HTTP', async () => {
    for (const p of [
      `/_t/${mine.token}/%2e%2e/%2e%2e/etc/passwd`,
      `/_t/${mine.token}/a%2f..%2f..%2fx`,
    ]) {
      const res = await get(mine.sub, p);
      expect(res.status, p).toBe(400);
    }
  });
});

describe('host routing (SRD 3.9.4)', () => {
  it('only first-level labels of the content domain are served', async () => {
    const path = `/_t/${mine.token}/`;
    expect((await request(content).get(path).set('Host', TEST_CONTENT_DOMAIN)).status).toBe(404);
    expect(
      (await request(content).get(path).set('Host', `a.${mine.sub}.${TEST_CONTENT_DOMAIN}`)).status,
    ).toBe(404);
    expect((await request(content).get(path).set('Host', `${mine.sub}.platform.test`)).status).toBe(
      404,
    );
    expect(
      (
        await request(content)
          .get(path)
          .set('Host', `${mine.sub.toUpperCase()}.${TEST_CONTENT_DOMAIN}:4000`)
      ).status,
    ).toBe(200);
  });

  it('only GET and HEAD are accepted', async () => {
    const res = await request(content).post(`/_t/${mine.token}/`).set('Host', host(mine.sub));
    expect(res.status).toBe(405);
    expectSecurityHeaders(res);
  });
});

describe('FR-24 identical security headers on every response', () => {
  it('200, 301, 400, 403, 404 and 405 across two subdomains carry the same header values', async () => {
    const responses = await Promise.all([
      get(mine.sub, `/_t/${mine.token}/`),
      get(classmate.sub, `/_t/${classmate.token}/css/style.css`),
      get(classmate.sub, `/_t/${classmate.token}`),
      get(mine.sub, `/_t/${mine.token}/%2e%2e/x`),
      get(classmate.sub, '/'),
      get(classmate.sub, `/_t/${classmate.token}/missing.html`),
      request(content).delete('/').set('Host', host(mine.sub)),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 301, 400, 403, 404, 405]);
    for (const r of responses) expectSecurityHeaders(r);
  });
});

describe('take-down and deletion', () => {
  it('a taken-down submission is refused even with a valid token (FR-29)', async () => {
    await h.db.kysely
      .updateTable('submissions')
      .set({ taken_down_at: new Date() })
      .where('id', '=', classmate.subId)
      .execute();
    const res = await get(classmate.sub, `/_t/${classmate.token}/`);
    expect(res.status).toBe(403);
    expect(res.text).toContain('taken down');
    await h.db.kysely
      .updateTable('submissions')
      .set({ taken_down_at: null })
      .where('id', '=', classmate.subId)
      .execute();
    expect((await get(classmate.sub, `/_t/${classmate.token}/`)).status).toBe(200);
  });

  it('a deleted (retired) subdomain returns 410 Gone (FR-37)', async () => {
    const sub = 'zretired0000';
    await sql`insert into retired_subdomains (subdomain) values (${sub})`.execute(h.db.kysely);
    const token = signToken(TEST_TOKEN_KEY, { subdomain: sub, userId: 'x', role: 'student' }).token;
    expect((await get(sub, `/_t/${token}/`)).status).toBe(410);
  });
});

describe('FR-23 issuing access links (platform API)', () => {
  it('owner gets ≤ 1 h, course TA/instructor ≤ 4 h; classmates and other courses get nothing', async () => {
    const own = await ctx.student.c.post(`/api/submissions/${mine.subId}/view-token`);
    expect(new Date(own.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(3600 * 1000);
    expect(own.body.url).toMatch(
      new RegExp(`^http://${mine.sub}\\.${TEST_CONTENT_DOMAIN}/_t/[^/]+/$`),
    );

    const ta = await ctx.ta.c.post(`/api/submissions/${mine.subId}/view-token`);
    expect(ta.status).toBe(200);
    const taLife = new Date(ta.body.expiresAt).getTime() - Date.now();
    expect(taLife).toBeGreaterThan(3600 * 1000);
    expect(taLife).toBeLessThanOrEqual(4 * 3600 * 1000);

    const mate = await createUser(h, 'student');
    await mate.c.post('/api/courses/join', { joinCode: ctx.course.joinCode });
    expect((await mate.c.post(`/api/submissions/${mine.subId}/view-token`)).status).toBe(404);
    const other = await createCourseWithMembers(h, admin);
    expect(
      (await other.instructor.c.post(`/api/submissions/${mine.subId}/view-token`)).status,
    ).toBe(404);
  });
});

describe('ST-19 / FR-34 requests per subdomain per second', () => {
  it('returns 429 with the security headers above the limit, per subdomain, and recovers next second', async () => {
    let t = Date.UTC(2027, 0, 1, 0, 0, 0, 100);
    const limited = createContentHandler({
      db: h.db.kysely as unknown as Kysely<ContentDatabase>,
      store: h.store,
      logger: pino({ level: 'silent' }),
      tokenKey: TEST_TOKEN_KEY,
      platformOrigin: ORIGIN,
      contentDomain: TEST_CONTENT_DOMAIN,
      now: () => t,
      requestsPerSecond: 5,
    });
    const token = signToken(
      TEST_TOKEN_KEY,
      { subdomain: mine.sub, userId: 'x', role: 'student' },
      t,
    ).token;
    const hit = (sub: string, tok = token) =>
      request(limited).get(`/_t/${tok}/`).set('Host', host(sub));
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await hit(mine.sub)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    const blocked = await hit(mine.sub);
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBe('1');
    expectSecurityHeaders(blocked);

    // Another subdomain has its own budget.
    const other = signToken(
      TEST_TOKEN_KEY,
      { subdomain: classmate.sub, userId: 'x', role: 'student' },
      t,
    ).token;
    expect((await hit(classmate.sub, other)).status).toBe(200);

    t += 1000;
    expect((await hit(mine.sub)).status).toBe(200);
  });

  it('reads the administrator-set limit from the database (FR-35)', async () => {
    await admin.put('/api/admin/settings', {
      storageQuotaBytes: 200 * 1024 * 1024,
      uploadsPerHour: 10,
      contentRequestsPerSecond: 2,
      maxArchiveBytes: 20 * 1024 * 1024,
      maxFileBytes: 5 * 1024 * 1024,
      maxFiles: 500,
      maxTotalBytes: 100 * 1024 * 1024,
      maxCompressionRatio: 100,
      retentionDays: 183,
    });
    const t = Date.UTC(2027, 0, 2, 0, 0, 0, 100);
    const fromDb = createContentHandler({
      db: h.db.kysely as unknown as Kysely<ContentDatabase>,
      store: h.store,
      logger: pino({ level: 'silent' }),
      tokenKey: TEST_TOKEN_KEY,
      platformOrigin: ORIGIN,
      contentDomain: TEST_CONTENT_DOMAIN,
      now: () => t,
    });
    const token = signToken(
      TEST_TOKEN_KEY,
      { subdomain: mine.sub, userId: 'x', role: 'student' },
      t,
    ).token;
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      statuses.push(
        (await request(fromDb).get(`/_t/${token}/`).set('Host', host(mine.sub))).status,
      );
    }
    expect(statuses).toEqual([200, 200, 429]);
  });
});
